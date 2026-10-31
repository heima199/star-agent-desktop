import { localDateKey } from '@/features/tokenUsage/heatmapModel'
import type { CronTask } from '@/types/task'

/**
 * Where a scheduled task's runs fall on a calendar.
 *
 * The rules mirror the desktop scheduler (src/server/services/cronScheduler.ts
 * and scheduledTaskSchedule.ts), not textbook cron, so the calendar shows what
 * will actually fire:
 *
 * - A `cron` schedule is read in its own `timeZone`; a task without a schedule
 *   (the legacy shape) fires on the host's local clock.
 * - Day-of-month and day-of-week must BOTH match. `0 9 13 * 5` is Friday the
 *   13th only, where classic cron would also fire on every 13th and every Friday.
 * - A cron task that is not `recurring` fires at its first match and is then
 *   switched off, so it has at most one upcoming run.
 * - A wall time inside a spring-forward gap never appears on the clock, so it
 *   does not run that day.
 */

/** The values each cron field matches, ascending. */
export type CronFields = {
  minutes: number[]
  hours: number[]
  daysOfMonth: number[]
  months: number[]
  /** 0 is Sunday; the `7` alias is folded into 0. */
  daysOfWeek: number[]
}

/** A month as `Date` counts it: `month` is 0–11. */
export type MonthRef = { year: number; month: number }

/** Half-open: `start` is included, `end` is not. Both are epoch milliseconds. */
export type TimeRange = { start: number; end: number }

/** One task's runs on one local day. */
export type DayRuns = {
  task: CronTask
  /** The day's first runs, ascending; at most `RUN_TIMES_KEPT` of them. */
  times: number[]
  /** Every run that day, including the ones `times` leaves out. */
  count: number
}

/** Six Monday-first weeks: every month fits, and the grid never changes height. */
export const GRID_DAYS = 42

/** Enough for a day cell and the day panel; an every-minute task has 1440. */
export const RUN_TIMES_KEPT = 12

const MINUTE_MS = 60_000
const HOUR_MS = 60 * MINUTE_MS
const DAY_MS = 24 * HOUR_MS
/** IANA offsets stay within ±14 hours of UTC. */
const MAX_OFFSET_MS = 14 * HOUR_MS

type FieldBounds = { min: number; max: number; sundayAlias?: boolean }

const FIELD_BOUNDS: readonly FieldBounds[] = [
  { min: 0, max: 59 }, // minute
  { min: 0, max: 23 }, // hour
  { min: 1, max: 31 }, // day of month
  { min: 1, max: 12 }, // month
  { min: 0, max: 6, sundayAlias: true }, // day of week
]

/** `*`, `N`, `N-M`, and a `/S` step on any of them; comma lists of those. */
const FIELD_PART = /^(?:\*|(\d+)(?:-(\d+))?)(?:\/(\d+))?$/

function expandField(field: string, { min, max, sundayAlias = false }: FieldBounds): number[] | null {
  const values = new Set<number>()
  for (const part of field.split(',')) {
    const match = FIELD_PART.exec(part)
    if (!match) return null
    const step = match[3] === undefined ? 1 : Number(match[3])
    if (step < 1) return null
    let low = min
    let high = max
    if (match[1] !== undefined) {
      low = Number(match[1])
      // `N/S` steps from N to the end of the field.
      high = match[2] !== undefined ? Number(match[2]) : match[3] !== undefined ? max : low
      if (low > high || low < min || high > (sundayAlias ? 7 : max)) return null
    }
    for (let value = low; value <= high; value += step) values.add(sundayAlias && value === 7 ? 0 : value)
  }
  return [...values].sort((a, b) => a - b)
}

/**
 * Expands a 5-field cron expression: minute hour day-of-month month day-of-week.
 * Returns null for anything else — six fields, names (`MON`), `L`, `W`, `?` —
 * which the scheduler does not accept either.
 */
export function parseCronFields(expression: string): CronFields | null {
  const parts = expression.trim().split(/\s+/)
  if (parts.length !== FIELD_BOUNDS.length) return null
  const expanded = parts.map((part, index) => expandField(part, FIELD_BOUNDS[index]!))
  const [minutes, hours, daysOfMonth, months, daysOfWeek] = expanded
  if (!minutes || !hours || !daysOfMonth || !months || !daysOfWeek) return null
  return { minutes, hours, daysOfMonth, months, daysOfWeek }
}

