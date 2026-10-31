import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { IconButton } from '@/components/ui/IconButton'
import {
  formatClock,
  isTaskPaused,
  monthGrid,
  monthOf,
  runsByDay,
  shiftMonth,
  type DayRuns,
  type MonthRef,
} from '@/components/tasks/taskOccurrences'
import { addDays, DATE_LOCALES, localDateKey, parseLocalDate } from '@/features/tokenUsage/heatmapModel'
import { useTranslation } from '@/i18n'
import { cx } from '@/lib/cx'
import { describeTaskSchedule } from '@/lib/scheduledTask'
import { useSettingsStore } from '@/stores/settingsStore'
import { useTaskStore } from '@/stores/taskStore'
import type { CronTask } from '@/types/task'

/** Monday first, named by the weekday keys the cron descriptions already use. */
const WEEKDAY_KEYS = ['cron.dow.1', 'cron.dow.2', 'cron.dow.3', 'cron.dow.4', 'cron.dow.5', 'cron.dow.6', 'cron.dow.0'] as const

/** Tasks a day cell lists before the rest fold into "+N". */
const CELL_TASKS = 3
/** Later run times the day panel lists for one task. */
const PANEL_TIMES = 8
/** Re-reads the clock so runs drop off as they pass and "today" rolls over at midnight. */
const CLOCK_TICK_MS = 60_000

const ARROW_STEPS: Readonly<Record<string, number>> = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 }

type Props = {
  tasks: CronTask[]
}

/**
 * The calendar view of the scheduled-tasks page: a month of upcoming runs, and
 * the selected day's runs listed underneath. A task opens the same editor the
 * list's Edit action does.
 */
