import { describe, expect, it } from 'vitest'

import { localDateKey } from '@/features/tokenUsage/heatmapModel'
import type { CronTask } from '@/types/task'
import {
  formatClock,
  GRID_DAYS,
  monthGrid,
  parseCronFields,
  RUN_TIMES_KEPT,
  runsByDay,
  shiftMonth,
  upcomingRuns,
} from './taskOccurrences'

/**
 * Times are built on the host clock (`new Date(y, m, d, h, min)`) so these
 * cases hold in any zone the suite runs in. The zone cases pin explicit IANA
 * zones and compare UTC instants instead. Dates avoid DST transitions unless
 * the case is about one.
 */
function at(month: number, day: number, hour = 0, minute = 0, year = 2026): number {
  return new Date(year, month - 1, day, hour, minute).getTime()
}

function between(fromMonth: number, fromDay: number, toMonth: number, toDay: number) {
  return { start: at(fromMonth, fromDay), end: at(toMonth, toDay) }
}

/** Wednesday 15 July 2026, 10:30. */
const NOW = at(7, 15, 10, 30)

function task(overrides: Partial<CronTask> = {}): CronTask {
  return {
    id: 'task',
    name: 'Task',
    cron: '0 9 * * *',
    prompt: 'Run it',
    enabled: true,
    recurring: true,
    createdAt: 0,
    ...overrides,
  }
}

const range = (from: number, to: number) => Array.from({ length: to - from + 1 }, (_, index) => from + index)

describe('parseCronFields', () => {
  it('expands wildcards, lists, ranges and steps', () => {
    expect(parseCronFields('*/15 9-17 * * 1-5')).toEqual({
      minutes: [0, 15, 30, 45],
      hours: range(9, 17),
      daysOfMonth: range(1, 31),
      months: range(1, 12),
      daysOfWeek: [1, 2, 3, 4, 5],
    })
    expect(parseCronFields('0,30 8 1,15 */3 *')).toEqual({
      minutes: [0, 30],
      hours: [8],
      daysOfMonth: [1, 15],
      months: [1, 4, 7, 10],
      daysOfWeek: range(0, 6),
    })
  })

  it('steps through a range, and from a start value to the end of the field', () => {
    expect(parseCronFields('5-20/5 * * * *')?.minutes).toEqual([5, 10, 15, 20])
    expect(parseCronFields('10/20 * * * *')?.minutes).toEqual([10, 30, 50])
    expect(parseCronFields('0 1-10/3 * * *')?.hours).toEqual([1, 4, 7, 10])
  })

  it('reads 7 as Sunday, alone and at the end of a range', () => {
    expect(parseCronFields('0 9 * * 7')?.daysOfWeek).toEqual([0])
    expect(parseCronFields('0 9 * * 5-7')?.daysOfWeek).toEqual([0, 5, 6])
  })

  it.each([
    '',
    '0 9 * *',
    '0 0 9 * * *',
    '60 * * * *',
    '* 24 * * *',
    '* * 0 * *',
    '* * * 13 *',
    '* * * * 8',
    '5-1 * * * *',
    '*/0 * * * *',
    '0 9 L * *',
    '0 9 * * MON',
    '0 9 ? * *',
    '0 9 1,,2 * *',
  ])('rejects %j, which the scheduler would not run either', (expression) => {
    expect(parseCronFields(expression)).toBeNull()
  })
})

describe('month grid', () => {
  it('starts on the Monday on or before the 1st and always shows six weeks', () => {
    const july = monthGrid({ year: 2026, month: 6 })
    expect(july).toHaveLength(GRID_DAYS)
    expect(july[0]).toEqual(new Date(2026, 5, 29))
    expect(july[GRID_DAYS - 1]).toEqual(new Date(2026, 7, 9))
    expect(july.every((day, index) => day.getDay() === (index + 1) % 7)).toBe(true)

    // A month that starts on a Monday leads with its own 1st; one that starts on a Sunday leads with six days of the last.
    expect(monthGrid({ year: 2026, month: 5 })[0]).toEqual(new Date(2026, 5, 1))
    expect(monthGrid({ year: 2026, month: 1 })[0]).toEqual(new Date(2026, 0, 26))
  })

  it('turns months across a year boundary', () => {
    expect(shiftMonth({ year: 2026, month: 11 }, 1)).toEqual({ year: 2027, month: 0 })
    expect(shiftMonth({ year: 2026, month: 0 }, -1)).toEqual({ year: 2025, month: 11 })
  })
})

