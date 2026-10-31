import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { starApi } from '../api/star'
import { browserHost } from '../lib/desktopHost/browserHost'
import { useStarUpdateStore } from './starUpdateStore'

describe('useStarUpdateStore', () => {
  beforeEach(() => {
    useStarUpdateStore.setState({ latest: null })
    window.desktopHost = { ...browserHost, kind: 'electron', isDesktop: true }
  })

  afterEach(() => {
    Reflect.deleteProperty(window, 'desktopHost')
    vi.restoreAllMocks()
  })

  it('keeps the latest answer for every reader', async () => {
    // The browser host reports 0.1.0 installed.
    vi.spyOn(starApi, 'updateInfo').mockResolvedValue({ version: '1.0.0', downloadUrl: 'https://star.example.com/d', releaseNotes: '', mandatory: false, publishedAt: null })

    const result = await useStarUpdateStore.getState().refresh()

    expect(result.hasUpdate).toBe(true)
    expect(useStarUpdateStore.getState().latest).toEqual(result)
  })

  it('keeps the previous answer when the console cannot answer', async () => {
    const previous = { current: '0.1.0', latest: { version: '1.0.0', downloadUrl: 'https://star.example.com/d', releaseNotes: '', mandatory: false, publishedAt: null }, hasUpdate: true }
    useStarUpdateStore.setState({ latest: previous })
    vi.spyOn(starApi, 'updateInfo').mockRejectedValue(new Error('network down'))

    await expect(useStarUpdateStore.getState().refresh()).rejects.toThrow('network down')
    expect(useStarUpdateStore.getState().latest).toBe(previous)
  })
})