export function TaskCalendar({ tasks }: Props) {
  const t = useTranslation()
  const locale = useSettingsStore((state) => state.locale)
  const openTaskEditor = useTaskStore((state) => state.openTaskEditor)
  const [now, setNow] = useState(() => Date.now())
  const [month, setMonth] = useState<MonthRef>(() => monthOf(new Date(now)))
  const [selectedKey, setSelectedKey] = useState(() => localDateKey(new Date(now)))
  const gridRef = useRef<HTMLDivElement>(null)
  const focusKey = useRef<string | null>(null)
  const panelHeadingId = useId()

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), CLOCK_TICK_MS)
    return () => window.clearInterval(timer)
  }, [])

  // Arrow keys move the selection; focus follows once the target day has rendered.
  useEffect(() => {
    const key = focusKey.current
    if (!key) return
    focusKey.current = null
    gridRef.current?.querySelector<HTMLElement>(`[data-day="${key}"]`)?.focus()
  })

  const days = useMemo(() => monthGrid(month), [month])
  const dayKeys = useMemo(() => days.map(localDateKey), [days])
  const range = useMemo(
    () => ({ start: days[0]!.getTime(), end: addDays(days[days.length - 1]!, 1).getTime() }),
    [days],
  )
  const runs = useMemo(() => runsByDay(tasks, range, now), [tasks, range, now])

  const intlLocale = DATE_LOCALES[locale]
  const formats = useMemo(() => ({
    month: new Intl.DateTimeFormat(intlLocale, { year: 'numeric', month: 'long' }),
    day: new Intl.DateTimeFormat(intlLocale, { year: 'numeric', month: 'long', day: 'numeric', weekday: 'long' }),
    panel: new Intl.DateTimeFormat(intlLocale, { month: 'long', day: 'numeric', weekday: 'long' }),
  }), [intlLocale])

  const todayKey = localDateKey(new Date(now))
  const monthLabel = formats.month.format(new Date(month.year, month.month, 1))
  // The grid is one tab stop: the selected day, or the 1st when the selection is out of view.
  const tabKey = dayKeys.includes(selectedKey) ? selectedKey : localDateKey(new Date(month.year, month.month, 1))
  const selectedRuns = runs.get(selectedKey) ?? []

  const showMonth = (next: MonthRef, today: Date) => {
    setMonth(next)
    // Keep the panel on the month in view: today when it is in there, the 1st otherwise.
    const holdsToday = today.getFullYear() === next.year && today.getMonth() === next.month
    setSelectedKey(localDateKey(holdsToday ? today : new Date(next.year, next.month, 1)))
  }

  const goToday = () => {
    const current = Date.now()
    setNow(current)
    showMonth(monthOf(new Date(current)), new Date(current))
  }

  /** Selects a day, turning the page when the day is outside the six weeks shown. */
  const selectDay = (date: Date): string => {
    const key = localDateKey(date)
    if (!dayKeys.includes(key)) setMonth(monthOf(date))
    setSelectedKey(key)
    return key
  }

  const onGridKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const step = ARROW_STEPS[event.key]
    if (step === undefined) return
    event.preventDefault()
    focusKey.current = selectDay(addDays(parseLocalDate(selectedKey), step))
  }

  const dayLabel = (day: Date, count: number): string => {
    const date = formats.day.format(day)
    if (count === 0) return date
    return t(count === 1 ? 'scheduledPage.calendar.dayTasksOne' : 'scheduledPage.calendar.dayTasksOther', { date, count })
  }

  return (
    <div>
      <Card radius="lg" surface="lowest" padding="none" className="overflow-hidden">
        <div className="flex items-center gap-1 border-b border-[var(--color-border)] px-4 py-2.5">
          <h2 aria-live="polite" className="min-w-0 flex-1 truncate text-[15px] font-semibold text-[var(--color-text-primary)]">
            {monthLabel}
          </h2>
          <IconButton
            icon={<ChevronLeft size={16} strokeWidth={1.75} aria-hidden="true" />}
            label={t('scheduledPage.calendar.prevMonth')}
            tone="secondary"
            onClick={() => showMonth(shiftMonth(month, -1), new Date(now))}
          />
          <Button variant="secondary" size="base" onClick={goToday}>
            {t('scheduledPage.calendar.today')}
          </Button>
          <IconButton
            icon={<ChevronRight size={16} strokeWidth={1.75} aria-hidden="true" />}
            label={t('scheduledPage.calendar.nextMonth')}
            tone="secondary"
            onClick={() => showMonth(shiftMonth(month, 1), new Date(now))}
          />
        </div>

        <div ref={gridRef} role="grid" aria-label={monthLabel} onKeyDown={onGridKeyDown}>
          <div role="row" className="grid grid-cols-7 border-b border-[var(--color-border)]">
            {WEEKDAY_KEYS.map((key) => (
              <div key={key} role="columnheader" className="px-2 py-1.5 text-[12px] text-[var(--color-text-tertiary)]">
                {t(key)}
              </div>
            ))}
          </div>
          <div role="rowgroup" className="divide-y divide-[var(--color-border)]">
            {Array.from({ length: days.length / 7 }, (_, week) => (
              <div key={dayKeys[week * 7]} role="row" className="grid grid-cols-7 divide-x divide-[var(--color-border)]">
                {days.slice(week * 7, week * 7 + 7).map((day, index) => {
                  const key = dayKeys[week * 7 + index]!
                  const entries = runs.get(key) ?? []
                  return (
                    <DayCell
                      key={key}
                      dayKey={key}
                      day={day}
                      label={dayLabel(day, entries.length)}
                      entries={entries}
                      inMonth={day.getMonth() === month.month}
                      today={key === todayKey}
                      selected={key === selectedKey}
                      tabbable={key === tabKey}
                      onSelect={() => selectDay(day)}
                      onOpenTask={openTaskEditor}
                    />
                  )
                })}
              </div>
            ))}
          </div>
        </div>
      </Card>

      <section aria-labelledby={panelHeadingId} className="mt-5">
        <h3 id={panelHeadingId} className="text-[14px] font-semibold text-[var(--color-text-primary)]">
          {formats.panel.format(parseLocalDate(selectedKey))}
        </h3>
        {selectedRuns.length > 0 ? (
          <Card radius="lg" surface="lowest" padding="none" className="mt-2 overflow-hidden">
            <ul className="divide-y divide-[var(--color-border)]">
              {selectedRuns.map((entry) => (
                <PanelRun key={entry.task.id} entry={entry} onOpen={openTaskEditor} />
              ))}
            </ul>
          </Card>
        ) : (
          <p className="mt-2 text-[13px] leading-[1.6] text-[var(--color-text-tertiary)]">
            {selectedKey < todayKey ? t('scheduledPage.calendar.pastDay') : t('scheduledPage.calendar.dayEmpty')}
          </p>
        )}
      </section>
    </div>
  )
}

type DayCellProps = {
  dayKey: string
  day: Date
  label: string
  entries: DayRuns[]
  inMonth: boolean
  today: boolean
  selected: boolean
  tabbable: boolean
  onSelect: () => void
  onOpenTask: (id: string) => void
}

