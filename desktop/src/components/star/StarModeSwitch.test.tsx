import { fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import '@testing-library/jest-dom'

const pageMocks = vi.hoisted(() => ({ openStarPage: vi.fn() }))
vi.mock('./starPages', () => ({ openStarPage: pageMocks.openStarPage }))

import { useStarStore } from '../../stores/starStore'
import { useUIStore } from '../../stores/uiStore'
import { STAR_MODES, StarModeSwitch } from './StarModeSwitch'

const MODE_STORAGE_KEY = 'cc-haha.star.mode'

describe('StarModeSwitch', () => {
  const requestNewSession = vi.fn()
  const originalRequestNewSession = useUIStore.getState().requestNewSession

  beforeEach(() => {
    pageMocks.openStarPage.mockReset()
    requestNewSession.mockReset()
    useUIStore.setState({ requestNewSession })
    useStarStore.setState({ mode: 'work' })
  })

  afterEach(() => {
    useUIStore.setState({ requestNewSession: originalRequestNewSession })
    window.localStorage.removeItem(MODE_STORAGE_KEY)
  })

  it('offers Work, Code and Design in a rounded pill, without Chat', () => {
    render(<StarModeSwitch collapsed={false} />)

    const group = screen.getByRole('radiogroup', { name: '工作模式' })
    expect(within(group).getAllByRole('radio').map((radio) => radio.textContent)).toEqual(['Work', 'Code', 'Design'])
    expect(group).toHaveClass('grid-cols-3', 'rounded-[var(--radius-full)]')
    for (const radio of within(group).getAllByRole('radio')) {
      expect(radio).toHaveClass('rounded-[var(--radius-full)]')
    }
    expect(within(group).getByRole('radio', { name: 'Work' })).toHaveAttribute('aria-checked', 'true')
    expect(STAR_MODES.map((mode) => mode.value)).toEqual(['work', 'code', 'design'])
  })

  it('opens the Design page for Design and the new-session page for the others', () => {
    render(<StarModeSwitch collapsed={false} />)

    fireEvent.click(screen.getByRole('radio', { name: 'Design' }))
    expect(useStarStore.getState().mode).toBe('design')
    expect(pageMocks.openStarPage).toHaveBeenCalledWith('design')
    expect(requestNewSession).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('radio', { name: 'Code' }))
    expect(useStarStore.getState().mode).toBe('code')
    expect(requestNewSession).toHaveBeenCalledTimes(1)
    expect(window.localStorage.getItem(MODE_STORAGE_KEY)).toBe('code')
  })

  it('cycles through the three modes from the collapsed button', () => {
    useStarStore.setState({ mode: 'design' })
    render(<StarModeSwitch collapsed />)

    fireEvent.click(screen.getByRole('button', { name: '当前 Design，切换到 Work' }))
    expect(useStarStore.getState().mode).toBe('work')
  })

  it('lands a stored retired Chat mode on Work', async () => {
    window.localStorage.setItem(MODE_STORAGE_KEY, 'chat')
    vi.resetModules()
    const { useStarStore: freshStore } = await import('../../stores/starStore')
    expect(freshStore.getState().mode).toBe('work')

    window.localStorage.setItem(MODE_STORAGE_KEY, 'design')
    vi.resetModules()
    const { useStarStore: designStore } = await import('../../stores/starStore')
    expect(designStore.getState().mode).toBe('design')
  })
})
