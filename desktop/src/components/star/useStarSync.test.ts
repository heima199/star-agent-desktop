import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { starApi, type StarStatus } from '@/api/star'
import { useStarStore } from '@/stores/starStore'
import { useStarSync } from './useStarSync'

const initialStarState = useStarStore.getState()

function starStatus(patch: Partial<StarStatus> = {}): StarStatus {
  return {
    configured: true,
    baseUrl: '',
    signedIn: false,
    user: null,
    provider: { id: null, active: false, relayReady: false, mainModel: null },
    catalog: { fetchedAt: null, chatModels: 0, imageModels: 0, videoModels: 0 },
    starWorkSignInAvailable: false,
    ...patch,
  }
}

const SIGNED_OUT = starStatus()
const SIGNED_IN = starStatus({ signedIn: true, user: { id: 'u1', nickname: '测试用户' } as StarStatus['user'] })

function focusWindow() {
  act(() => { window.dispatchEvent(new Event('focus')) })
}

beforeEach(() => {
  vi.spyOn(starApi, 'tasks').mockResolvedValue({ tasks: [], running: 0 } as never)
  vi.spyOn(starApi, 'quota').mockResolvedValue({ planName: '免费版', planTier: 'free', credits: 0, expiresAt: null } as never)
  vi.spyOn(starApi, 'catalog').mockResolvedValue({ catalog: null } as never)
})

afterEach(() => {
  cleanup()
  useStarStore.setState(initialStarState)
  vi.restoreAllMocks()
})

describe('sign-in at startup', () => {
  it('opens once the startup status is known to be signed out, and only once per launch', async () => {
    const status = vi.spyOn(starApi, 'status').mockResolvedValue(SIGNED_OUT)
    const { unmount } = renderHook(() => useStarSync(true))
    await waitFor(() => expect(useStarStore.getState().loginOpen).toBe(true))

    // 「暂不登录」 and Esc both close the screen through closeLogin.
    act(() => useStarStore.getState().closeLogin())
    focusWindow()
    await waitFor(() => expect(status).toHaveBeenCalledTimes(2))
    await act(async () => {})
    expect(useStarStore.getState().loginOpen).toBe(false)

    // The shell mounting the sync again in the same launch does not reopen it.
    unmount()
    renderHook(() => useStarSync(true))
    await waitFor(() => expect(status).toHaveBeenCalledTimes(3))
    await act(async () => {})
    expect(useStarStore.getState().loginOpen).toBe(false)
  })

  it('waits while the status is still loading', async () => {
    let answer: (status: StarStatus) => void = () => {}
    vi.spyOn(starApi, 'status').mockReturnValue(new Promise<StarStatus>((resolve) => { answer = resolve }))
    renderHook(() => useStarSync(true))
    await act(async () => {})
    expect(useStarStore.getState().loginOpen).toBe(false)
    expect(useStarStore.getState().startupLoginHandled).toBe(false)

    await act(async () => { answer(SIGNED_OUT) })
    await waitFor(() => expect(useStarStore.getState().loginOpen).toBe(true))
  })

  it('stays closed when the launch starts signed in, even after a later sign-out', async () => {
    const status = vi.spyOn(starApi, 'status').mockResolvedValue(SIGNED_IN)
    renderHook(() => useStarSync(true))
    await waitFor(() => expect(useStarStore.getState().startupLoginHandled).toBe(true))
    expect(useStarStore.getState().loginOpen).toBe(false)

    status.mockResolvedValue(SIGNED_OUT)
    focusWindow()
    await waitFor(() => expect(status).toHaveBeenCalledTimes(2))
    await act(async () => {})
    expect(useStarStore.getState().loginOpen).toBe(false)
  })

  it('stays closed when STAR is not configured', async () => {
    vi.spyOn(starApi, 'status').mockResolvedValue(starStatus({ configured: false }))
    renderHook(() => useStarSync(true))
    await waitFor(() => expect(useStarStore.getState().startupLoginHandled).toBe(true))
    expect(useStarStore.getState().loginOpen).toBe(false)
  })

  it('leaves the decision to the next answer when the startup status cannot be read', async () => {
    const status = vi.spyOn(starApi, 'status').mockRejectedValueOnce(new Error('offline')).mockResolvedValue(SIGNED_OUT)
    renderHook(() => useStarSync(true))
    await waitFor(() => expect(useStarStore.getState().statusError).not.toBeNull())
    expect(useStarStore.getState().loginOpen).toBe(false)
    expect(useStarStore.getState().startupLoginHandled).toBe(false)

    focusWindow()
    await waitFor(() => expect(useStarStore.getState().loginOpen).toBe(true))
    expect(status).toHaveBeenCalledTimes(2)
  })

  it('does nothing before the shell is ready', async () => {
    const status = vi.spyOn(starApi, 'status').mockResolvedValue(SIGNED_OUT)
    renderHook(() => useStarSync(false))
    await act(async () => {})
    expect(status).not.toHaveBeenCalled()
    expect(useStarStore.getState().loginOpen).toBe(false)
  })
})
