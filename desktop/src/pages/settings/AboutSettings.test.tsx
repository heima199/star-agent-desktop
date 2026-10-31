import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import '@testing-library/jest-dom'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { useSettingsStore } from '@/stores/settingsStore'
import { useStarStore } from '@/stores/starStore'
import { settingsApi } from '@/api/settings'
import { starApi, type StarDesktopConfig, type StarUpdateInfo } from '@/api/star'
import { browserHost } from '@/lib/desktopHost/browserHost'
import { useStarUpdateStore } from '@/stores/starUpdateStore'
import { AboutSettings } from './AboutSettings'

const initialSettingsState = useSettingsStore.getState()
const initialStarState = useStarStore.getState()
const initialStarUpdateState = useStarUpdateStore.getState()

/** The release the STAR console publishes; the browser host reports 0.1.0 installed. */
const CURRENT_RELEASE: StarUpdateInfo = {
  version: '0.1.0',
  downloadUrl: 'https://star.example.com/download/0.1.0',
  releaseNotes: '',
  mandatory: false,
  publishedAt: null,
}

const NEWER_RELEASE: StarUpdateInfo = {
  version: '0.2.0',
  downloadUrl: 'https://star.example.com/download/0.2.0',
  releaseNotes: '## 0.2.0 更新内容\n\n- 新增运行时页面',
  mandatory: false,
  publishedAt: null,
}

const DESKTOP_CONFIG: StarDesktopConfig = {
  fetchedAt: 0,
  siteName: 'STAR',
  branding: { appName: 'STAR', logoUrl: '', primaryColor: '', tagline: '' },
  about: {
    email: 'help@star.example.com',
    communityUrl: '',
    manualUrl: 'https://star.example.com/manual',
    termsUrl: '',
    privacyUrl: '',
    copyright: '© STAR',
    wecomQr: '',
    description: '',
  },
  support: { enabled: true, url: '', qrcodeUrl: '', email: '', wechatId: 'star-help', hours: '9:00-18:00', description: '' },
  feedbackEnabled: true,
  inviteEnabled: false,
  legal: [{ id: 'terms', title: '用户协议', kind: 'terms', url: '', content: '# 用户协议\n\n使用 STAR 即表示同意本协议。' }],
  ads: { icons: [], slides: [] },
}

const shellOpen = vi.fn()

async function renderAboutSettings() {
  render(<AboutSettings />)
  // The installed version and the update check both arrive asynchronously;
  // let them settle so assertions are not racing a state update.
  await screen.findByText((_, node) => node?.tagName === 'DIV' && node.textContent === '版本 0.1.0')
  await waitFor(() => expect(starApi.updateInfo).toHaveBeenCalled())
}

beforeEach(async () => {
  shellOpen.mockReset()
  shellOpen.mockResolvedValue(undefined)
  window.desktopHost = {
    ...browserHost,
    kind: 'electron',
    isDesktop: true,
    shell: { ...browserHost.shell, open: shellOpen },
  }
  useSettingsStore.setState({ locale: 'zh', autoUpdateEnabled: true })
  vi.spyOn(starApi, 'updateInfo').mockResolvedValue(CURRENT_RELEASE)
  vi.spyOn(starApi, 'desktopConfig').mockResolvedValue(DESKTOP_CONFIG)
  vi.spyOn(settingsApi, 'updateUser').mockResolvedValue({ ok: true })
  // Establish the persisted fixture as well as the optimistic store value;
  // failed saves must roll back to a successful save, not an arbitrary setState.
  await useSettingsStore.getState().setAutoUpdateEnabled(true)
  vi.mocked(settingsApi.updateUser).mockClear()
})

afterEach(() => {
  cleanup()
  useSettingsStore.setState(initialSettingsState)
  useStarStore.setState(initialStarState)
  useStarUpdateStore.setState(initialStarUpdateState)
  Reflect.deleteProperty(window, 'desktopHost')
  vi.restoreAllMocks()
})

it('shows what the automatic check already found before its own check answers', async () => {
  useStarUpdateStore.setState({ latest: { current: '0.1.0', latest: NEWER_RELEASE, hasUpdate: true } })
  vi.mocked(starApi.updateInfo).mockImplementation(() => new Promise(() => {}))
  render(<AboutSettings />)

  expect(screen.getByText('发现新版本 0.2.0')).toBeInTheDocument()
  expect(screen.getByRole('button', { name: '下载 0.2.0' })).toBeInTheDocument()
})

it('marks a mandatory release in the status line', async () => {
  vi.mocked(starApi.updateInfo).mockResolvedValue({ ...NEWER_RELEASE, mandatory: true })
  await renderAboutSettings()

  expect(await screen.findByText('发现新版本 0.2.0（需要更新）')).toBeInTheDocument()
})

it('checks the STAR console and reports an installed build that is current', async () => {
  await renderAboutSettings()

  expect(await screen.findByText('当前已是最新版本')).toBeInTheDocument()
  expect(starApi.updateInfo).toHaveBeenCalledOnce()
  expect(screen.getByRole('button', { name: '检查更新' })).toBeEnabled()
  expect(screen.queryByRole('button', { name: /^下载/ })).not.toBeInTheDocument()
})

it('offers the download published in the STAR console when a newer version exists', async () => {
  vi.mocked(starApi.updateInfo).mockResolvedValue(NEWER_RELEASE)
  await renderAboutSettings()

  const download = await screen.findByRole('button', { name: '下载 0.2.0' })
  expect(screen.getByText('发现新版本 0.2.0')).toBeInTheDocument()
  // Release notes are rendered as markdown, not shown as raw source.
  expect(screen.getByText('新增运行时页面')).toBeInTheDocument()

  fireEvent.click(download)
  expect(shellOpen).toHaveBeenCalledWith('https://star.example.com/download/0.2.0')
})

