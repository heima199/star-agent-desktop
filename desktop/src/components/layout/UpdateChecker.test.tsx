import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import '@testing-library/jest-dom'

import { UpdateChecker } from './UpdateChecker'
import { starApi, type StarUpdateInfo } from '../../api/star'
import { browserHost } from '../../lib/desktopHost/browserHost'
import { useSettingsStore } from '../../stores/settingsStore'
import { useStarUpdateStore } from '../../stores/starUpdateStore'

const DISMISS_KEY = 'star.update.dismissed'
/** UpdateChecker waits this long after launch before asking the console. */
const STARTUP_DELAY_MS = 8_000
/** ...and then asks again this often. */
const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000

/** The browser host reports 0.1.0 installed. */
const NEWER_RELEASE: StarUpdateInfo = {
  version: '0.2.0',
  downloadUrl: 'https://star.example.com/download/0.2.0',
  releaseNotes: '新增运行时页面',
  mandatory: false,
  publishedAt: null,
}

const shellOpen = vi.fn()

/** Let the check's promise chain run to completion inside act. */
async function settle() {
  await act(async () => {
    for (let tick = 0; tick < 20; tick += 1) await Promise.resolve()
  })
}

async function passStartupDelay() {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(STARTUP_DELAY_MS)
  })
  await settle()
}

