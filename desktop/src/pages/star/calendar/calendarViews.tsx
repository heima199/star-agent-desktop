import { useEffect, useRef, useState, type DragEvent } from 'react'
import { Bot, Check, Footprints, Plus } from 'lucide-react'
import { cx } from '@/lib/cx'
import {
  addDays,
  addMinutes,
  clock,
  dateKey,
  entriesOnDay,
  isSameDay,
  isSameMonth,
  layoutTimed,
  monthDay,
  startOfDay,
  viewRange,
  weekdayLong,
  weekdayShort,
  WEEKDAY_NAMES,
  type CalendarEntry,
} from './calendarModel'

/** What the calendar lets you drag: an event, a card's due date, or a card from 未安排的任务. */
export const ENTRY_DRAG_TYPE = 'application/x-star-calendar-entry'

export type DragPayload = { kind: 'event' | 'task'; id: string }

export type ViewHandlers = {
  onEntryClick: (entry: CalendarEntry) => void
  /** A new event at this time, or on this day when `allDay`. */
  onCreateAt: (at: Date, allDay: boolean) => void
  /** An event or card dropped on a day (`withTime` false) or at a time. */
  onDropEntry: (payload: DragPayload, at: Date, withTime: boolean) => void
}

export function startEntryDrag(event: DragEvent, payload: DragPayload) {
  event.dataTransfer.setData(ENTRY_DRAG_TYPE, JSON.stringify(payload))
  event.dataTransfer.effectAllowed = 'move'
}

function readDragPayload(event: DragEvent): DragPayload | null {
  try {
    const raw = event.dataTransfer.getData(ENTRY_DRAG_TYPE)
    const parsed = raw ? (JSON.parse(raw) as DragPayload) : null
    return parsed && (parsed.kind === 'event' || parsed.kind === 'task') && typeof parsed.id === 'string' ? parsed : null
  } catch {
    return null
  }
}

const canDrop = (event: DragEvent) => event.dataTransfer.types.includes(ENTRY_DRAG_TYPE)

function dragPayloadOf(entry: CalendarEntry): DragPayload | null {
  if (entry.kind === 'event' && entry.event) return { kind: 'event', id: entry.event.id }
  if (entry.kind === 'task' && entry.card) return { kind: 'task', id: entry.card.id }
  return null
}

function KindIcon({ entry }: { entry: CalendarEntry }) {
  if (entry.kind === 'task') {
    return entry.done
      ? <Check size={12} strokeWidth={2} aria-hidden="true" className="shrink-0" />
      : <span aria-hidden="true" className="h-2.5 w-2.5 shrink-0 rounded-[var(--radius-xs)] border border-current" />
  }
  if (entry.kind === 'automation') return <Bot size={12} strokeWidth={1.75} aria-hidden="true" className="shrink-0" />
  if (entry.kind === 'footprint') return <Footprints size={12} strokeWidth={1.75} aria-hidden="true" className="shrink-0" />
  return <span aria-hidden="true" className={cx('h-1.5 w-1.5 shrink-0 rounded-full', entry.tone.dot)} />
}

/** One event, due date, run or day of conversations, as a one-line chip. */
export function EntryChip({ entry, onClick, showTime = true }: { entry: CalendarEntry; onClick: () => void; showTime?: boolean }) {
  const payload = dragPayloadOf(entry)
  return (
    <button
      type="button"
      data-testid="calendar-entry"
      data-entry-kind={entry.kind}
      title={entry.title}
      draggable={payload !== null}
      onClick={event => {
        event.stopPropagation()
        onClick()
      }}
      onDragStart={event => {
        if (payload) startEntryDrag(event, payload)
      }}
      className={cx(
        'flex w-full min-w-0 items-center gap-1 rounded-[var(--radius-xs)] border px-1.5 py-px text-left text-[11px] leading-4 transition-[filter] hover:brightness-95 dark:hover:brightness-125',
        entry.tone.chip,
        entry.done && 'line-through opacity-60',
      )}
    >
      <KindIcon entry={entry} />
      {showTime && !entry.allDay ? <span className="shrink-0 tabular-nums opacity-80">{clock(entry.start)}</span> : null}
      <span className="min-w-0 truncate">{entry.title}</span>
    </button>
  )
}

