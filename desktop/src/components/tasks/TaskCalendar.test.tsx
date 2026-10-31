import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import '@testing-library/jest-dom'

import { TaskCalendar } from './TaskCalendar'
import { useSettingsStore } from '@/stores/settingsStore'
import { useTaskStore } from '@/stores/taskStore'
import type { CronTask } from '@/types/task'

/** Wednesday 15 July 2026, 10:30 on the host clock. Only `Date` is faked. */
const NOW = new Date(2026, 6, 15, 10, 30)

function task(id: string, name: string, overrides: Partial<CronTask> = {}): CronTask {
  return { id, name, cron: '0 9 * * *', prompt: name, enabled: true, recurring: true, createdAt: 0, ...overrides }
}

const weekly = task('weekly', 'Weekly review', { cron: '0 9 * * 1' })
const launch = task('launch', 'Launch check', {
  cron: '',
  recurring: false,
  schedule: { kind: 'once', runAt: new Date(2026, 6, 22, 14, 0).toISOString(), timeZone: 'UTC' },
})
const pausedDigest = task('digest', 'Paused digest', { cron: '30 18 * * *', enabled: false, scheduleState: 'paused' })

/** The grid cell whose date button is named after `date`, e.g. "Monday, July 20, 2026". */
function dayCell(date: string): HTMLElement {
  const button = within(screen.getByRole('grid')).getByRole('button', { name: new RegExp(`^${date}`) })
  return button.closest('[role="gridcell"]') as HTMLElement
}

function dayPanel(): HTMLElement {
  return screen.getByRole('heading', { level: 3 }).closest('section') as HTMLElement
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(NOW)
  useSettingsStore.setState({ locale: 'en' })
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  useSettingsStore.setState(useSettingsStore.getInitialState(), true)
  useTaskStore.setState(useTaskStore.getInitialState(), true)
})

