import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import '@testing-library/jest-dom'
import { NewSessionStarter } from './NewSessionStarter'
import { useSessionStore } from '../../stores/sessionStore'
import { useSettingsStore } from '../../stores/settingsStore'
import { useStarStore } from '../../stores/starStore'
import type { SessionListItem } from '../../types/session'

const NOW = Date.now()

function session(id: string, minutesAgo: number): SessionListItem {
  const at = new Date(NOW - minutesAgo * 60_000).toISOString()
  return {
    id,
    title: id,
    createdAt: at,
    modifiedAt: at,
    messageCount: 3,
    projectPath: '/workspace/alpha',
    projectRoot: '/workspace/alpha',
    workDir: '/workspace/alpha',
    workDirExists: true,
  }
}

describe('NewSessionStarter', () => {
  beforeEach(() => {
    useSettingsStore.setState({ locale: 'en' })
    // The generic starters are Code mode's; the other STAR modes show task templates.
    useStarStore.setState({ mode: 'code' })
    useSessionStore.setState({
      sessions: [session('Fix login', 3), session('Write docs', 90)],
    } as Partial<ReturnType<typeof useSessionStore.getState>>)
  })

  afterEach(() => {
    cleanup()
    useStarStore.setState({ mode: 'work' })
    vi.clearAllMocks()
  })

  it('hands a starter’s words to the caller, which owns the draft', () => {
    const onSuggestion = vi.fn()
    render(<NewSessionStarter onSuggestion={onSuggestion} />)

    const group = screen.getByRole('group', { name: 'Suggestions' })
    const chips = within(group).getAllByRole('button')
    expect(chips.map((chip) => chip.textContent)).toEqual([
      'Explain how this repo is structured',
      'Fix the failing tests',
      'Review my uncommitted changes',
      'Build a new feature',
    ])

    fireEvent.click(chips[2]!)
    expect(onSuggestion).toHaveBeenCalledWith('Review my uncommitted changes')
  })

  // 移除首页的最近会话: earlier threads stay in the sidebar only.
  it('lists no recent sessions on the home page, even when the project has some', () => {
    render(<NewSessionStarter onSuggestion={vi.fn()} />)

    const starter = screen.getByTestId('new-session-starter')
    expect(within(starter).queryByRole('region')).not.toBeInTheDocument()
    expect(within(starter).queryByRole('listitem')).not.toBeInTheDocument()
    expect(starter).not.toHaveTextContent('Recent sessions')
    expect(starter).not.toHaveTextContent('Fix login')
  })
})