/** Today's date gets the filled circle; the other days keep plain figures. */
function dayNumberClass(today: boolean, muted: boolean) {
  return today
    ? 'bg-[var(--color-btn-primary-bg)] font-semibold text-[var(--color-btn-primary-fg)]'
    : muted ? 'text-[var(--color-text-tertiary)]' : 'text-[var(--color-text-primary)]'
}

const CELL_ENTRIES = 3

/** Whole weeks around the month; a cell lists three entries, the rest fold into "还有 N 项". */
export function MonthView({ cursor, entries, now, onShowDay, ...handlers }: ViewHandlers & {
  cursor: Date
  entries: CalendarEntry[]
  now: Date
  onShowDay: (day: Date) => void
}) {
  const { from, to } = viewRange('month', cursor)
  const days: Date[] = []
  for (let day = from; day < to; day = addDays(day, 1)) days.push(day)
  const [hover, setHover] = useState<string | null>(null)

  return (
    <div data-testid="calendar-month" className="flex h-full min-h-0 flex-col">
      <div className="grid shrink-0 grid-cols-7 border-b border-[var(--color-border)]">
        {WEEKDAY_NAMES.map(name => (
          <div key={name} className="px-2 py-1.5 text-[12px] text-[var(--color-text-tertiary)]">{name}</div>
        ))}
      </div>
      <div className="grid min-h-0 flex-1 auto-rows-fr grid-cols-7 overflow-y-auto">
        {days.map(day => {
          const key = dateKey(day)
          const list = entriesOnDay(entries, day)
          const outside = !isSameMonth(day, cursor)
          const today = isSameDay(day, now)
          return (
            <div
              key={key}
              data-date={key}
              data-testid="calendar-day-cell"
              onClick={() => handlers.onCreateAt(new Date(day.getFullYear(), day.getMonth(), day.getDate(), 9), false)}
              onDragOver={event => {
                if (!canDrop(event)) return
                event.preventDefault()
                setHover(key)
              }}
              onDragLeave={() => setHover(current => (current === key ? null : current))}
              onDrop={event => {
                event.preventDefault()
                setHover(null)
                const payload = readDragPayload(event)
                if (payload) handlers.onDropEntry(payload, startOfDay(day), false)
              }}
              className={cx(
                'group/cell relative flex min-h-[96px] min-w-0 cursor-pointer flex-col gap-0.5 border-b border-r border-[var(--color-border)] p-1 transition-colors [&:nth-child(7n)]:border-r-0',
                hover === key
                  ? 'bg-[var(--color-info-container)]'
                  : outside ? 'bg-[var(--color-surface-container-low)]' : 'hover:bg-[var(--color-surface-hover)]',
              )}
            >
              <div className="flex items-center justify-between">
                <button
                  type="button"
                  title="看这一天"
                  aria-label={`${monthDay(day)} ${weekdayLong(day)}${list.length ? `，${list.length} 项` : ''}`}
                  aria-current={today ? 'date' : undefined}
                  onClick={event => {
                    event.stopPropagation()
                    onShowDay(day)
                  }}
                  className={cx(
                    'inline-flex h-6 min-w-6 items-center justify-center rounded-full px-1 text-[12px] tabular-nums transition-colors',
                    !today && 'hover:bg-[var(--color-surface-container-high)]',
                    dayNumberClass(today, outside),
                  )}
                >
                  {day.getDate()}
                </button>
                <span aria-hidden="true" className="hidden items-center gap-0.5 pr-1 text-[11px] text-[var(--color-text-tertiary)] group-hover/cell:inline-flex">
                  <Plus size={11} strokeWidth={2} />新建
                </span>
              </div>
              {list.slice(0, CELL_ENTRIES).map(entry => (
                <EntryChip key={entry.key} entry={entry} onClick={() => handlers.onEntryClick(entry)} />
              ))}
              {list.length > CELL_ENTRIES ? (
                <button
                  type="button"
                  onClick={event => {
                    event.stopPropagation()
                    onShowDay(day)
                  }}
                  className="self-start px-1 text-left text-[11px] text-[var(--color-text-tertiary)] hover:text-[var(--color-text-primary)]"
                >
                  还有 {list.length - CELL_ENTRIES} 项
                </button>
              ) : null}
            </div>
          )
        })}
      </div>
    </div>
  )
}

