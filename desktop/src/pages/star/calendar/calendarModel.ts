import { addDays, localDateKey } from '@/features/tokenUsage/heatmapModel'
import { isTaskPaused, upcomingRuns } from '@/components/tasks/taskOccurrences'
import type { BoardCard, CalendarColor, CalendarEvent } from '@/stores/starWorkbenchStore'
import type { CronTask } from '@/types/task'

/**
 * The STAR calendar (the web workbench's 日历, R13): 日 / 周 / 月 / 日程 views
 * over four layers — the user's own events, 看板 due dates, scheduled-task
 * runs and the conversations held each day.
 */

export type CalendarView = 'day' | 'week' | 'month' | 'agenda'
export const VIEWS: readonly CalendarView[] = ['day', 'week', 'month', 'agenda']
export const VIEW_LABELS: Record<CalendarView, string> = { day: '日', week: '周', month: '月', agenda: '日程' }

export type CalendarLayer = 'events' | 'tasks' | 'automations' | 'footprints'
export const LAYERS: readonly CalendarLayer[] = ['events', 'tasks', 'automations', 'footprints']
export const LAYER_LABELS: Record<CalendarLayer, string> = {
  events: '我的日程',
  tasks: '任务截止日',
  automations: '自动化（定时任务）',
  footprints: '学习足迹',
}

// ─── Dates (local time throughout) ──────────────────────────

export const dateKey = localDateKey
export { addDays }

const pad2 = (value: number) => String(value).padStart(2, '0')
const DAY_MS = 86_400_000

export function clock(date: Date): string {
  return `${pad2(date.getHours())}:${pad2(date.getMinutes())}`
}

export function dateTimeKey(date: Date): string {
  return `${dateKey(date)}T${clock(date)}`
}

/** Reads `YYYY-MM-DD` / `YYYY-MM-DDTHH:mm` as local time. */
export function parseLocal(value: string): Date {
  const [datePart = '', timePart = ''] = value.split('T')
  const [y, m, d] = datePart.split('-').map(Number)
  const [hh = 0, mm = 0] = timePart ? timePart.split(':').map(Number) : []
  return new Date(y ?? 1970, (m ?? 1) - 1, d ?? 1, hh, mm)
}

export const hasTime = (value: string) => value.includes('T')

export function startOfDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate())
}

export function addMinutes(date: Date, minutes: number): Date {
  return new Date(date.getTime() + minutes * 60_000)
}

/** Weeks start on Monday, as they do in the web calendar and the task calendar. */
export function startOfWeek(date: Date): Date {
  const day = startOfDay(date)
  return addDays(day, -((day.getDay() + 6) % 7))
}

export function isSameDay(a: Date, b: Date): boolean {
  return dateKey(a) === dateKey(b)
}

export function isSameMonth(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth()
}

/** Whole days from `from` to `to`, by the calendar rather than by 24-hour steps. */
export function dayDiff(from: Date, to: Date): number {
  return Math.round((startOfDay(to).getTime() - startOfDay(from).getTime()) / DAY_MS)
}

