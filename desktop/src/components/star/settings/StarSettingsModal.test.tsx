import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import '@testing-library/jest-dom'

vi.mock('@/pages/star/StarPhonePage', () => ({
  StarPhonePage: () => <div data-testid="remote-control-pane">远程控制面板</div>,
}))
vi.mock('@/pages/settings/ChatAppearanceSettings', () => ({
  ChatAppearanceSettings: () => null,
}))
vi.mock('@/pages/TerminalSettings', () => ({
  TerminalSettings: () => <div data-testid="terminal-pane">终端设置</div>,
}))

import { settingsApi } from '@/api/settings'
import { STAR_OPEN_SETTINGS_EVENT } from '@/lib/starSettingsEvent'
import { useSettingsStore } from '@/stores/settingsStore'
import { useUIStore } from '@/stores/uiStore'
import { ACCENT_STORAGE_KEY, MONO_ACCENT } from '@/theme/accent'
import { StarSettingsHost } from './StarSettingsModal'

function openSettings() {
  render(<StarSettingsHost />)
  act(() => {
    window.dispatchEvent(new Event(STAR_OPEN_SETTINGS_EVENT))
  })
  return screen.getByRole('dialog', { name: '设置' })
}

describe('StarSettingsHost', () => {
  beforeEach(() => {
    useUIStore.setState({ pendingSettingsTab: null, theme: 'white' })
    useUIStore.getState().setAccent(MONO_ACCENT)
  })

  afterEach(() => {
    useUIStore.getState().setAccent(MONO_ACCENT)
    window.localStorage.removeItem(ACCENT_STORAGE_KEY)
  })

  // 远程控制 left the sidebar; it is the first tab of 设备连接 now.
  it('shows 远程控制 as the first 设备连接 tab', async () => {
    const dialog = openSettings()

    fireEvent.click(within(dialog).getByRole('button', { name: '设备连接' }))

    const tabs = ['远程控制', '手机访问', '电脑操控'].map((name) => within(dialog).getByRole('button', { name }))
    expect(tabs[0]!.compareDocumentPosition(tabs[1]!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(await within(dialog).findByTestId('remote-control-pane')).toBeInTheDocument()
  })

  it('switches the theme color in one click and back to black and white', () => {
    const dialog = openSettings()
    fireEvent.click(within(dialog).getByRole('button', { name: '外观' }))

    const picker = within(dialog).getByRole('radiogroup', { name: '主题色' })
    const root = document.documentElement
    expect(within(picker).getByRole('radio', { name: '黑白' })).toHaveAttribute('aria-checked', 'true')
    expect(root.style.getPropertyValue('--cc-ac')).toBe('')

    fireEvent.click(within(picker).getByRole('radio', { name: '赤陶' }))
    expect(useUIStore.getState().accent).toBe('#D07B52')
    expect(window.localStorage.getItem(ACCENT_STORAGE_KEY)).toBe('#D07B52')
    expect(root.style.getPropertyValue('--cc-ac')).not.toBe('')
    expect(within(picker).getByRole('radio', { name: '赤陶' })).toHaveAttribute('aria-checked', 'true')

    fireEvent.click(within(picker).getByRole('radio', { name: '黑白' }))
    expect(useUIStore.getState().accent).toBe(MONO_ACCENT)
    expect(root.style.getPropertyValue('--cc-ac')).toBe('')
  })

  it('takes any custom color from the picker', () => {
    const dialog = openSettings()
    fireEvent.click(within(dialog).getByRole('button', { name: '外观' }))

    fireEvent.change(within(dialog).getByLabelText('自定义主题色'), { target: { value: '#123abc' } })

    expect(useUIStore.getState().accent).toBe('#123ABC')
    expect(document.documentElement.style.getPropertyValue('--cc-ac')).not.toBe('')
    const picker = within(dialog).getByRole('radiogroup', { name: '主题色' })
    for (const radio of within(picker).getAllByRole('radio')) {
      expect(radio).toHaveAttribute('aria-checked', 'false')
    }
  })

  // 钩子 edits `hooks` in the user settings, which the server merges one key
  // deep: every write carries the whole object, entries it cannot show included.
  it('lists, adds, removes and pauses hooks, always writing the whole hooks object', async () => {
    const promptHook = { type: 'prompt', prompt: 'Check the reply' }
    const formatter = { matcher: 'Edit|Write', hooks: [{ type: 'command', command: 'npx prettier --write .', timeout: 30 }] }
    const getUser = vi.spyOn(settingsApi, 'getUser').mockResolvedValue({ hooks: { PostToolUse: [formatter], Stop: [{ hooks: [promptHook] }] } })
    const updateUser = vi.spyOn(settingsApi, 'updateUser').mockResolvedValue({ ok: true })
    try {
      const dialog = openSettings()
      fireEvent.click(within(dialog).getByRole('button', { name: '运行环境' }))
      fireEvent.click(within(dialog).getByRole('button', { name: '钩子' }))

      expect(await within(dialog).findByText('npx prettier --write .（超时 30 秒）')).toBeInTheDocument()
      expect(within(dialog).getByText('工具调用后 · Edit|Write')).toBeInTheDocument()
      expect(within(dialog).getByText('prompt：Check the reply')).toBeInTheDocument()

      fireEvent.change(within(dialog).getByLabelText('匹配'), { target: { value: 'Bash' } })
      fireEvent.change(within(dialog).getByLabelText('命令'), { target: { value: 'echo checked' } })
      fireEvent.click(within(dialog).getByRole('button', { name: '添加钩子' }))
      const added = { matcher: 'Bash', hooks: [{ type: 'command', command: 'echo checked' }] }
      await vi.waitFor(() => expect(updateUser).toHaveBeenLastCalledWith({ hooks: { PostToolUse: [formatter], Stop: [{ hooks: [promptHook] }], PreToolUse: [added] } }))
      expect(await within(dialog).findByText('工具调用前 · Bash')).toBeInTheDocument()

      fireEvent.click(within(dialog).getByRole('button', { name: '删除钩子：npx prettier --write .' }))
      await vi.waitFor(() => expect(updateUser).toHaveBeenLastCalledWith({ hooks: { Stop: [{ hooks: [promptHook] }], PreToolUse: [added] } }))
      await vi.waitFor(() => expect(within(dialog).queryByText('工具调用后 · Edit|Write')).not.toBeInTheDocument())

      fireEvent.click(within(dialog).getByRole('switch', { name: '暂停全部钩子' }))
      await vi.waitFor(() => expect(updateUser).toHaveBeenLastCalledWith({ disableAllHooks: true }))
    } finally {
      getUser.mockRestore()
      updateUser.mockRestore()
    }
  })

  // 运行环境 gathers the shell, the proxy and the hooks; 应用管理 keeps only
  // what the agent can use (插件 / 技能 / MCP).
  it('groups 终端, 网络 and 钩子 under 运行环境 and saves a manual proxy only with a valid address', async () => {
    const network = { aiRequestTimeoutMs: 1_800_000, proxy: { mode: 'system' as const, url: '' } }
    const setNetwork = vi.fn().mockResolvedValue(undefined)
    const previous = useSettingsStore.getState()
    useSettingsStore.setState({ network, setNetwork })
    try {
      const dialog = openSettings()
      fireEvent.click(within(dialog).getByRole('button', { name: '应用管理' }))
      expect(within(dialog).queryByRole('button', { name: '钩子' })).not.toBeInTheDocument()
      expect(within(dialog).queryByRole('button', { name: '终端' })).not.toBeInTheDocument()

      fireEvent.click(within(dialog).getByRole('button', { name: '运行环境' }))
      const tabs = ['终端', '网络', '钩子'].map(name => within(dialog).getByRole('button', { name }))
      expect(tabs[0]!.compareDocumentPosition(tabs[1]!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
      expect(tabs[1]!.compareDocumentPosition(tabs[2]!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()

      fireEvent.click(tabs[1]!)
      fireEvent.change(within(dialog).getByRole('combobox', { name: '网络代理' }), { target: { value: 'manual' } })
      expect(setNetwork).not.toHaveBeenCalled()
      const address = within(dialog).getByRole('textbox', { name: '代理地址' })
      fireEvent.change(address, { target: { value: '127.0.0.1:7890' } })
      fireEvent.blur(address)
      expect(within(dialog).getByRole('alert')).toHaveTextContent('代理地址需以 http:// 或 https:// 开头')
      expect(setNetwork).not.toHaveBeenCalled()
      // Back to the saved mode: nothing to save.
      fireEvent.change(within(dialog).getByRole('combobox', { name: '网络代理' }), { target: { value: 'system' } })
      fireEvent.change(within(dialog).getByRole('combobox', { name: '网络代理' }), { target: { value: 'manual' } })
      expect(setNetwork).not.toHaveBeenCalled()

      const retyped = within(dialog).getByRole('textbox', { name: '代理地址' })
      fireEvent.change(retyped, { target: { value: ' http://127.0.0.1:7890 ' } })
      fireEvent.keyDown(retyped, { key: 'Enter' })
      expect(setNetwork).toHaveBeenLastCalledWith({ ...network, proxy: { mode: 'manual', url: 'http://127.0.0.1:7890' } })

      fireEvent.change(within(dialog).getByRole('combobox', { name: '网络代理' }), { target: { value: 'direct' } })
      expect(setNetwork).toHaveBeenLastCalledWith({ ...network, proxy: { mode: 'direct', url: '' } })
    } finally {
      useSettingsStore.setState({ network: previous.network, setNetwork: previous.setNetwork })
    }
  })

  it('opens the old terminal settings tab inside 运行环境', async () => {
    useUIStore.setState({ pendingSettingsTab: 'terminal' })
    const dialog = openSettings()
    expect(within(dialog).getByRole('button', { name: '运行环境' })).toHaveAttribute('aria-current', 'page')
    expect(await within(dialog).findByTestId('terminal-pane')).toBeInTheDocument()
  })
})