export const HOUR_HEIGHT = 48
const DAY_MS = 86_400_000
const ALL_DAY_ENTRIES = 4

/** The week and day views: an all-day row over 24 hours of half-hour slots. */
export function TimeGrid({ days, entries, now, ...handlers }: ViewHandlers & {
  days: Date[]
  entries: CalendarEntry[]
  now: Date
}) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const [hover, setHover] = useState<{ day: string; minutes: number } | null>(null)

  // Opens on the working day rather than at midnight.
  useEffect(() => {
    scrollRef.current?.scrollTo?.({ top: HOUR_HEIGHT * 7.5 })
  }, [])

  const minutesAt = (event: { clientY: number }, column: HTMLElement) => {
    const rect = column.getBoundingClientRect()
    const minutes = ((event.clientY - rect.top) / HOUR_HEIGHT) * 60
    return Math.max(0, Math.min(23 * 60 + 30, Math.floor(minutes / 30) * 30))
  }

  const columns = days.length === 1 ? 'grid-cols-[56px_minmax(0,1fr)]' : 'grid-cols-[56px_repeat(7,minmax(0,1fr))]'

  return (
    <div data-testid={days.length === 1 ? 'calendar-day' : 'calendar-week'} className="flex h-full min-h-0 flex-col">
      {/* The two header rows reserve the scrollbar's gutter (it only applies
          to a box that clips), so their columns line up with the hours below. */}
      <div className={cx('grid shrink-0 overflow-hidden border-b border-[var(--color-border)] [scrollbar-gutter:stable]', columns)}>
        <div />
        {days.map(day => {
          const today = isSameDay(day, now)
          return (
            <div key={dateKey(day)} className="flex flex-col items-center gap-0.5 border-l border-[var(--color-border)] py-1.5">
              <span className="text-[11px] text-[var(--color-text-tertiary)]">{weekdayShort(day)}</span>
              <span aria-current={today ? 'date' : undefined} className={cx('inline-flex h-7 w-7 items-center justify-center rounded-full text-[14px] tabular-nums', dayNumberClass(today, false))}>
                {day.getDate()}
              </span>
            </div>
          )
        })}
      </div>
      <div className={cx('grid shrink-0 overflow-hidden border-b border-[var(--color-border)] [scrollbar-gutter:stable]', columns)}>
        <div className="px-1.5 py-1 text-right text-[11px] text-[var(--color-text-tertiary)]">全天</div>
        {days.map(day => {
          const allDay = entriesOnDay(entries, day).filter(entry => entry.allDay)
          return (
            <div
              key={dateKey(day)}
              data-testid="calendar-all-day"
              data-date={dateKey(day)}
              onClick={() => handlers.onCreateAt(startOfDay(day), true)}
              onDragOver={event => {
                if (canDrop(event)) event.preventDefault()
              }}
              onDrop={event => {
                event.preventDefault()
                const payload = readDragPayload(event)
                if (payload) handlers.onDropEntry(payload, startOfDay(day), false)
              }}
              className="flex min-h-8 min-w-0 cursor-pointer flex-col gap-0.5 border-l border-[var(--color-border)] p-0.5"
            >
              {allDay.slice(0, ALL_DAY_ENTRIES).map(entry => (
                <EntryChip key={entry.key} entry={entry} showTime={false} onClick={() => handlers.onEntryClick(entry)} />
              ))}
              {allDay.length > ALL_DAY_ENTRIES ? (
                <span className="px-1 text-[11px] text-[var(--color-text-tertiary)]">还有 {allDay.length - ALL_DAY_ENTRIES} 项</span>
              ) : null}
            </div>
          )
        })}
      </div>
      <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto [scrollbar-gutter:stable]">
        <div className={cx('relative grid', columns)} style={{ height: HOUR_HEIGHT * 24 }}>
          <div className="relative">
            {Array.from({ length: 24 }, (_, hour) => (
              <span key={hour} className="absolute right-1.5 -translate-y-1/2 text-[11px] tabular-nums text-[var(--color-text-tertiary)]" style={{ top: hour * HOUR_HEIGHT }}>
                {hour === 0 ? '' : `${String(hour).padStart(2, '0')}:00`}
              </span>
            ))}
          </div>
          {days.map(day => {
            const key = dateKey(day)
            const dayStart = startOfDay(day).getTime()
            const timed = layoutTimed(entriesOnDay(entries, day).filter(entry => !entry.allDay))
            return (
              <div
                key={key}
                data-date={key}
                data-testid="calendar-time-column"
                onClick={event => handlers.onCreateAt(addMinutes(startOfDay(day), minutesAt(event, event.currentTarget)), false)}
                onDragOver={event => {
                  if (!canDrop(event)) return
                  event.preventDefault()
                  const minutes = minutesAt(event, event.currentTarget)
                  setHover(current => (current?.day === key && current.minutes === minutes ? current : { day: key, minutes }))
                }}
                onDragLeave={() => setHover(null)}
                onDrop={event => {
                  event.preventDefault()
                  setHover(null)
                  const payload = readDragPayload(event)
                  if (payload) handlers.onDropEntry(payload, addMinutes(startOfDay(day), minutesAt(event, event.currentTarget)), true)
                }}
                className="relative cursor-pointer border-l border-[var(--color-border)]"
              >
                {Array.from({ length: 24 }, (_, hour) => (
                  <div key={hour} aria-hidden="true" className="pointer-events-none absolute inset-x-0 border-t border-[var(--color-border)]" style={{ top: hour * HOUR_HEIGHT }} />
                ))}
                {hover?.day === key ? (
                  <div
                    aria-hidden="true"
                    className="pointer-events-none absolute inset-x-1 rounded-[var(--radius-sm)] bg-[var(--color-info-container)] ring-1 ring-[var(--color-info)]"
                    style={{ top: (hover.minutes / 60) * HOUR_HEIGHT, height: HOUR_HEIGHT / 2 }}
                  />
                ) : null}
                {timed.map(({ entry, column, columns: count }) => {
                  const startMs = Math.max(entry.start.getTime(), dayStart)
                  const endMs = Math.min(entry.end.getTime(), dayStart + DAY_MS)
                  const top = ((startMs - dayStart) / 3_600_000) * HOUR_HEIGHT
                  const height = Math.max(20, ((endMs - startMs) / 3_600_000) * HOUR_HEIGHT - 2)
                  const payload = dragPayloadOf(entry)
                  return (
                    <div key={entry.key} className="absolute px-0.5" style={{ top, height, left: `${(column / count) * 100}%`, width: `${100 / count}%` }}>
                      <button
                        type="button"
                        data-testid="calendar-entry"
                        data-entry-kind={entry.kind}
                        title={entry.title}
                        draggable={payload !== null}
                        onClick={event => {
                          event.stopPropagation()
                          handlers.onEntryClick(entry)
                        }}
                        onDragStart={event => {
                          if (payload) startEntryDrag(event, payload)
                        }}
                        className={cx(
                          'flex h-full w-full flex-col items-start overflow-hidden rounded-[var(--radius-sm)] border px-1.5 py-0.5 text-left text-[11px] leading-4',
                          entry.tone.chip,
                          entry.done && 'line-through opacity-60',
                        )}
                      >
                        <span className="w-full truncate font-medium">{entry.title}</span>
                        {height > 30 ? <span className="tabular-nums opacity-80">{clock(entry.start)}–{clock(entry.end)}</span> : null}
                      </button>
                    </div>
                  )
                })}
                {isSameDay(day, now) ? (
                  <div
                    aria-hidden="true"
                    data-testid="calendar-now-line"
                    className="pointer-events-none absolute inset-x-0 z-[1] border-t-2 border-[var(--color-error)]"
                    style={{ top: ((now.getTime() - dayStart) / 3_600_000) * HOUR_HEIGHT }}
                  >
                    <span className="absolute -left-[5px] -top-[5px] h-2 w-2 rounded-full bg-[var(--color-error)]" />
                  </div>
                ) : null}
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}

const KIND_LABELS: Record<CalendarEntry['kind'], string> = { event: '日程', task: '任务', automation: '自动化', footprint: '足迹' }

/** 30 days from the cursor, listing only the days that have something on them. */
export function AgendaView({ cursor, entries, now, onEntryClick }: {
  cursor: Date
  entries: CalendarEntry[]
  now: Date
  onEntryClick: (entry: CalendarEntry) => void
}) {
  const groups = Array.from({ length: 30 }, (_, index) => addDays(startOfDay(cursor), index))
    .map(day => ({ day, list: entriesOnDay(entries, day) }))
    .filter(group => group.list.length > 0)

  if (groups.length === 0) {
    return (
      <div data-testid="calendar-agenda" className="flex h-full items-center justify-center p-10 text-[13px] text-[var(--color-text-tertiary)]">
        接下来 30 天没有安排
      </div>
    )
  }
  return (
    <div data-testid="calendar-agenda" className="h-full min-h-0 overflow-y-auto px-4 py-3">
      {groups.map(({ day, list }) => {
        const today = isSameDay(day, now)
        return (
          <section key={dateKey(day)} className="flex gap-4 border-b border-[var(--color-border)] py-3 last:border-b-0">
            <div className="w-24 shrink-0">
              <p className={cx('text-[13px] font-medium', today ? 'text-[var(--color-info)]' : 'text-[var(--color-text-primary)]')}>
                {monthDay(day)}{today ? ' · 今天' : ''}
              </p>
              <p className="text-[12px] text-[var(--color-text-tertiary)]">{weekdayLong(day)}</p>
            </div>
            <div className="flex min-w-0 flex-1 flex-col gap-1">
              {list.map(entry => (
                <button
                  key={entry.key}
                  type="button"
                  data-testid="calendar-entry"
                  data-entry-kind={entry.kind}
                  onClick={() => onEntryClick(entry)}
                  className="flex min-w-0 items-center gap-3 rounded-[var(--radius-md)] px-2 py-1.5 text-left transition-colors hover:bg-[var(--color-surface-hover)]"
                >
                  <span className="w-24 shrink-0 text-[12px] tabular-nums text-[var(--color-text-tertiary)]">
                    {entry.allDay ? '全天' : `${clock(entry.start)}–${clock(entry.end)}`}
                  </span>
                  <span aria-hidden="true" className={cx('h-2 w-2 shrink-0 rounded-full', entry.tone.dot)} />
                  <span className={cx('min-w-0 flex-1 truncate text-[13px]', entry.done ? 'text-[var(--color-text-tertiary)] line-through' : 'text-[var(--color-text-primary)]')}>
                    {entry.title}
                  </span>
                  <span className="shrink-0 text-[11px] text-[var(--color-text-tertiary)]">{KIND_LABELS[entry.kind]}</span>
                </button>
              ))}
            </div>
          </section>
        )
      })}
    </div>
  )
}
