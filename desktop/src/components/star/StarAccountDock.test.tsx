import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import '@testing-library/jest-dom'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { starApi, type StarQuota, type StarStatus, type StarUpdateInfo } from '@/api/star'
import { useSettingsStore } from '@/stores/settingsStore'
import { useStarStore } from '@/stores/starStore'
import { useStarUpdateStore } from '@/stores/starUpdateStore'
import { useUIStore } from '@/stores/uiStore'
import { StarAccountDock } from './StarAccountDock'

const initialStarState = useStarStore.getState()
const initialUIState = useUIStore.getState()
const initialSettingsState = useSettingsStore.getState()
const initialStarUpdateState = useStarUpdateStore.getState()

const SIGNED_IN = {
  configured: true,
  baseUrl: '',
  signedIn: true,
  user: { id: 'u1', nickname: '测试用户', avatar: null },
} as unknown as StarStatus

const QUOTA = { planName: '免费版', planTier: 'free', credits: 10, expiresAt: null } as StarQuota

const CURRENT_RELEASE: StarUpdateInfo = { version: null, downloadUrl: null, releaseNotes: '', mandatory: false, publishedAt: null }

beforeEach(() => {
  useStarStore.setState({ status: SIGNED_IN, quota: QUOTA, refreshQuota: async () => {} } as never)
  useUIStore.setState({ toasts: [] })
})

afterEach(() => {
  cleanup()
  useStarStore.setState(initialStarState)
  useUIStore.setState(initialUIState)
  useSettingsStore.setState(initialSettingsState)
  useStarUpdateStore.setState(initialStarUpdateState)
  vi.restoreAllMocks()
})

async function checkForUpdatesFromMenu() {
  render(<StarAccountDock collapsed={false} />)
  fireEvent.click(screen.getByTestId('star-account-chip'))
  fireEvent.click(await screen.findByRole('menuitem', { name: '检查更新' }))
}

it('says the build is current when the console has nothing newer', async () => {
  vi.spyOn(starApi, 'updateInfo').mockResolvedValue(CURRENT_RELEASE)
  await checkForUpdatesFromMenu()

  await waitFor(() => expect(useUIStore.getState().toasts).toEqual([
    expect.objectContaining({ type: 'success', message: '当前已是最新版本' }),
  ]))
})

const NEWER_RELEASE: StarUpdateInfo = { version: '0.2.0', downloadUrl: 'https://star.example.com/download/0.2.0', releaseNotes: '', mandatory: false, publishedAt: null }

it('puts a dot on the settings entry while a newer version is available and opens 关于 from it', () => {
  useSettingsStore.setState({ locale: 'zh' })
  useStarUpdateStore.setState({ latest: { current: '0.1.0', latest: NEWER_RELEASE, hasUpdate: true } })
  render(<StarAccountDock collapsed={false} />)

  const settings = screen.getByTestId('star-settings-button')
  expect(within(settings).getByTestId('star-update-dot')).toBeInTheDocument()
  expect(settings).toHaveAttribute('title', '设置（发现新版本 0.2.0）')
  fireEvent.click(settings)
  expect(useUIStore.getState().pendingSettingsTab).toBe('about')
})

it('shows no dot for a current build, and carries it on the account entry when collapsed', () => {
  useSettingsStore.setState({ locale: 'zh' })
  useStarUpdateStore.setState({ latest: { current: '0.1.0', latest: CURRENT_RELEASE, hasUpdate: false } })
  const { unmount } = render(<StarAccountDock collapsed={false} />)
  expect(screen.queryByTestId('star-update-dot')).not.toBeInTheDocument()
  expect(screen.getByTestId('star-settings-button')).toHaveAttribute('title', '设置')
  unmount()
  useStarUpdateStore.setState({ latest: { current: '0.1.0', latest: NEWER_RELEASE, hasUpdate: true } })
  render(<StarAccountDock collapsed />)
  expect(within(screen.getByTestId('star-account-chip')).getByTestId('star-update-dot')).toBeInTheDocument()
})

it('answers a failed check with a calm notice instead of an error toast', async () => {
  vi.spyOn(starApi, 'updateInfo').mockRejectedValue(new Error('network down'))
  await checkForUpdatesFromMenu()

  await waitFor(() => expect(useUIStore.getState().toasts).toEqual([
    expect.objectContaining({ type: 'info', message: '暂未开放在线更新' }),
  ]))
  expect(useUIStore.getState().toasts.some(toast => toast.type === 'error')).toBe(false)
})
