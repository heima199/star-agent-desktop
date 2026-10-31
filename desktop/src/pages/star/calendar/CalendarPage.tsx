import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { Bot, CalendarCheck2, ChevronLeft, ChevronRight, Footprints, Kanban, Plus } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { Checkbox } from '@/components/ui/Checkbox'
import { IconButton } from '@/components/ui/IconButton'
import { SegmentedControl } from '@/components/ui/SegmentedControl'
import { cx } from '@/lib/cx'
import { useSessionStore } from '@/stores/sessionStore'
import { newWorkbenchId, useStarWorkbenchStore, type BoardCard, type CalendarEvent } from '@/stores/starWorkbenchStore'
import { SCHEDULED_TAB_ID, useTabStore } from '@/stores/tabStore'
import { useTaskStore } from '@/stores/taskStore'
import { openStarPage } from '../../../components/star/starPages'
import {
  CALENDAR_COLORS,
  LAYERS,
  LAYER_LABELS,
  LAYER_TONES,
  VIEWS,
  VIEW_LABELS,
  addDays,
  addMinutes,
  automationRuns,
  buildEntries,
  dateKey,
  dateTimeKey,
  dayDiff,
  hasTime,
  isOverdue,
  parseLocal,
  shiftCursor,
  startOfDay,
  startOfWeek,
  viewRange,
  viewTitle,
  type CalendarEntry,
  type CalendarLayer,
  type CalendarView,
  type Footprint,
} from './calendarModel'
import { AgendaView, MonthView, TimeGrid, startEntryDrag, type DragPayload } from './calendarViews'
import { CardDialog, EventDialog, FootprintDialog, type CardDraft, type EventDraft } from './CalendarDialogs'
import { MiniMonth } from './MiniMonth'

/** The view and the layers shown outlive the page; the web calendar keeps them the same way. */
export const CALENDAR_PREFS_KEY = 'star.calendar.prefs'
const DEFAULT_LAYERS: Record<CalendarLayer, boolean> = { events: true, tasks: true, automations: true, footprints: true }
const UNSCHEDULED_SHOWN = 12

type Prefs = { view: CalendarView; layers: Record<CalendarLayer, boolean> }

function readPrefs(): Prefs {
  try {
    const raw = JSON.parse(localStorage.getItem(CALENDAR_PREFS_KEY) ?? '{}') as { view?: string; layers?: Partial<Record<CalendarLayer, boolean>> }
    return {
      view: VIEWS.includes(raw.view as CalendarView) ? (raw.view as CalendarView) : 'month',
      layers: { ...DEFAULT_LAYERS, ...(raw.layers ?? {}) },
    }
  } catch {
    return { view: 'month', layers: DEFAULT_LAYERS }
  }
}

function writePrefs(prefs: Prefs) {
  try {
    localStorage.setItem(CALENDAR_PREFS_KEY, JSON.stringify(prefs))
  } catch {
    // Only a preference: the switch still works for this visit.
  }
}

type EventDialogState = { event: CalendarEvent | null; defaults?: Partial<EventDraft> }
type CardDialogState = { card: BoardCard | null; defaults?: Partial<CardDraft> }

/**
 * 日历: the 日 / 周 / 月 / 日程 views over 我的日程, 看板 due dates, scheduled-task
 * runs and the day's conversations. The rail holds the small month, the
 * layers, 未安排的任务 (drag one onto a day to give it a due date) and a few
 * numbers from this workspace.
 */