export function shiftMonth({ year, month }: MonthRef, delta: number): MonthRef {
  const first = new Date(year, month + delta, 1)
  return { year: first.getFullYear(), month: first.getMonth() }
}

export function monthOf(date: Date): MonthRef {
  return { year: date.getFullYear(), month: date.getMonth() }
}

/** The local days a Monday-first month grid shows, from the Monday on or before the 1st. */
export function monthGrid({ year, month }: MonthRef): Date[] {
  const lead = (new Date(year, month, 1).getDay() + 6) % 7
  return Array.from({ length: GRID_DAYS }, (_, index) => new Date(year, month, 1 - lead + index))
}

export function isTaskPaused(task: CronTask): boolean {
  return task.enabled === false || task.scheduleState === 'paused'
}

/** 24-hour local clock time, the way cron descriptions print it. */
export function formatClock(at: number): string {
  const date = new Date(at)
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
}

type DayMatcher = (month: number, dayOfMonth: number, dayOfWeek: number) => boolean
type Walk = (from: number, to: number, limit: number) => number[]

function dayMatcher(fields: CronFields): DayMatcher {
  const months = new Set(fields.months)
  const daysOfMonth = new Set(fields.daysOfMonth)
  const daysOfWeek = new Set(fields.daysOfWeek)
  return (month, dayOfMonth, dayOfWeek) => months.has(month) && daysOfMonth.has(dayOfMonth) && daysOfWeek.has(dayOfWeek)
}

/** Runs on the host clock, day by day; `Date` does the DST arithmetic. */
function walkHostClock(fields: CronFields, matches: DayMatcher, from: number, to: number, limit: number): number[] {
  const runs: number[] = []
  const first = new Date(from)
  for (let offset = 0; ; offset++) {
    const day = new Date(first.getFullYear(), first.getMonth(), first.getDate() + offset)
    if (day.getTime() >= to) return runs
    if (!matches(day.getMonth() + 1, day.getDate(), day.getDay())) continue
    for (const hour of fields.hours) {
      for (const minute of fields.minutes) {
        const at = new Date(day.getFullYear(), day.getMonth(), day.getDate(), hour, minute)
        // `Date` moves a wall time out of a spring-forward gap; that time never runs.
        if (at.getHours() !== hour || at.getMinutes() !== minute) continue
        const ms = at.getTime()
        if (ms < from) continue
        if (ms >= to) return runs
        runs.push(ms)
        if (runs.length >= limit) return runs
      }
    }
  }
}

const zoneFormats = new Map<string, Intl.DateTimeFormat | null>()

function zoneFormat(timeZone: string): Intl.DateTimeFormat | null {
  let format = zoneFormats.get(timeZone)
  if (format === undefined) {
    try {
      format = new Intl.DateTimeFormat('en-US', {
        timeZone, year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', hourCycle: 'h23',
      })
    } catch {
      // Not a zone this runtime knows, so there is no clock to read the schedule on.
      format = null
    }
    zoneFormats.set(timeZone, format)
  }
  return format
}

/** The zone's wall clock at `ms`, encoded as if it were a UTC timestamp. */
function wallTime(format: Intl.DateTimeFormat, ms: number): number {
  const part: Record<string, number> = {}
  for (const { type, value } of format.formatToParts(ms)) part[type] = Number(value)
  return Date.UTC(part.year ?? 0, (part.month ?? 1) - 1, part.day ?? 1, (part.hour ?? 0) % 24, part.minute ?? 0)
}

/** How far the zone's clock runs ahead of UTC at the instant `ms`. */
function zoneOffset(format: Intl.DateTimeFormat, ms: number): number {
  return wallTime(format, ms) - Math.floor(ms / MINUTE_MS) * MINUTE_MS
}

/** The instant the zone's clock shows `wall`; null when a DST gap skips that time. */
function zonedInstant(format: Intl.DateTimeFormat, wall: number): number | null {
  const ms = wall - zoneOffset(format, wall - zoneOffset(format, wall))
  return wall - zoneOffset(format, ms) === ms ? ms : null
}

