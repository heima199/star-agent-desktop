import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import '@testing-library/jest-dom'

vi.mock('../../i18n', () => ({
  useTranslation: () => (key: string) => ({
    'ideLaunch.label': 'IDE',
    'ideLaunch.title': 'Open this project in STAR Code',
    'ideLaunch.notInstalled': 'STAR Code is not installed',
    'ideLaunch.openFailed': 'Could not open STAR Code',
  }[key] ?? key),
}))

const apiMocks = vi.hoisted(() => ({
  list: vi.fn(),
  listForPath: vi.fn(),
  open: vi.fn(),
}))

vi.mock('../../api/openTargets', () => ({ openTargetsApi: apiMocks }))

import { useOpenTargetStore } from '../../stores/openTargetStore'
import { useUIStore } from '../../stores/uiStore'
import { IdeLaunchButton, STAR_CODE_TARGET_ID } from './IdeLaunchButton'

const starCode = { id: STAR_CODE_TARGET_ID, kind: 'ide' as const, label: 'STAR Code', icon: 'star-code', platform: 'win32' }
const explorer = { id: 'explorer', kind: 'file_manager' as const, label: 'Explorer', icon: 'folder', platform: 'win32' }

function listResult(targets: Array<typeof starCode | typeof explorer>) {
  return { platform: 'win32', targets, primaryTargetId: targets[0]?.id ?? null, cachedAt: 0, ttlMs: 30_000 }
}

describe('IdeLaunchButton', () => {
  beforeEach(() => {
    apiMocks.list.mockReset()
    apiMocks.open.mockReset()
    // The store caches targets for a minute; every case starts from an empty list.
    useOpenTargetStore.setState({ targets: [], fetchedAt: 0, loading: false, error: null, primaryTargetId: null, lastSuccessfulTargetId: null })
    useUIStore.setState({ toasts: [] })
  })

  it('opens the current project in the STAR Code window', async () => {
    apiMocks.list.mockResolvedValue(listResult([starCode, explorer]))
    apiMocks.open.mockResolvedValue({ ok: true, targetId: STAR_CODE_TARGET_ID, path: 'D:\\repo' })

    render(<IdeLaunchButton path="D:\repo" />)
    const button = screen.getByRole('button', { name: 'IDE' })
    expect(button).toHaveAttribute('title', 'Open this project in STAR Code')

    fireEvent.click(button)

    await waitFor(() => expect(apiMocks.open).toHaveBeenCalledWith(STAR_CODE_TARGET_ID, 'D:\\repo'))
    expect(useUIStore.getState().toasts).toEqual([])
  })

  it('opens just the IDE when there is no project yet', async () => {
    apiMocks.list.mockResolvedValue(listResult([starCode, explorer]))
    apiMocks.open.mockResolvedValue({ ok: true, targetId: STAR_CODE_TARGET_ID, path: '' })
    render(<IdeLaunchButton path="" />)
    fireEvent.click(screen.getByRole('button', { name: 'IDE' }))
    await waitFor(() => expect(apiMocks.open).toHaveBeenCalledWith(STAR_CODE_TARGET_ID, ''))
    expect(useUIStore.getState().toasts).toEqual([])
  })

  it('says STAR Code is missing instead of launching another editor', async () => {
    apiMocks.list.mockResolvedValue(listResult([explorer]))

    render(<IdeLaunchButton path="D:\repo" />)
    fireEvent.click(screen.getByRole('button', { name: 'IDE' }))

    await waitFor(() => expect(useUIStore.getState().toasts).toHaveLength(1))
    expect(useUIStore.getState().toasts[0]).toMatchObject({ type: 'warning', message: 'STAR Code is not installed' })
    expect(apiMocks.open).not.toHaveBeenCalled()
  })

  it('reports a launch the server rejected', async () => {
    apiMocks.list.mockResolvedValue(listResult([starCode, explorer]))
    apiMocks.open.mockRejectedValue(new Error('Failed to launch open target: star-code'))

    render(<IdeLaunchButton path="D:\repo" />)
    fireEvent.click(screen.getByRole('button', { name: 'IDE' }))

    await waitFor(() => expect(useUIStore.getState().toasts).toHaveLength(1))
    expect(useUIStore.getState().toasts[0]).toMatchObject({ type: 'error', message: 'Could not open STAR Code' })
    // The button comes back once the attempt settles, so the user can retry.
    await waitFor(() => expect(screen.getByRole('button', { name: 'IDE' })).not.toBeDisabled())
  })
})