export function CalendarPage() {
  const events = useStarWorkbenchStore(s => s.events)
  const cards = useStarWorkbenchStore(s => s.cards)
  const tasks = useTaskStore(s => s.tasks)
  const sessions = useSessionStore(s => s.sessions)
  const [prefs, setPrefs] = useState(readPrefs)
  const [now, setNow] = useState(() => new Date())
  const [cursor, setCursor] = useState(() => startOfDay(new Date()))
  const [eventDialog, setEventDialog] = useState<EventDialogState | null>(null)
  const [cardDialog, setCardDialog] = useState<CardDialogState | null>(null)
  const [footprintDay, setFootprintDay] = useState<CalendarEntry | null>(null)
  const { view, layers } = prefs

  useEffect(() => {
    if (!useTaskStore.getState().loaded) void useTaskStore.getState().fetchTasks()
  }, [])
  // Runs drop off as they pass, the now line moves, and "today" rolls over at midnight.
  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 60_000)
    return () => window.clearInterval(timer)
  }, [])

  const updatePrefs = (next: Partial<Prefs>) => {
    const merged = { ...prefs, ...next }
    setPrefs(merged)
    writePrefs(merged)
  }

  const footprints = useMemo<Footprint[]>(() => sessions.flatMap(session => {
    const at = new Date(session.modifiedAt)
    return Number.isNaN(at.getTime()) ? [] : [{ id: session.id, title: session.title || '未命名对话', at }]
  }), [sessions])

  const range = useMemo(() => viewRange(view, cursor), [view, cursor])
  const runs = useMemo(() => automationRuns(tasks, range.from, range.to, now.getTime()), [tasks, range, now])
  const entries = useMemo(
    () => buildEntries({ from: range.from, to: range.to, layers, events, cards, runs, footprints }),
    [range, layers, events, cards, runs, footprints],
  )

  // The small month's dots: days with an event, or a card still due.
  const marked = useMemo(() => {
    const days = new Set<string>()
    for (const event of events) days.add(event.start.slice(0, 10))
    for (const card of cards) if (card.due && card.column !== 'done') days.add(card.due.slice(0, 10))
    return days
  }, [events, cards])

  const unscheduled = useMemo(
    () => cards.filter(card => !card.due && card.column !== 'done').sort((a, b) => a.createdAt - b.createdAt),
    [cards],
  )

  const stats = useMemo(() => {
    const weekFrom = startOfWeek(now)
    const weekTo = addDays(weekFrom, 7)
    const open = cards.filter(card => card.due && card.column !== 'done')
    const dueThisWeek = open.filter(card => {
      const at = parseLocal(card.due!)
      return at >= weekFrom && at < weekTo
    }).length
    const overdue = open.filter(card => isOverdue(card.due!, now)).length
    const nextWeekRuns = automationRuns(tasks, now, addDays(now, 7), now.getTime()).reduce((sum, run) => sum + run.count, 0)
    const monthFootprints = footprints.filter(item => item.at.getFullYear() === now.getFullYear() && item.at.getMonth() === now.getMonth()).length
    return { dueThisWeek, overdue, nextWeekRuns, monthFootprints }
  }, [cards, tasks, footprints, now])

  const openNewEvent = (at: Date, allDay: boolean) => {
    setEventDialog({
      event: null,
      defaults: {
        start: allDay ? dateKey(at) : dateTimeKey(at),
        end: allDay ? dateKey(at) : dateTimeKey(addMinutes(at, 60)),
        allDay,
        color: 'blue',
      },
    })
  }
  // From the rail or the toolbar: the day in view, at the next full hour.
  const newEventNow = () => openNewEvent(new Date(cursor.getFullYear(), cursor.getMonth(), cursor.getDate(), Math.min(23, now.getHours() + 1)), false)

  const saveEvent = (draft: EventDraft) => {
    const stamp = Date.now()
    const current = eventDialog?.event
    useStarWorkbenchStore.getState().saveEvent(current
      ? { ...current, ...draft, updatedAt: stamp }
      : { id: newWorkbenchId('evt'), createdAt: stamp, updatedAt: stamp, ...draft })
  }

  const saveCard = (draft: CardDraft) => {
    const current = cardDialog?.card
    useStarWorkbenchStore.getState().saveCard(current
      ? { ...current, ...draft }
      : { id: newWorkbenchId('c'), createdAt: Date.now(), ...draft })
  }

  const onEntryClick = (entry: CalendarEntry) => {
    if (entry.event) setEventDialog({ event: entry.event })
    else if (entry.card) setCardDialog({ card: entry.card })
    else if (entry.run) useTaskStore.getState().openTaskEditor(entry.run.taskId)
    else if (entry.footprints) setFootprintDay(entry)
  }

  /** On a day an event keeps its time and a card its due time; on a time slot both take that time. */
  const onDropEntry = (payload: DragPayload, at: Date, withTime: boolean) => {
    const store = useStarWorkbenchStore.getState()
    if (payload.kind === 'task') {
      const card = store.cards.find(item => item.id === payload.id)
      if (!card) return
      const keepTime = !withTime && card.due && hasTime(card.due) ? card.due.slice(10) : ''
      store.saveCard({ ...card, due: withTime ? dateTimeKey(at) : `${dateKey(at)}${keepTime}` })
      return
    }
    const event = store.events.find(item => item.id === payload.id)
    if (!event) return
    const updatedAt = Date.now()
    if (event.allDay && !withTime) {
      const length = dayDiff(parseLocal(event.start), parseLocal(event.end))
      store.saveEvent({ ...event, start: dateKey(at), end: dateKey(addDays(at, length)), updatedAt })
      return
    }
    if (event.allDay) {
      store.saveEvent({ ...event, allDay: false, start: dateTimeKey(at), end: dateTimeKey(addMinutes(at, 60)), updatedAt })
      return
    }
    const start = parseLocal(event.start)
    const minutes = Math.max(30, Math.round((parseLocal(event.end).getTime() - start.getTime()) / 60_000))
    const nextStart = withTime ? at : new Date(at.getFullYear(), at.getMonth(), at.getDate(), start.getHours(), start.getMinutes())
    store.saveEvent({ ...event, start: dateTimeKey(nextStart), end: dateTimeKey(addMinutes(nextStart, minutes)), updatedAt })
  }

  const handlers = { onEntryClick, onCreateAt: openNewEvent, onDropEntry }
  const weekDays = useMemo(() => Array.from({ length: 7 }, (_, index) => addDays(startOfWeek(cursor), index)), [cursor])
  const goToday = () => {
    const current = new Date()
    setNow(current)
    setCursor(startOfDay(current))
  }
  const openSession = (id: string) => {
    const session = useSessionStore.getState().sessions.find(item => item.id === id)
    if (session) useSessionStore.getState().openHistoricalSession(session)
  }
  const sectionTitle = 'text-[12px] font-medium text-[var(--color-text-tertiary)]'

  return (
    <div data-testid="calendar-page" className="@container flex h-full min-h-0 w-full bg-[var(--color-surface)]">
      <div className="flex min-h-0 w-full">
        <aside className="hidden w-[248px] shrink-0 flex-col gap-5 overflow-y-auto border-r border-[var(--color-border)] px-4 py-5 @4xl:flex">
          <Button variant="primary" size="md" className="justify-start" icon={<Plus size={15} strokeWidth={1.75} aria-hidden="true" />} onClick={newEventNow} data-testid="calendar-new-event">
            新建日程
          </Button>
          <MiniMonth selected={cursor} marked={marked} now={now} onSelect={day => setCursor(startOfDay(day))} />

          <section data-testid="calendar-layers" className="flex flex-col gap-1.5">
            <h2 className={sectionTitle}>日历列表</h2>
            {LAYERS.map(layer => (
              <Checkbox
                key={layer}
                size="sm"
                checked={layers[layer]}
                onChange={() => updatePrefs({ layers: { ...layers, [layer]: !layers[layer] } })}
                containerClassName="items-center rounded-[var(--radius-sm)] px-1.5 py-1 hover:bg-[var(--color-surface-hover)]"
                label={(
                  <span className="flex items-center gap-2 text-[13px]">
                    <span aria-hidden="true" className={cx('h-2 w-2 shrink-0 rounded-full', LAYER_TONES[layer].dot)} />
                    {LAYER_LABELS[layer]}
                  </span>
                )}
              />
            ))}
            {layers.events ? (
              <div className="flex flex-wrap gap-x-2.5 gap-y-1 pl-7">
                {CALENDAR_COLORS.map(item => (
                  <span key={item.id} className="inline-flex items-center gap-1 text-[11px] text-[var(--color-text-tertiary)]">
                    <span aria-hidden="true" className={cx('h-1.5 w-1.5 rounded-full', item.tone.dot)} />
                    {item.label}
                  </span>
                ))}
              </div>
            ) : null}
          </section>

          <section data-testid="calendar-unscheduled" className="flex flex-col gap-1.5">
            <div className="flex items-center justify-between">
              <h2 className={sectionTitle}>未安排的任务</h2>
              <IconButton
                size="xs"
                tone="muted"
                label="新建任务"
                icon={<Plus size={14} strokeWidth={1.75} aria-hidden="true" />}
                onClick={() => setCardDialog({ card: null, defaults: { column: 'todo', due: null } })}
              />
            </div>
            {unscheduled.length === 0 ? (
              <p className="px-1.5 text-[12px] leading-5 text-[var(--color-text-tertiary)]">没有未安排的任务。看板里没写截止日期的任务会出现在这里，拖到日历上就排好了。</p>
            ) : unscheduled.slice(0, UNSCHEDULED_SHOWN).map(card => (
              <button
                key={card.id}
                type="button"
                draggable
                data-testid="calendar-unscheduled-task"
                title="拖到日历上安排时间"
                onClick={() => setCardDialog({ card })}
                onDragStart={event => startEntryDrag(event, { kind: 'task', id: card.id })}
                className="flex cursor-grab items-center gap-2 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface-container-lowest)] px-2 py-1.5 text-left text-[12px] text-[var(--color-text-primary)] transition-colors hover:border-[var(--color-border-strong)] active:cursor-grabbing"
              >
                <span aria-hidden="true" className={cx('h-2.5 w-2.5 shrink-0 rounded-[var(--radius-xs)] border', LAYER_TONES.tasks.ring)} />
                <span className="min-w-0 flex-1 truncate">{card.title}</span>
              </button>
            ))}
            {unscheduled.length > UNSCHEDULED_SHOWN ? (
              <span className="px-1.5 text-[11px] text-[var(--color-text-tertiary)]">还有 {unscheduled.length - UNSCHEDULED_SHOWN} 个</span>
            ) : null}
            <button type="button" onClick={() => openStarPage('board')} className="inline-flex items-center gap-1 self-start px-1.5 text-[12px] text-[var(--color-text-tertiary)] hover:text-[var(--color-text-primary)]">
              <Kanban size={13} strokeWidth={1.75} aria-hidden="true" />打开任务看板
            </button>
          </section>

          <section data-testid="calendar-workspace-stats" className="flex flex-col gap-1">
            <h2 className={sectionTitle}>来自当前工作区</h2>
            <StatRow
              icon={<CalendarCheck2 size={14} strokeWidth={1.75} aria-hidden="true" className={LAYER_TONES.tasks.text} />}
              label="任务截止日"
              value={`本周 ${stats.dueThisWeek} 个${stats.overdue ? ` · 已过期 ${stats.overdue}` : ''}`}
              onClick={() => { goToday(); updatePrefs({ view: 'week' }) }}
            />
            <StatRow
              icon={<Bot size={14} strokeWidth={1.75} aria-hidden="true" className={LAYER_TONES.automations.text} />}
              label="自动化"
              value={`7 天内运行 ${stats.nextWeekRuns} 次`}
              onClick={() => useTabStore.getState().openTab(SCHEDULED_TAB_ID, '定时任务', 'scheduled')}
            />
            <StatRow
              icon={<Footprints size={14} strokeWidth={1.75} aria-hidden="true" className={LAYER_TONES.footprints.text} />}
              label="学习足迹"
              value={`本月 ${stats.monthFootprints} 个对话`}
              onClick={() => { goToday(); updatePrefs({ view: 'month' }) }}
            />
          </section>
        </aside>

        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          <div className="flex flex-wrap items-center gap-2 border-b border-[var(--color-border)] px-4 py-2.5">
            <Button variant="secondary" size="base" onClick={goToday}>今天</Button>
            <div className="flex items-center">
              <IconButton size="md" tone="secondary" label="上一段" icon={<ChevronLeft size={16} strokeWidth={1.75} aria-hidden="true" />} onClick={() => setCursor(current => shiftCursor(view, current, -1))} />
              <IconButton size="md" tone="secondary" label="下一段" icon={<ChevronRight size={16} strokeWidth={1.75} aria-hidden="true" />} onClick={() => setCursor(current => shiftCursor(view, current, 1))} />
            </div>
            <h1 data-testid="calendar-title" aria-live="polite" className="min-w-0 truncate text-[18px] font-semibold text-[var(--color-text-primary)]">
              {viewTitle(view, cursor)}
            </h1>
            <span className="flex-1" />
            <SegmentedControl<CalendarView>
              as="tablist"
              label="视图"
              size="sm"
              value={view}
              onChange={next => updatePrefs({ view: next })}
              items={VIEWS.map(item => ({ value: item, label: VIEW_LABELS[item] }))}
            />
            <Button size="base" className="@4xl:hidden" icon={<Plus size={14} strokeWidth={1.75} aria-hidden="true" />} onClick={newEventNow}>新建</Button>
          </div>
          <div className="min-h-0 flex-1">
            {view === 'month' ? (
              <MonthView
                cursor={cursor}
                entries={entries}
                now={now}
                onShowDay={day => {
                  setCursor(startOfDay(day))
                  updatePrefs({ view: 'day' })
                }}
                {...handlers}
              />
            ) : view === 'agenda' ? (
              <AgendaView cursor={cursor} entries={entries} now={now} onEntryClick={onEntryClick} />
            ) : (
              <TimeGrid days={view === 'week' ? weekDays : [cursor]} entries={entries} now={now} {...handlers} />
            )}
          </div>
        </div>
      </div>

      {eventDialog ? (
        <EventDialog
          event={eventDialog.event}
          defaults={eventDialog.defaults}
          onClose={() => setEventDialog(null)}
          onSave={saveEvent}
          onDelete={eventDialog.event ? () => {
            useStarWorkbenchStore.getState().removeEvent(eventDialog.event!.id)
            setEventDialog(null)
          } : undefined}
        />
      ) : null}
      {cardDialog ? (
        <CardDialog
          card={cardDialog.card}
          defaults={cardDialog.defaults}
          onClose={() => setCardDialog(null)}
          onSave={saveCard}
          onDelete={cardDialog.card ? () => {
            useStarWorkbenchStore.getState().removeCard(cardDialog.card!.id)
            setCardDialog(null)
          } : undefined}
        />
      ) : null}
      {footprintDay?.footprints ? (
        <FootprintDialog day={footprintDay.start} footprints={footprintDay.footprints} onClose={() => setFootprintDay(null)} onOpen={openSession} />
      ) : null}
    </div>
  )
}

function StatRow({ icon, label, value, onClick }: { icon: ReactNode; label: string; value: string; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className="flex items-center gap-2 rounded-[var(--radius-sm)] px-1.5 py-1.5 text-left text-[12px] text-[var(--color-text-primary)] transition-colors hover:bg-[var(--color-surface-hover)]">
      {icon}
      <span className="min-w-0 flex-1 truncate">{label}</span>
      <span className="shrink-0 text-[11px] text-[var(--color-text-tertiary)]">{value}</span>
    </button>
  )
}