describe('UpdateChecker', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    window.localStorage.removeItem(DISMISS_KEY)
    shellOpen.mockReset()
    shellOpen.mockResolvedValue(undefined)
    window.desktopHost = {
      ...browserHost,
      kind: 'electron',
      isDesktop: true,
      shell: { ...browserHost.shell, open: shellOpen },
    }
    useSettingsStore.setState({ locale: 'zh', autoUpdateEnabled: true })
    useStarUpdateStore.setState({ latest: null })
    vi.spyOn(starApi, 'updateInfo').mockResolvedValue(NEWER_RELEASE)
  })

  afterEach(() => {
    cleanup()
    window.localStorage.removeItem(DISMISS_KEY)
    Reflect.deleteProperty(window, 'desktopHost')
    vi.restoreAllMocks()
    vi.useRealTimers()
  })

  it('asks the STAR console only after the startup delay, then announces the release', async () => {
    render(<UpdateChecker />)

    await act(async () => {
      await vi.advanceTimersByTimeAsync(STARTUP_DELAY_MS - 1)
    })
    expect(starApi.updateInfo).not.toHaveBeenCalled()

    await passStartupDelay()

    expect(starApi.updateInfo).toHaveBeenCalledOnce()
    const notice = screen.getByRole('status')
    expect(notice).toHaveTextContent('发现新版本 0.2.0')
    expect(notice).toHaveTextContent('新增运行时页面')
  })

  it('opens the download page and does not announce the same version again', async () => {
    const { unmount } = render(<UpdateChecker />)
    await passStartupDelay()

    fireEvent.click(screen.getByRole('button', { name: '下载新版本' }))

    expect(shellOpen).toHaveBeenCalledWith('https://star.example.com/download/0.2.0')
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
    expect(window.localStorage.getItem(DISMISS_KEY)).toBe('0.2.0')

    // Next launch: the console still publishes 0.2.0.
    unmount()
    render(<UpdateChecker />)
    await passStartupDelay()
    expect(starApi.updateInfo).toHaveBeenCalledTimes(2)
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })

  it('keeps a dismissed version quiet but announces a newer one', async () => {
    const { unmount } = render(<UpdateChecker />)
    await passStartupDelay()

    // The header close button and the 稍后 action both dismiss.
    const [later] = screen.getAllByRole('button', { name: '稍后' })
    fireEvent.click(later!)
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
    expect(shellOpen).not.toHaveBeenCalled()

    unmount()
    vi.mocked(starApi.updateInfo).mockResolvedValue({ ...NEWER_RELEASE, version: '0.3.0', downloadUrl: 'https://star.example.com/download/0.3.0' })
    render(<UpdateChecker />)
    await passStartupDelay()

    expect(screen.getByRole('status')).toHaveTextContent('发现新版本 0.3.0')
  })

  it('puts a mandatory release off for this run only, ignoring an earlier dismissal', async () => {
    window.localStorage.setItem(DISMISS_KEY, '0.2.0')
    vi.mocked(starApi.updateInfo).mockResolvedValue({ ...NEWER_RELEASE, mandatory: true })

    const { unmount } = render(<UpdateChecker />)
    await passStartupDelay()

    expect(screen.getByRole('status')).toHaveTextContent('发现新版本 0.2.0（需要更新）')
    expect(screen.getByRole('button', { name: '下载新版本' })).toBeInTheDocument()
    fireEvent.click(screen.getAllByRole('button', { name: '稍后' })[0]!)
    expect(screen.queryByRole('status')).not.toBeInTheDocument()

    // The 6-hourly check of the same run stays quiet...
    await act(async () => {
      await vi.advanceTimersByTimeAsync(CHECK_INTERVAL_MS)
    })
    await settle()
    expect(starApi.updateInfo).toHaveBeenCalledTimes(2)
    expect(screen.queryByRole('status')).not.toBeInTheDocument()

    // ...and the next start asks again.
    unmount()
    render(<UpdateChecker />)
    await passStartupDelay()
    expect(screen.getByRole('status')).toHaveTextContent('发现新版本 0.2.0')
  })

  it('checks again every 6 hours and announces a release published in between', async () => {
    vi.mocked(starApi.updateInfo).mockResolvedValue({ ...NEWER_RELEASE, version: '0.1.0' })
    render(<UpdateChecker />)
    await passStartupDelay()
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
    expect(useStarUpdateStore.getState().latest?.hasUpdate).toBe(false)

    vi.mocked(starApi.updateInfo).mockResolvedValue(NEWER_RELEASE)
    await act(async () => {
      await vi.advanceTimersByTimeAsync(CHECK_INTERVAL_MS - 1)
    })
    expect(starApi.updateInfo).toHaveBeenCalledOnce()
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1)
    })
    await settle()

    expect(starApi.updateInfo).toHaveBeenCalledTimes(2)
    expect(screen.getByRole('status')).toHaveTextContent('发现新版本 0.2.0')
    // The dot on the settings entry reads the same answer.
    expect(useStarUpdateStore.getState().latest?.hasUpdate).toBe(true)
  })

  it('shows rich-text release notes as plain text and never the download address', async () => {
    vi.mocked(starApi.updateInfo).mockResolvedValue({ ...NEWER_RELEASE, releaseNotes: '<p>修复登录</p><ul><li>更快</li></ul>' })
    render(<UpdateChecker />)
    await passStartupDelay()

    const notice = screen.getByRole('status')
    expect(notice).toHaveTextContent('修复登录')
    expect(notice).toHaveTextContent('• 更快')
    expect(notice.textContent).not.toContain('<')
    expect(notice.textContent).not.toContain('star.example.com')
  })

  it('stays quiet when the release has no web download page', async () => {
    vi.mocked(starApi.updateInfo).mockResolvedValue({ ...NEWER_RELEASE, downloadUrl: 'file:///C:/setup.exe' })
    render(<UpdateChecker />)
    await passStartupDelay()

    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })

  it('stays quiet when the installed build is current', async () => {
    vi.mocked(starApi.updateInfo).mockResolvedValue({ ...NEWER_RELEASE, version: '0.1.0' })

    render(<UpdateChecker />)
    await passStartupDelay()

    expect(starApi.updateInfo).toHaveBeenCalledOnce()
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })

  it('stays quiet when the check fails', async () => {
    vi.mocked(starApi.updateInfo).mockRejectedValue(new Error('network down'))

    render(<UpdateChecker />)
    await passStartupDelay()

    expect(starApi.updateInfo).toHaveBeenCalledOnce()
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })

  it('keeps automatic checks off when disabled and starts them when re-enabled', async () => {
    useSettingsStore.setState({ autoUpdateEnabled: false })
    render(<UpdateChecker />)
    await passStartupDelay()

    expect(starApi.updateInfo).not.toHaveBeenCalled()
    expect(screen.queryByRole('status')).not.toBeInTheDocument()

    await act(async () => {
      useSettingsStore.setState({ autoUpdateEnabled: true })
    })
    await passStartupDelay()

    expect(starApi.updateInfo).toHaveBeenCalledOnce()
    expect(screen.getByRole('status')).toHaveTextContent('发现新版本 0.2.0')
  })

  it('drops a pending check when automatic checks are turned off during the delay', async () => {
    render(<UpdateChecker />)

    await act(async () => {
      useSettingsStore.setState({ autoUpdateEnabled: false })
    })
    await passStartupDelay()

    expect(starApi.updateInfo).not.toHaveBeenCalled()
  })

  it('does not check outside the desktop runtime', async () => {
    Reflect.deleteProperty(window, 'desktopHost')

    render(<UpdateChecker />)
    await passStartupDelay()

    expect(starApi.updateInfo).not.toHaveBeenCalled()
  })
})