function DayCell({ dayKey, day, label, entries, inMonth, today, selected, tabbable, onSelect, onOpenTask }: DayCellProps) {
  const t = useTranslation()
  const hidden = entries.length - CELL_TASKS
  return (
    // A pointer can pick the day anywhere in the cell; the keyboard uses the date button.
    <div
      role="gridcell"
      aria-selected={selected}
      onClick={onSelect}
      className={cx(
        'flex min-h-[112px] min-w-0 cursor-pointer flex-col gap-0.5 p-1.5 transition-colors',
        selected
          ? 'bg-[var(--color-brand-soft)]'
          : cx('hover:bg-[var(--color-surface-hover)]', !inMonth && 'bg-[var(--color-surface-container-low)]'),
      )}
    >
      <button
        type="button"
        data-day={dayKey}
        tabIndex={tabbable ? 0 : -1}
        aria-label={label}
        aria-current={today ? 'date' : undefined}
        className={cx(
          'inline-flex h-6 min-w-6 items-center justify-center self-start rounded-[var(--radius-full)] px-1.5 text-[12px] tabular-nums',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-border-focus)]',
          today
            ? 'bg-[var(--color-btn-primary-bg)] font-semibold text-[var(--color-btn-primary-fg)]'
            : inMonth ? 'text-[var(--color-text-primary)]' : 'text-[var(--color-text-tertiary)]',
        )}
      >
        {day.getDate()}
      </button>
      {entries.slice(0, CELL_TASKS).map((entry) => (
        <CellRun key={entry.task.id} entry={entry} onOpen={onOpenTask} />
      ))}
      {hidden > 0 ? (
        <span className="px-1 text-[11px] leading-4 text-[var(--color-text-tertiary)]">
          {t('scheduledPage.calendar.more', { count: hidden })}
        </span>
      ) : null}
    </div>
  )
}

function CellRun({ entry, onOpen }: { entry: DayRuns; onOpen: (id: string) => void }) {
  const t = useTranslation()
  const paused = isTaskPaused(entry.task)
  const details = [entry.task.name, describeTaskSchedule(entry.task, t), paused ? t('tasks.disabled') : null]
    .filter(Boolean)
    .join(' · ')
  return (
    <button
      type="button"
      // Not a tab stop: the day panel lists the same tasks as ordinary buttons.
      tabIndex={-1}
      title={details}
      onClick={(event) => {
        event.stopPropagation()
        onOpen(entry.task.id)
      }}
      className={cx(
        'flex w-full min-w-0 items-center gap-1 rounded-[var(--radius-xs)] px-1 py-0.5 text-left text-[11px] leading-4 transition-colors hover:bg-[var(--color-surface-container-high)]',
        paused && 'opacity-50',
      )}
    >
      <span className="shrink-0 font-mono tabular-nums text-[var(--color-text-tertiary)]">{formatClock(entry.times[0]!)}</span>
      <span className="min-w-0 flex-1 truncate text-[var(--color-text-primary)]">{entry.task.name}</span>
      {entry.count > 1 ? (
        <span className="shrink-0 tabular-nums text-[var(--color-text-tertiary)]">{`×${entry.count}`}</span>
      ) : null}
    </button>
  )
}

function PanelRun({ entry, onOpen }: { entry: DayRuns; onOpen: (id: string) => void }) {
  const t = useTranslation()
  const paused = isTaskPaused(entry.task)
  const later = entry.times.slice(1, PANEL_TIMES + 1)
  const rest = entry.count - 1 - later.length
  return (
    <li>
      <button
        type="button"
        onClick={() => onOpen(entry.task.id)}
        className={cx(
          'flex w-full items-start gap-3 px-4 py-3 text-left transition-colors hover:bg-[var(--color-surface-hover)]',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--color-border-focus)]',
          paused && 'opacity-50',
        )}
      >
        <span className="w-11 shrink-0 font-mono text-[13px] leading-5 tabular-nums text-[var(--color-text-secondary)]">
          {formatClock(entry.times[0]!)}
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex min-w-0 items-center gap-2">
            <span className="truncate text-sm font-medium leading-5 text-[var(--color-text-primary)]">{entry.task.name}</span>
            {paused ? <Badge>{t('tasks.disabled')}</Badge> : null}
          </span>
          <span className="mt-0.5 block truncate text-xs text-[var(--color-text-tertiary)]">
            {describeTaskSchedule(entry.task, t)}
          </span>
          {later.length > 0 ? (
            <span className="mt-1.5 flex flex-wrap items-center gap-1">
              {later.map((at) => (
                <Badge key={at} mono>{formatClock(at)}</Badge>
              ))}
              {rest > 0 ? (
                <span className="text-[11px] text-[var(--color-text-tertiary)]">
                  {t('scheduledPage.calendar.moreRuns', { count: rest })}
                </span>
              ) : null}
            </span>
          ) : null}
        </span>
      </button>
    </li>
  )
}