describe('upcomingRuns', () => {
  it('lists daily runs from now on, leaving out one that already ran today', () => {
    expect(upcomingRuns(task({ cron: '0 9 * * *' }), between(7, 15, 7, 18), NOW)).toEqual([at(7, 16, 9), at(7, 17, 9)])
    expect(upcomingRuns(task({ cron: '0 14 * * *' }), between(7, 15, 7, 17), NOW)).toEqual([at(7, 15, 14), at(7, 16, 14)])
  })

  it('does not count the minute that is firing right now as upcoming', () => {
    expect(upcomingRuns(task(), between(7, 15, 7, 17), at(7, 15, 9) + 30_000)).toEqual([at(7, 16, 9)])
  })

  it('keeps a weekday schedule to Monday through Friday', () => {
    expect(upcomingRuns(task({ cron: '30 8 * * 1-5' }), between(7, 20, 7, 27), NOW))
      .toEqual([20, 21, 22, 23, 24].map((day) => at(7, day, 8, 30)))
  })

  it('expands a minute step inside an hour range', () => {
    expect(upcomingRuns(task({ cron: '*/15 9-10 * * *' }), between(7, 16, 7, 17), NOW))
      .toEqual([0, 15, 30, 45].flatMap((minute) => [at(7, 16, 9, minute), at(7, 16, 10, minute)]).sort((a, b) => a - b))
  })

  it('requires day-of-month and day-of-week to both match, as the desktop scheduler does', () => {
    // Classic cron would fire on every 13th and every Friday; the scheduler only on Friday the 13th.
    const year = { start: at(1, 1), end: at(1, 1, 0, 0, 2027) }
    expect(upcomingRuns(task({ cron: '0 9 13 * 5' }), year, at(1, 1))).toEqual([at(2, 13, 9), at(3, 13, 9), at(11, 13, 9)])
  })

  it('keeps to the months the schedule names', () => {
    const year = { start: at(1, 1), end: at(1, 1, 0, 0, 2027) }
    expect(upcomingRuns(task({ cron: '0 0 1 1,7 *' }), year, at(12, 31, 12, 0, 2025))).toEqual([at(1, 1), at(7, 1)])
  })

  it('gives a cron task that does not recur only its first match', () => {
    // The scheduler switches a non-recurring task off after it fires once.
    for (const recurring of [false, undefined]) {
      const oneShot = task({ recurring })
      expect(upcomingRuns(oneShot, between(7, 15, 8, 1), NOW)).toEqual([at(7, 16, 9)])
      expect(upcomingRuns(oneShot, between(7, 20, 8, 1), NOW)).toEqual([])
    }
  })

  it('places a one-time task once, while it is still ahead', () => {
    const runAt = new Date(at(7, 22, 14)).toISOString()
    const once = task({ cron: '', recurring: false, schedule: { kind: 'once', runAt, timeZone: 'UTC' } })
    expect(upcomingRuns(once, between(7, 1, 8, 1), NOW)).toEqual([at(7, 22, 14)])
    expect(upcomingRuns(once, between(7, 1, 7, 22), NOW)).toEqual([])
    expect(upcomingRuns(once, between(7, 1, 8, 1), at(7, 22, 15))).toEqual([])
    expect(upcomingRuns({ ...once, enabled: false, scheduleState: 'completed' }, between(7, 1, 8, 1), NOW)).toEqual([])
  })

  it('still places a paused task, which the calendar shows dimmed', () => {
    expect(upcomingRuns(task({ enabled: false, scheduleState: 'paused' }), between(7, 15, 7, 17), NOW)).toEqual([at(7, 16, 9)])
  })

  it('has nothing to show for a schedule it cannot read', () => {
    expect(upcomingRuns(task({ cron: 'every morning' }), between(7, 15, 7, 17), NOW)).toEqual([])
    const unknownZone = task({ schedule: { kind: 'cron', expression: '0 9 * * *', timeZone: 'Mars/Olympus_Mons' } })
    expect(upcomingRuns(unknownZone, between(7, 15, 7, 17), NOW)).toEqual([])
    expect(upcomingRuns(task(), between(7, 15, 7, 17), Number.NaN)).toEqual([])
  })
})