it('reads calm when the console cannot answer, without claiming the build is current', async () => {
  vi.mocked(starApi.updateInfo).mockRejectedValue(new Error('network down'))
  await renderAboutSettings()

  const status = await screen.findByText('暂未开放在线更新')
  // The detail stays available on hover for support, not as an error banner.
  expect(status).toHaveAttribute('title', 'network down')
  expect(screen.queryByText(/检查失败|network down/)).not.toBeInTheDocument()
  expect(screen.queryByText('当前已是最新版本')).not.toBeInTheDocument()
  expect(screen.getByRole('button', { name: '检查更新' })).toBeEnabled()
})

it('reports the build as current when the console has not published a release', async () => {
  vi.mocked(starApi.updateInfo).mockResolvedValue({ version: null, downloadUrl: null, releaseNotes: '', mandatory: false, publishedAt: null })
  await renderAboutSettings()

  expect(await screen.findByText('当前已是最新版本')).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: /^下载/ })).not.toBeInTheDocument()
})

it('shows automatic update checks enabled by default with the scope of the setting', async () => {
  await renderAboutSettings()

  expect(screen.getByRole('switch', { name: '自动检查更新' })).toBeChecked()
  expect(screen.getByText('启动时检查 STAR 的新版本并提示下载；关闭后仍可在上方手动检查。')).toBeInTheDocument()
})

it('saves automatic update checks off and back on through the settings API', async () => {
  await renderAboutSettings()
  const toggle = screen.getByRole('switch', { name: '自动检查更新' })
  fireEvent.click(toggle)
  await waitFor(() => expect(toggle).not.toBeChecked())
  await waitFor(() => expect(toggle).toBeEnabled())
  expect(settingsApi.updateUser).toHaveBeenCalledWith({ autoUpdateEnabled: false })

  fireEvent.click(toggle)
  await waitFor(() => expect(toggle).toBeChecked())
  await waitFor(() => expect(toggle).toBeEnabled())
  expect(settingsApi.updateUser).toHaveBeenLastCalledWith({ autoUpdateEnabled: true })
})

it('disables the switch until saving finishes', async () => {
  let finishSave: (result: { ok: true }) => void = () => {}
  vi.mocked(settingsApi.updateUser).mockImplementationOnce(() => new Promise(resolve => { finishSave = resolve }))
  await renderAboutSettings()
  const toggle = screen.getByRole('switch', { name: '自动检查更新' })
  fireEvent.click(toggle)
  expect(toggle).toBeDisabled()
  await waitFor(() => expect(settingsApi.updateUser).toHaveBeenCalledOnce())
  await act(async () => { finishSave({ ok: true }) })
  expect(toggle).toBeEnabled()
  expect(toggle).not.toBeChecked()
})

it('surfaces a failed save and restores the previous automatic update setting', async () => {
  vi.mocked(settingsApi.updateUser).mockRejectedValueOnce(new Error('fixture save failed'))
  await renderAboutSettings()
  const toggle = screen.getByRole('switch', { name: '自动检查更新' })
  fireEvent.click(toggle)
  expect(await screen.findByRole('alert')).toHaveTextContent('自动检查更新设置保存失败：fixture save failed')
  expect(toggle).toBeChecked()
  expect(toggle).toBeEnabled()
})

it('keeps manual checking available while automatic checks are off', async () => {
  useSettingsStore.setState({ autoUpdateEnabled: false })
  await renderAboutSettings()
  await screen.findByText('当前已是最新版本')
  expect(screen.getByRole('switch', { name: '自动检查更新' })).not.toBeChecked()

  vi.mocked(starApi.updateInfo).mockResolvedValue(NEWER_RELEASE)
  fireEvent.click(screen.getByRole('button', { name: '检查更新' }))

  expect(await screen.findByRole('button', { name: '下载 0.2.0' })).toBeInTheDocument()
  expect(starApi.updateInfo).toHaveBeenCalledTimes(2)
})

it('lists the links, contacts and documents configured in the STAR console', async () => {
  await renderAboutSettings()

  // Operator-configured, so it appears once the console answered.
  expect(await screen.findByText('使用手册')).toBeInTheDocument()
  expect(starApi.desktopConfig).toHaveBeenCalledWith(true)
  expect(screen.getByText('star-help')).toBeInTheDocument()
  expect(screen.getByText('9:00-18:00')).toBeInTheDocument()
  expect(screen.getByText('help@star.example.com')).toBeInTheDocument()
  expect(screen.getByText('© STAR')).toBeInTheDocument()
  // Nothing on the page points at a code host.
  expect(document.body.textContent).not.toMatch(/github/i)

  fireEvent.click(screen.getByRole('button', { name: '打开' }))
  expect(shellOpen).toHaveBeenCalledWith('https://star.example.com/manual')

  fireEvent.click(screen.getByRole('button', { name: '反馈' }))
  expect(useStarStore.getState().feedbackOpen).toBe(true)

  // A document with inline content opens in the app rather than a browser.
  fireEvent.click(screen.getByRole('button', { name: '查看' }))
  const dialog = screen.getByRole('dialog', { name: '用户协议' })
  expect(within(dialog).getByText('使用 STAR 即表示同意本协议。')).toBeInTheDocument()
  expect(shellOpen).toHaveBeenCalledTimes(1)

  fireEvent.click(screen.getByRole('button', { name: 'Close dialog' }))
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
})