export const WEEKDAY_NAMES = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'] as const
const WEEKDAY_SHORT = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'] as const
const WEEKDAY_LONG = ['星期日', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六'] as const

export const weekdayShort = (date: Date) => WEEKDAY_SHORT[date.getDay()]!
export const weekdayLong = (date: Date) => WEEKDAY_LONG[date.getDay()]!
export const monthDay = (date: Date) => `${date.getMonth() + 1}月${date.getDate()}日`
export const fullDate = (date: Date) => `${date.getFullYear()}年${monthDay(date)}`

// ─── Views ──────────────────────────────────────────────────

/** Half-open: `from` is shown, `to` is not. */
export function viewRange(view: CalendarView, cursor: Date): { from: Date; to: Date } {
  const day = startOfDay(cursor)
  if (view === 'day') return { from: day, to: addDays(day, 1) }
  if (view === 'week') {
    const from = startOfWeek(day)
    return { from, to: addDays(from, 7) }
  }
  if (view === 'month') {
    const from = startOfWeek(new Date(day.getFullYear(), day.getMonth(), 1))
    const last = new Date(day.getFullYear(), day.getMonth() + 1, 0)
    return { from, to: addDays(startOfWeek(last), 7) }
  }
  return { from: day, to: addDays(day, 30) }
}

export function shiftCursor(view: CalendarView, cursor: Date, direction: 1 | -1): Date {
  if (view === 'day') return addDays(cursor, direction)
  if (view === 'week') return addDays(cursor, direction * 7)
  if (view === 'agenda') return addDays(cursor, direction * 30)
  // The same day of the next month, or its last day when that month is shorter.
  const lastDay = new Date(cursor.getFullYear(), cursor.getMonth() + direction + 1, 0).getDate()
  return new Date(cursor.getFullYear(), cursor.getMonth() + direction, Math.min(cursor.getDate(), lastDay))
}

export function viewTitle(view: CalendarView, cursor: Date): string {
  if (view === 'day') return `${fullDate(cursor)} ${weekdayLong(cursor)}`
  if (view === 'week') {
    const from = startOfWeek(cursor)
    const to = addDays(from, 6)
    return `${fullDate(from)} – ${isSameMonth(from, to) ? `${to.getDate()}日` : monthDay(to)}`
  }
  if (view === 'month') return `${cursor.getFullYear()}年${cursor.getMonth() + 1}月`
  return `${monthDay(cursor)}起 30 天`
}

/** 「今天 14:00」「明天」「周五」「10月30日」, the way a due date is read out. */
export function formatDue(due: string, now = new Date()): string {
  const at = parseLocal(due)
  if (Number.isNaN(at.getTime())) return due
  const days = dayDiff(now, at)
  const time = hasTime(due) ? ` ${clock(at)}` : ''
  if (days === 0) return `今天${time}`
  if (days === 1) return `明天${time}`
  if (days === -1) return `昨天${time}`
  if (days > 1 && days < 7) return `${weekdayShort(at)}${time}`
  return `${at.getFullYear() === now.getFullYear() ? monthDay(at) : fullDate(at)}${time}`
}

/** Past due: an earlier day, or today at a time already gone. */
export function isOverdue(due: string, now = new Date()): boolean {
  const at = parseLocal(due)
  const days = dayDiff(now, at)
  return days < 0 || (days === 0 && hasTime(due) && at.getTime() < now.getTime())
}

// ─── Colours: theme tokens only ─────────────────────────────

/** Whole class strings, so Tailwind sees every one of them in the source. */
export type Tone = { dot: string; chip: string; text: string; ring: string }

const TONES = {
  info: {
    dot: 'bg-[var(--color-info)]',
    chip: 'border-[color-mix(in_srgb,var(--color-info)_30%,transparent)] bg-[var(--color-info-container)] text-[var(--color-on-info-container)]',
    text: 'text-[var(--color-info)]',
    ring: 'border-[var(--color-info)]',
  },
  success: {
    dot: 'bg-[var(--color-success)]',
    chip: 'border-[color-mix(in_srgb,var(--color-success)_30%,transparent)] bg-[var(--color-success-container)] text-[var(--color-on-success-container)]',
    text: 'text-[var(--color-success)]',
    ring: 'border-[var(--color-success)]',
  },
  warning: {
    dot: 'bg-[var(--color-warning)]',
    chip: 'border-[color-mix(in_srgb,var(--color-warning)_30%,transparent)] bg-[var(--color-warning-container)] text-[var(--color-on-warning-container)]',
    text: 'text-[var(--color-warning)]',
    ring: 'border-[var(--color-warning)]',
  },
  error: {
    dot: 'bg-[var(--color-error)]',
    chip: 'border-[color-mix(in_srgb,var(--color-error)_30%,transparent)] bg-[var(--color-error-container)] text-[var(--color-on-error-container)]',
    text: 'text-[var(--color-error)]',
    ring: 'border-[var(--color-error)]',
  },
  // The theme has no violet of its own; this one is mixed from its blue and red.
  violet: {
    dot: 'bg-[color-mix(in_srgb,var(--color-info)_55%,var(--color-error))]',
    chip: 'border-[color-mix(in_srgb,color-mix(in_srgb,var(--color-info)_55%,var(--color-error))_30%,transparent)] bg-[color-mix(in_srgb,color-mix(in_srgb,var(--color-info)_55%,var(--color-error))_12%,var(--color-surface-container-lowest))] text-[color-mix(in_srgb,var(--color-info)_55%,var(--color-error))]',
    text: 'text-[color-mix(in_srgb,var(--color-info)_55%,var(--color-error))]',
    ring: 'border-[color-mix(in_srgb,var(--color-info)_55%,var(--color-error))]',
  },
  indigo: {
    dot: 'bg-[var(--color-series-3)]',
    chip: 'border-[color-mix(in_srgb,var(--color-series-3)_32%,transparent)] bg-[color-mix(in_srgb,var(--color-series-3)_12%,var(--color-surface-container-lowest))] text-[var(--color-series-3)]',
    text: 'text-[var(--color-series-3)]',
    ring: 'border-[var(--color-series-3)]',
  },
  teal: {
    dot: 'bg-[var(--color-memory-accent)]',
    chip: 'border-[var(--color-memory-border)] bg-[var(--color-memory-surface)] text-[var(--color-memory-accent)]',
    text: 'text-[var(--color-memory-accent)]',
    ring: 'border-[var(--color-memory-accent)]',
  },
  neutral: {
    dot: 'bg-[var(--color-text-tertiary)]',
    chip: 'border-[var(--color-border)] bg-[var(--color-surface-container-high)] text-[var(--color-text-secondary)]',
    text: 'text-[var(--color-text-tertiary)]',
    ring: 'border-[var(--color-text-tertiary)]',
  },
} satisfies Record<string, Tone>

export const CALENDAR_COLORS: readonly { id: CalendarColor; label: string; tone: Tone }[] = [
  { id: 'blue', label: '工作', tone: TONES.info },
  { id: 'green', label: '生活', tone: TONES.success },
  { id: 'orange', label: '学习', tone: TONES.warning },
  { id: 'purple', label: '会议', tone: TONES.violet },
  { id: 'red', label: '重要', tone: TONES.error },
  { id: 'gray', label: '其他', tone: TONES.neutral },
]

export function calendarColor(id: CalendarColor) {
  return CALENDAR_COLORS.find(item => item.id === id) ?? CALENDAR_COLORS[0]!
}

export const LAYER_TONES: Record<CalendarLayer, Tone> = {
  events: TONES.info,
  tasks: TONES.error,
  automations: TONES.indigo,
  footprints: TONES.teal,
}

// ─── Entries ────────────────────────────────────────────────

/** One scheduled-task run on the calendar; a day with very many is one entry. */
export type AutomationRun = { key: string; taskId: string; title: string; at: Date; count: number }

/** A conversation, dated by its last change. */
export type Footprint = { id: string; title: string; at: Date }

export type CalendarEntry = {
  key: string
  kind: 'event' | 'task' | 'automation' | 'footprint'
  title: string
  start: Date
  /** Exclusive. */
  end: Date
  allDay: boolean
  tone: Tone
  done?: boolean
  event?: CalendarEvent
  card?: BoardCard
  run?: AutomationRun
  footprints?: Footprint[]
}

/** More runs than this in a day (an every-5-minutes task) fold into one entry. */
const COLLAPSE_PER_DAY = 6

/**
 * The runs scheduled tasks have left in [from, to), counted the way the desktop
 * scheduler fires them (see taskOccurrences). Paused tasks do not run.
 */
export function automationRuns(tasks: readonly CronTask[], from: Date, to: Date, now: number): AutomationRun[] {
  const runs: AutomationRun[] = []
  for (const task of tasks) {
    if (isTaskPaused(task)) continue
    const byDay = new Map<string, number[]>()
    for (const at of upcomingRuns(task, { start: from.getTime(), end: to.getTime() }, now)) {
      const key = dateKey(new Date(at))
      const list = byDay.get(key)
      if (list) list.push(at)
      else byDay.set(key, [at])
    }
    for (const [day, list] of byDay) {
      if (list.length > COLLAPSE_PER_DAY) {
        runs.push({ key: `${task.id}-${day}`, taskId: task.id, title: task.name, at: new Date(list[0]!), count: list.length })
        continue
      }
      for (const at of list) runs.push({ key: `${task.id}-${at}`, taskId: task.id, title: task.name, at: new Date(at), count: 1 })
    }
  }
  return runs.sort((a, b) => a.at.getTime() - b.at.getTime())
}

const KIND_RANK: Record<CalendarEntry['kind'], number> = { event: 0, task: 1, automation: 2, footprint: 3 }

export function buildEntries(input: {
  from: Date
  to: Date
  layers: Record<CalendarLayer, boolean>
  events: readonly CalendarEvent[]
  cards: readonly BoardCard[]
  runs: readonly AutomationRun[]
  footprints: readonly Footprint[]
}): CalendarEntry[] {
  const { from, to, layers } = input
  const entries: CalendarEntry[] = []
  const overlaps = (start: Date, end: Date) => start < to && end > from

  if (layers.events) {
    for (const event of input.events) {
      const start = event.allDay ? startOfDay(parseLocal(event.start)) : parseLocal(event.start)
      const rawEnd = event.allDay ? addDays(startOfDay(parseLocal(event.end)), 1) : parseLocal(event.end)
      const end = rawEnd > start ? rawEnd : addMinutes(start, 30)
      if (!overlaps(start, end)) continue
      entries.push({ key: `event-${event.id}`, kind: 'event', title: event.title, start, end, allDay: event.allDay, tone: calendarColor(event.color).tone, event })
    }
  }

  if (layers.tasks) {
    for (const card of input.cards) {
      if (!card.due) continue
      const timed = hasTime(card.due)
      const start = timed ? parseLocal(card.due) : startOfDay(parseLocal(card.due))
      const end = timed ? addMinutes(start, 30) : addDays(start, 1)
      if (!overlaps(start, end)) continue
      entries.push({ key: `task-${card.id}`, kind: 'task', title: card.title, start, end, allDay: !timed, tone: LAYER_TONES.tasks, done: card.column === 'done', card })
    }
  }

  if (layers.automations) {
    for (const run of input.runs) {
      const end = addMinutes(run.at, 20)
      if (!overlaps(run.at, end)) continue
      entries.push({
        key: `auto-${run.key}`,
        kind: 'automation',
        title: run.count > 1 ? `${run.title}（${run.count} 次）` : run.title,
        start: run.at,
        end,
        allDay: false,
        tone: LAYER_TONES.automations,
        run,
      })
    }
  }

  if (layers.footprints) {
    const byDay = new Map<string, Footprint[]>()
    for (const footprint of input.footprints) {
      if (footprint.at < from || footprint.at >= to) continue
      const key = dateKey(footprint.at)
      const list = byDay.get(key)
      if (list) list.push(footprint)
      else byDay.set(key, [footprint])
    }
    for (const [key, list] of byDay) {
      const day = parseLocal(key)
      entries.push({
        key: `footprint-${key}`,
        kind: 'footprint',
        title: `学习足迹 · ${list.length} 个对话`,
        start: day,
        end: addDays(day, 1),
        allDay: true,
        tone: LAYER_TONES.footprints,
        footprints: list.sort((a, b) => b.at.getTime() - a.at.getTime()),
      })
    }
  }

  return entries.sort((a, b) =>
    Number(b.allDay) - Number(a.allDay)
    || a.start.getTime() - b.start.getTime()
    || KIND_RANK[a.kind] - KIND_RANK[b.kind])
}

/** A day's entries; an all-day event spanning several days counts on each. */
export function entriesOnDay(entries: readonly CalendarEntry[], day: Date): CalendarEntry[] {
  const start = startOfDay(day)
  const end = addDays(start, 1)
  return entries.filter(entry => entry.start < end && entry.end > start)
}

/**
 * Timed entries of one day in the week / day grid: overlapping ones sit side by
 * side. Returns each entry's column and how many columns its group has.
 */
export function layoutTimed(entries: readonly CalendarEntry[]) {
  const sorted = [...entries].sort((a, b) => a.start.getTime() - b.start.getTime() || b.end.getTime() - a.end.getTime())
  const placed: { entry: CalendarEntry; column: number; columns: number }[] = []
  let group: { entry: CalendarEntry; column: number }[] = []
  let groupEnd = 0
  const flush = () => {
    const columns = Math.max(1, ...group.map(item => item.column + 1))
    for (const item of group) placed.push({ ...item, columns })
    group = []
  }
  for (const entry of sorted) {
    if (group.length > 0 && entry.start.getTime() >= groupEnd) flush()
    const used = new Set(group.filter(item => item.entry.end.getTime() > entry.start.getTime()).map(item => item.column))
    let column = 0
    while (used.has(column)) column += 1
    group.push({ entry, column })
    groupEnd = Math.max(groupEnd, entry.end.getTime())
  }
  if (group.length > 0) flush()
  return placed
}
