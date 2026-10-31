import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import '@testing-library/jest-dom'

import { ScheduledTasks } from './ScheduledTasks'
import { useSettingsStore } from '@/stores/settingsStore'
import { useTaskStore } from '@/stores/taskStore'
import type { CronTask } from '@/types/task'

/** The persisted key is part of the contract: renaming it silently resets everyone's choice. */
const VIEW_KEY = 'cc-haha.scheduled.view'

const weekly: CronTask = {
  id: 'weekly',
  name: 'Weekly review',
  cron: '0 9 * * 1',
  prompt: 'Review the week',
  enabled: true,
  recurring: true,
  createdAt: 0,
}

async function renderPage() {
  // `fetchTasks` resolves after mount and flips the page to initialized; keep that inside act().
  await act(async () => {
    render(<ScheduledTasks />)
  })
}

function viewTab(name: 'List' | 'Calendar'): HTMLElement {
  return within(screen.getByRole('tablist', { name: 'View' })).getByRole('tab', { name })
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date(2026, 6, 15, 10, 30))
  localStorage.clear()
  useSettingsStore.setState({ locale: 'en' })
  useTaskStore.setState({ tasks: [weekly], loaded: true, isLoading: false, error: null, fetchTasks: vi.fn(async () => {}) })
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  localStorage.clear()
  useTaskStore.setState(useTaskStore.getInitialState(), true)
  useSettingsStore.setState(useSettingsStore.getInitialState(), true)
})

describe('ScheduledTasks view switch', () => {
  it('opens on the list, with 列表 / 日历 offered as tabs in the header', async () => {
    await renderPage()

    const tabs = screen.getByRole('tablist', { name: 'View' })
    expect(within(tabs).getAllByRole('tab').map((tab) => tab.textContent)).toEqual(['List', 'Calendar'])
    expect(viewTab('List')).toHaveAttribute('aria-selected', 'true')
    expect(viewTab('Calendar')).toHaveAttribute('aria-selected', 'false')
    expect(screen.getByText('Total Tasks')).toBeInTheDocument()
    expect(screen.queryByRole('grid')).not.toBeInTheDocument()
  })

  it('switches to the calendar and keeps it for the next visit', async () => {
    await renderPage()

    fireEvent.click(viewTab('Calendar'))
    expect(viewTab('Calendar')).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('grid', { name: 'July 2026' })).toBeInTheDocument()
    expect(screen.queryByText('Total Tasks')).not.toBeInTheDocument()
    expect(localStorage.getItem(VIEW_KEY)).toBe('calendar')

    cleanup()
    await renderPage()
    expect(viewTab('Calendar')).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('grid', { name: 'July 2026' })).toBeInTheDocument()

    fireEvent.click(viewTab('List'))
    expect(localStorage.getItem(VIEW_KEY)).toBe('list')
    expect(screen.queryByRole('grid')).not.toBeInTheDocument()
    expect(screen.getByText('Total Tasks')).toBeInTheDocument()
  })

  it('reads a stored value it does not know as the list', async () => {
    localStorage.setItem(VIEW_KEY, 'board')
    await renderPage()
    expect(viewTab('List')).toHaveAttribute('aria-selected', 'true')
    expect(screen.queryByRole('grid')).not.toBeInTheDocument()
  })

  // Choosing 日历 with no task used to show the empty state and no calendar.
  it('shows the calendar before the first task, and still invites one', async () => {
    localStorage.setItem(VIEW_KEY, 'calendar')
    useTaskStore.setState({ tasks: [] })
    await renderPage()
    expect(viewTab('Calendar')).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('grid', { name: 'July 2026' })).toBeInTheDocument()
    expect(screen.getByText('No scheduled tasks yet')).toBeInTheDocument()
  })

  it('keeps the list view’s empty state without a calendar', async () => {
    useTaskStore.setState({ tasks: [] })
    await renderPage()
    expect(viewTab('List')).toHaveAttribute('aria-selected', 'true')
    expect(screen.queryByRole('grid')).not.toBeInTheDocument()
    expect(screen.getByText('No scheduled tasks yet')).toBeInTheDocument()
  })

  it('opens the same task editor the list uses from a run on the calendar', async () => {
    localStorage.setItem(VIEW_KEY, 'calendar')
    await renderPage()

    const monday = within(screen.getByRole('grid')).getByRole('button', { name: /^Monday, July 20, 2026/ })
    const cell = monday.closest('[role="gridcell"]') as HTMLElement
    fireEvent.click(within(cell).getByRole('button', { name: /Weekly review/ }))
    expect(useTaskStore.getState().editorTaskId).toBe('weekly')
  })
})