describe('schedules in their own time zone', () => {
  const tokyo = task({ schedule: { kind: 'cron', expression: '0 9 * * *', timeZone: 'Asia/Tokyo' } })
  // 09:30 in Tokyo on 15 July, so that day's 09:00 run is already over.
  const tokyoNow = Date.UTC(2026, 6, 15, 0, 30)
  const tokyoRange = { start: Date.UTC(2026, 6, 15), end: Date.UTC(2026, 6, 18) }

  it('reads the cron fields on the zone clock, not the host one', () => {
    expect(upcomingRuns(tokyo, tokyoRange, tokyoNow)).toEqual([Date.UTC(2026, 6, 16, 0, 0), Date.UTC(2026, 6, 17, 0, 0)])
  })

  it('files each run under the host-local day it lands on', () => {
    const days = runsByDay([tokyo], tokyoRange, tokyoNow)
    expect([...days.keys()]).toEqual([
      localDateKey(new Date(Date.UTC(2026, 6, 16, 0, 0))),
      localDateKey(new Date(Date.UTC(2026, 6, 17, 0, 0))),
    ])
  })

  it('skips a wall time that a spring-forward gap removes', () => {
    // New York moved from 02:00 straight to 03:00 on 8 March 2026.
    const nightly = task({ schedule: { kind: 'cron', expression: '30 2 * * *', timeZone: 'America/New_York' } })
    const runs = upcomingRuns(nightly, { start: Date.UTC(2026, 2, 7), end: Date.UTC(2026, 2, 10) }, Date.UTC(2026, 2, 6, 12))
    expect(runs).toEqual([Date.UTC(2026, 2, 7, 7, 30), Date.UTC(2026, 2, 9, 6, 30)])
  })
})

describe('runsByDay', () => {
  it('lists each task once per day, ordered by its first run that day', () => {
    const everyTwoHours = task({ id: 'b', name: 'Every two hours', cron: '0 8-20/2 * * *' })
    const morning = task({ id: 'a', name: 'Morning', cron: '0 7 * * *' })
    const day = runsByDay([everyTwoHours, morning], between(7, 16, 7, 17), NOW).get(localDateKey(new Date(2026, 6, 16)))
    expect(day?.map((entry) => [entry.task.id, entry.count])).toEqual([['a', 1], ['b', 7]])
    expect(day?.[1]?.times).toEqual([8, 10, 12, 14, 16, 18, 20].map((hour) => at(7, 16, hour)))
  })

  it('counts every run but keeps only the first few times', () => {
    const [entry] = runsByDay([task({ cron: '* * * * *' })], between(7, 16, 7, 17), NOW).get('2026-07-16') ?? []
    expect(entry?.count).toBe(1440)
    expect(entry?.times).toHaveLength(RUN_TIMES_KEPT)
    expect(entry?.times[0]).toBe(at(7, 16, 0, 0))
  })

  it('leaves the days that are over empty', () => {
    expect([...runsByDay([task()], between(7, 1, 7, 18), NOW).keys()]).toEqual(['2026-07-16', '2026-07-17'])
  })
})

it('prints run times on the 24-hour host clock', () => {
  expect(formatClock(at(7, 16, 9, 5))).toBe('09:05')
  expect(formatClock(at(7, 16, 18, 30))).toBe('18:30')
})
