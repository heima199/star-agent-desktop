import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import '@testing-library/jest-dom'

const pluginsMock = vi.hoisted(() => ({ list: vi.fn() }))
vi.mock('../../api/plugins', () => ({ pluginsApi: pluginsMock }))
vi.mock('./starPages', () => ({ openStarPage: vi.fn() }))

import { starApi, type StarStatus } from '../../api/star'
import { formatStarBrand } from '../../lib/starBrand'
import { useStarCreateStore } from '../../stores/starCreateStore'
import { useStarStore } from '../../stores/starStore'
import { useUIStore } from '../../stores/uiStore'
import { STAR_PLUGIN_ICONS, StarComposerTray, StarProjectActions } from './StarComposerTray'

const SLOT = 'draft'

const signedIn: StarStatus = {
  configured: true,
  baseUrl: 'https://star.example.test',
  signedIn: true,
  user: null,
  provider: { id: null, active: false, relayReady: false, mainModel: null },
  catalog: { fetchedAt: null, chatModels: 0, imageModels: 0, videoModels: 0 },
  starWorkSignInAvailable: false,
}

function renderTray(onCommand = vi.fn()) {
  render(<StarComposerTray location={<button type="button">Location: project</button>} slot={SLOT} onCommand={onCommand} />)
  return onCommand
}

describe('StarComposerTray plugins', () => {
  beforeEach(() => {
    pluginsMock.list.mockResolvedValue({ plugins: [] })
    useStarStore.setState({ status: signedIn, loginOpen: false })
    useStarCreateStore.setState({ slots: {} })
    useUIStore.setState({ toasts: [] })
  })

  afterEach(() => {
    useStarStore.setState({ status: null, loginOpen: false })
  })

  it('renders every plugin as a white, clickable button', () => {
    renderTray()

    for (const plugin of STAR_PLUGIN_ICONS) {
      const button = screen.getByRole('button', { name: formatStarBrand(plugin.title, 'STAR') })
      expect(button.tagName).toBe('BUTTON')
      expect(button).toHaveClass('text-[var(--color-text-primary)]')
      expect(button).not.toHaveClass('text-[var(--color-text-accent)]')
    }
  })

  it('arms 文生图 / 文生视频 for the image and video plugins', () => {
    const onCommand = renderTray()

    fireEvent.click(screen.getByRole('button', { name: 'STAR 绘图' }))
    expect(useStarCreateStore.getState().slots[SLOT]?.mode).toBe('text2image')
    fireEvent.click(screen.getByRole('button', { name: 'STAR 视频' }))
    expect(useStarCreateStore.getState().slots[SLOT]?.mode).toBe('text2video')
    expect(onCommand).not.toHaveBeenCalled()
    expect(useUIStore.getState().toasts.at(-1)).toMatchObject({ type: 'info' })
  })

  it('hands the other plugins’ commands to the composer', () => {
    const onCommand = renderTray()

    fireEvent.click(screen.getByRole('button', { name: 'STAR 联网研究' }))
    fireEvent.click(screen.getByRole('button', { name: 'STAR 文档与多模态' }))
    fireEvent.click(screen.getByRole('button', { name: 'STAR 能力测试' }))
    expect(onCommand.mock.calls.map(([command]) => command)).toEqual([
      '/star-web-search',
      '/star-file-recognize',
      '/star-capability-test',
    ])
  })

  it('asks a signed-out user to sign in instead of doing nothing', () => {
    useStarStore.setState({ status: null })
    const onCommand = renderTray()

    fireEvent.click(screen.getByRole('button', { name: 'STAR 联网研究（登录 STAR 后可用）' }))
    expect(useStarStore.getState().loginOpen).toBe(true)
    expect(onCommand).not.toHaveBeenCalled()
    expect(useStarCreateStore.getState().slots[SLOT]).toBeUndefined()
  })

  it('leaves out a built-in plugin the user turned off', async () => {
    pluginsMock.list.mockResolvedValue({ plugins: [{ name: 'star-video', isBuiltin: true, enabled: false }] })
    renderTray()

    await waitFor(() => expect(screen.queryByRole('button', { name: 'STAR 视频' })).not.toBeInTheDocument())
    expect(screen.getByRole('button', { name: 'STAR 绘图' })).toBeInTheDocument()
  })

  // The composer's own launch controls are the one project picker; the tray
  // only gives them their place, ahead of the plugins.
  it('shows the project picker it is handed first, and no picker of its own', () => {
    renderTray()

    const tray = screen.getByTestId('star-composer-tray')
    const location = screen.getByTestId('star-composer-tray-location')
    expect(location).toContainElement(screen.getByRole('button', { name: 'Location: project' }))
    expect(tray.firstElementChild).toBe(location)
    expect(screen.queryByRole('button', { name: /选择项目/ })).not.toBeInTheDocument()
  })
})

describe('StarProjectActions', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('makes a named blank project and picks its folder', async () => {
    const create = vi.spyOn(starApi, 'createLocalProject').mockResolvedValue({ name: '周报', path: 'C:/STAR/projects/周报' })
    const pick = vi.fn()
    render(<StarProjectActions workDir="" pick={pick} />)

    fireEvent.click(screen.getByRole('button', { name: '新建空白项目' }))
    fireEvent.change(screen.getByRole('textbox', { name: '项目名称' }), { target: { value: '周报' } })
    fireEvent.keyDown(screen.getByRole('textbox', { name: '项目名称' }), { key: 'Enter' })

    await waitFor(() => expect(pick).toHaveBeenCalledWith('C:/STAR/projects/周报'))
    expect(create).toHaveBeenCalledWith('周报')
  })

  it('clears the folder, and marks the draft that has none', () => {
    const pick = vi.fn()
    const { rerender } = render(<StarProjectActions workDir="C:/work/site" pick={pick} />)
    const clear = screen.getByRole('button', { name: '不使用文件夹' })
    expect(clear.querySelector('svg.lucide-check')).toBeNull()

    fireEvent.click(clear)
    expect(pick).toHaveBeenCalledWith('')

    rerender(<StarProjectActions workDir="" pick={pick} />)
    expect(screen.getByRole('button', { name: '不使用文件夹' }).querySelector('svg.lucide-check')).not.toBeNull()
  })
})