/** Runs on another zone's clock, walking that zone's calendar dates. */
function walkZoneClock(
  fields: CronFields,
  matches: DayMatcher,
  format: Intl.DateTimeFormat,
  from: number,
  to: number,
  limit: number,
): number[] {
  const runs: number[] = []
  const firstWall = wallTime(format, from)
  for (let date = firstWall - (firstWall % DAY_MS); date - MAX_OFFSET_MS < to; date += DAY_MS) {
    const day = new Date(date)
    if (!matches(day.getUTCMonth() + 1, day.getUTCDate(), day.getUTCDay())) continue
    // One offset serves the whole date unless a DST change falls inside it; then
    // each time is resolved on its own, which also drops the times a gap skips.
    const opening = zoneOffset(format, date - zoneOffset(format, date))
    const closingWall = date + DAY_MS - MINUTE_MS
    const closing = zoneOffset(format, closingWall - zoneOffset(format, closingWall))
    for (const hour of fields.hours) {
      for (const minute of fields.minutes) {
        const wall = date + hour * HOUR_MS + minute * MINUTE_MS
        const ms = opening === closing ? wall - opening : zonedInstant(format, wall)
        if (ms === null || ms < from) continue
        if (ms >= to) return runs
        runs.push(ms)
        if (runs.length >= limit) return runs
      }
    }
  }
  return runs
}

function hostTimeZone(): string | undefined {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone
  } catch {
    return undefined
  }
}

function cronWalk(fields: CronFields, timeZone: string | undefined): Walk | null {
  const matches = dayMatcher(fields)
  if (!timeZone || timeZone === hostTimeZone()) {
    return (from, to, limit) => walkHostClock(fields, matches, from, to, limit)
  }
  const format = zoneFormat(timeZone)
  return format ? (from, to, limit) => walkZoneClock(fields, matches, format, from, to, limit) : null
}

/**
 * The runs a task has left inside `range`, ascending. Only upcoming runs: the
 * scheduler counts from the minute after the current one, and what already ran
 * lives in the task's run history, not here.
 */
export function upcomingRuns(task: CronTask, range: TimeRange, now: number): number[] {
  if (task.scheduleState === 'completed') return []
  const schedule = task.schedule
  if (schedule?.kind === 'once') {
    const at = Date.parse(schedule.runAt)
    return at > now && at >= range.start && at < range.end ? [at] : []
  }
  const after = Math.floor(now / MINUTE_MS) * MINUTE_MS + MINUTE_MS
  const from = Math.max(range.start, after)
  // The walks stop on reaching `range.end`; a NaN bound would never get there.
  if (!Number.isFinite(from) || !Number.isFinite(range.end) || from >= range.end) return []
  const fields = parseCronFields(schedule?.kind === 'cron' ? schedule.expression : task.cron ?? '')
  const walk = fields && cronWalk(fields, schedule?.kind === 'cron' ? schedule.timeZone : undefined)
  if (!walk) return []
  if (task.recurring === true) return walk(from, range.end, Number.POSITIVE_INFINITY)
  const [first] = walk(after, range.end, 1)
  return first !== undefined && first >= range.start ? [first] : []
}

/**
 * Every task's upcoming runs in `range`, grouped by local day (`YYYY-MM-DD`).
 * Each day lists a task once, ordered by its first run that day.
 */
export function runsByDay(tasks: readonly CronTask[], range: TimeRange, now: number): Map<string, DayRuns[]> {
  const days = new Map<string, DayRuns[]>()
  for (const task of tasks) {
    let key = ''
    let current: DayRuns | null = null
    for (const at of upcomingRuns(task, range, now)) {
      const dayKey = localDateKey(new Date(at))
      if (!current || dayKey !== key) {
        key = dayKey
        current = { task, times: [], count: 0 }
        const list = days.get(dayKey)
        if (list) list.push(current)
        else days.set(dayKey, [current])
      }
      current.count += 1
      if (current.times.length < RUN_TIMES_KEPT) current.times.push(at)
    }
  }
  for (const list of days.values()) {
    list.sort((a, b) => a.times[0]! - b.times[0]! || a.task.name.localeCompare(b.task.name) || a.task.id.localeCompare(b.task.id))
  }
  return days
}