describe('TaskCalendar', () => {
  it('shows six Monday-first weeks of the current month with today marked and selected', () => {
    render(<TaskCalendar tasks={[]} />)

    const grid = screen.getByRole('grid', { name: 'July 2026' })
    expect(within(grid).getAllByRole('columnheader').map((header) => header.textContent))
      .toEqual(['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'])
    const cells = within(grid).getAllByRole('gridcell')
    expect(cells).toHaveLength(42)
    expect(within(cells[0]!).getByRole('button')).toHaveAccessibleName('Monday, June 29, 2026')
    expect(within(cells[41]!).getByRole('button')).toHaveAccessibleName('Sunday, August 9, 2026')

    const today = within(grid).getByRole('button', { name: 'Wednesday, July 15, 2026' })
    expect(today).toHaveAttribute('aria-current', 'date')
    expect(grid.querySelectorAll('[aria-current="date"]')).toHaveLength(1)
    expect(dayCell('Wednesday, July 15, 2026')).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('heading', { level: 3 })).toHaveTextContent('Wednesday, July 15')
  })

  it('puts each upcoming run on the day it falls on', () => {
    render(<TaskCalendar tasks={[weekly, launch]} />)

    // Mondays still ahead carry the weekly run; the Mondays already gone do not.
    for (const monday of ['Monday, July 20, 2026', 'Monday, July 27, 2026', 'Monday, August 3, 2026']) {
      expect(within(dayCell(monday)).getByRole('button', { name: /Weekly review/ })).toHaveTextContent('09:00')
    }
    for (const past of ['Monday, June 29, 2026', 'Monday, July 13, 2026', 'Wednesday, July 15, 2026']) {
      expect(within(dayCell(past)).queryByRole('button', { name: /Weekly review/ })).not.toBeInTheDocument()
    }
    expect(within(screen.getByRole('grid')).getByRole('button', { name: 'Monday, July 20, 2026, 1 task' })).toBeInTheDocument()

    // A one-time task lands on its own date only.
    expect(within(dayCell('Wednesday, July 22, 2026')).getByRole('button', { name: /Launch check/ })).toHaveTextContent('14:00')
    expect(within(screen.getByRole('grid')).getAllByRole('button', { name: /Launch check/ })).toHaveLength(1)
  })

  it('lists three tasks in a day cell and folds the rest into +N', () => {
    const busy = [11, 12, 13, 14, 15].map((hour) => task(`t${hour}`, `Task ${hour}`, { cron: `0 ${hour} * * *` }))
    render(<TaskCalendar tasks={busy} />)

    const cell = dayCell('Thursday, July 16, 2026')
    expect(within(cell).getAllByRole('button', { name: /Task \d+/ }).map((button) => button.textContent))
      .toEqual(['11:00Task 11', '12:00Task 12', '13:00Task 13'])
    expect(within(cell).getByText('+2 more')).toBeInTheDocument()
    // The day panel is not capped.
    expect(within(dayPanel()).getAllByRole('button')).toHaveLength(5)
  })

  it('shows how many times a frequent task runs that day', () => {
    render(<TaskCalendar tasks={[task('poll', 'Poll inbox', { cron: '0 */2 * * *' })]} />)
    expect(within(dayCell('Thursday, July 16, 2026')).getByRole('button', { name: /Poll inbox/ })).toHaveTextContent('00:00Poll inbox×12')

    fireEvent.click(within(screen.getByRole('grid')).getByRole('button', { name: /^Thursday, July 16, 2026/ }))
    const row = within(dayPanel()).getByRole('button', { name: /Poll inbox/ })
    // The first run leads the row; the later ones follow, eight at most, then a count.
    expect(within(row).getByText('00:00')).toBeInTheDocument()
    expect(within(row).getByText('16:00')).toBeInTheDocument()
    expect(within(row).queryByText('18:00')).not.toBeInTheDocument()
    expect(within(row).getByText('+3 more')).toBeInTheDocument()
  })

  it('turns the month with previous, next and today', () => {
    render(<TaskCalendar tasks={[weekly]} />)

    fireEvent.click(screen.getByRole('button', { name: 'Next month' }))
    expect(screen.getByRole('heading', { level: 2 })).toHaveTextContent('August 2026')
    expect(screen.getByRole('grid', { name: 'August 2026' })).toBeInTheDocument()
    // Today is not in August, so the panel moves to the 1st.
    expect(screen.getByRole('heading', { level: 3 })).toHaveTextContent('Saturday, August 1')
    expect(within(dayCell('Monday, August 10, 2026')).getByRole('button', { name: /Weekly review/ })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Previous month' }))
    fireEvent.click(screen.getByRole('button', { name: 'Previous month' }))
    expect(screen.getByRole('grid', { name: 'June 2026' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { level: 3 })).toHaveTextContent('Monday, June 1')
    expect(within(dayPanel()).getByText('The calendar shows upcoming runs only. For past runs, open the task logs in the list.')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Today' }))
    expect(screen.getByRole('grid', { name: 'July 2026' })).toBeInTheDocument()
    expect(dayCell('Wednesday, July 15, 2026')).toHaveAttribute('aria-selected', 'true')
  })

  it('selects a clicked day and lists its runs underneath, paused ones dimmed', () => {
    render(<TaskCalendar tasks={[weekly, pausedDigest]} />)

    fireEvent.click(within(screen.getByRole('grid')).getByRole('button', { name: /^Monday, July 20, 2026/ }))
    expect(dayCell('Monday, July 20, 2026')).toHaveAttribute('aria-selected', 'true')
    expect(dayCell('Wednesday, July 15, 2026')).toHaveAttribute('aria-selected', 'false')

    const panel = dayPanel()
    expect(within(panel).getByRole('heading', { level: 3 })).toHaveTextContent('Monday, July 20')
    const rows = within(panel).getAllByRole('button')
    expect(rows.map((row) => row.textContent)).toEqual([
      expect.stringContaining('Weekly review'),
      expect.stringContaining('Paused digest'),
    ])
    expect(rows[0]).not.toHaveClass('opacity-50')
    expect(rows[1]).toHaveClass('opacity-50')
    expect(within(rows[1]!).getByText('Disabled')).toBeInTheDocument()
    expect(within(dayCell('Monday, July 20, 2026')).getByRole('button', { name: /Paused digest/ })).toHaveClass('opacity-50')

    // Clicking anywhere in a cell picks it, as the date button does.
    fireEvent.click(dayCell('Friday, July 10, 2026'))
    expect(within(dayPanel()).getByText('The calendar shows upcoming runs only. For past runs, open the task logs in the list.')).toBeInTheDocument()
  })

  it('says so when a coming day has nothing scheduled', () => {
    render(<TaskCalendar tasks={[weekly]} />)
    fireEvent.click(within(screen.getByRole('grid')).getByRole('button', { name: /^Tuesday, July 21, 2026/ }))
    expect(within(dayPanel()).getByText('No runs scheduled for this day.')).toBeInTheDocument()
  })

  it('opens the shared task editor from the grid and from the day panel', () => {
    render(<TaskCalendar tasks={[weekly]} />)

    fireEvent.click(within(dayCell('Monday, July 20, 2026')).getByRole('button', { name: /Weekly review/ }))
    expect(useTaskStore.getState().editorTaskId).toBe('weekly')
    // Opening a task is not picking its day.
    expect(dayCell('Wednesday, July 15, 2026')).toHaveAttribute('aria-selected', 'true')

    act(() => useTaskStore.getState().closeTaskEditor())
    expect(useTaskStore.getState().editorTaskId).toBeNull()
    fireEvent.click(within(screen.getByRole('grid')).getByRole('button', { name: /^Monday, July 20, 2026/ }))
    fireEvent.click(within(dayPanel()).getByRole('button', { name: /Weekly review/ }))
    expect(useTaskStore.getState().editorTaskId).toBe('weekly')
  })

  it('moves the selection with the arrow keys and turns the month past the last week', () => {
    render(<TaskCalendar tasks={[]} />)
    const grid = screen.getByRole('grid')
    // One tab stop for the whole grid.
    expect(within(grid).getAllByRole('button').filter((button) => button.tabIndex === 0)).toHaveLength(1)

    const today = within(grid).getByRole('button', { name: 'Wednesday, July 15, 2026' })
    today.focus()
    fireEvent.keyDown(today, { key: 'ArrowRight' })
    expect(dayCell('Thursday, July 16, 2026')).toHaveAttribute('aria-selected', 'true')
    expect(document.activeElement).toHaveAccessibleName('Thursday, July 16, 2026')
    expect(document.activeElement).toHaveAttribute('tabindex', '0')

    // 23 and 30 July and 6 August are still in July's six weeks; 13 August is not.
    for (let press = 0; press < 3; press++) fireEvent.keyDown(document.activeElement!, { key: 'ArrowDown' })
    expect(screen.getByRole('grid', { name: 'July 2026' })).toBeInTheDocument()
    expect(document.activeElement).toHaveAccessibleName('Thursday, August 6, 2026')
    fireEvent.keyDown(document.activeElement!, { key: 'ArrowDown' })
    expect(screen.getByRole('grid', { name: 'August 2026' })).toBeInTheDocument()
    expect(document.activeElement).toHaveAccessibleName('Thursday, August 13, 2026')
  })

  it('reads in Chinese', () => {
    useSettingsStore.setState({ locale: 'zh' })
    render(<TaskCalendar tasks={[weekly]} />)

    expect(screen.getByRole('grid', { name: '2026年7月' })).toBeInTheDocument()
    expect(screen.getAllByRole('columnheader').map((header) => header.textContent))
      .toEqual(['周一', '周二', '周三', '周四', '周五', '周六', '周日'])
    expect(screen.getByRole('button', { name: '今天' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '上个月' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '下个月' })).toBeInTheDocument()
    expect(within(screen.getByRole('grid')).getByRole('button', { name: /^2026年7月20日星期一，1 个任务$/ })).toBeInTheDocument()
    expect(within(dayPanel()).getByText('这一天没有待运行的任务。')).toBeInTheDocument()
  })
})
