import { fireEvent, render, screen, within } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import '@testing-library/jest-dom'

const pageMocks = vi.hoisted(() => ({ openStarPage: vi.fn(), openExternal: vi.fn() }))
vi.mock('./starPages', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./starPages')>()
  return { ...actual, openStarPage: pageMocks.openStarPage, openExternal: pageMocks.openExternal }
})

import { useStarStore, type StarMode } from '../../stores/starStore'
import { useTabStore } from '../../stores/tabStore'
import { StarSidebarNav } from './StarSidebarNav'

function Item({ label, onClick }: { label: string; onClick: () => void; children: ReactNode }) {
  return <button type="button" onClick={onClick}>{label}</button>
}

function renderNav(mode: StarMode) {
  useStarStore.setState({ mode })
  return render(
    <StarSidebarNav
      Item={Item as never}
      collapsed={false}
      activeTabId={null}
      onNewSession={() => {}}
      modKey="Ctrl+"
      newSessionLabel="新建会话"
      newTaskLabel="新建任务"
      extensionsLabel="插件"
      scheduledLabel="定时任务"
    />,
  )
}

const labels = () => within(screen.getByTestId('star-sidebar-nav')).getAllByRole('button').map((button) => button.textContent)

describe('StarSidebarNav', () => {
  beforeEach(() => {
    pageMocks.openStarPage.mockReset()
    useStarStore.setState({ desktopConfig: { ads: { icons: [], slides: [] } } as never, loadDesktopConfig: async () => null })
  })

  afterEach(() => {
    useStarStore.setState({ mode: 'work' })
  })

  it.each<StarMode>(['work', 'code', 'design'])('offers no removed or merged entry in %s mode', (mode) => {
    renderNav(mode)
    fireEvent.click(screen.getByRole('button', { name: '更多' }))

    const shown = labels()
    // 项目: a task's folder is picked under the composer instead.
    for (const gone of ['远程控制', '应用', 'AI 画布', '意见反馈', '运行时', '开一个自己的AI站', '项目']) {
      expect(shown).not.toContain(gone)
    }
    expect(shown).toContain('记忆图谱')
    expect(shown).toContain('插件')
    expect(shown).toContain('日历')
  })

  it.each<StarMode>(['work', 'code'])('offers 日历 right after 定时任务 in %s mode', (mode) => {
    renderNav(mode)

    const shown = labels()
    expect(shown.indexOf('日历')).toBe(shown.indexOf('定时任务') + 1)
    fireEvent.click(screen.getByRole('button', { name: '日历' }))
    expect(pageMocks.openStarPage).toHaveBeenLastCalledWith('calendar')
  })

  it.each<StarMode>(['work', 'code'])('offers 我的文件 right after 日历 in %s mode', (mode) => {
    renderNav(mode)

    const shown = labels()
    expect(shown.indexOf('我的文件')).toBe(shown.indexOf('日历') + 1)
    fireEvent.click(screen.getByRole('button', { name: '我的文件' }))
    expect(pageMocks.openStarPage).toHaveBeenLastCalledWith('files')
  })

  it('keeps 我的文件 under 更多 in design mode', () => {
    renderNav('design')
    expect(labels()).not.toContain('我的文件')

    fireEvent.click(screen.getByRole('button', { name: '更多' }))
    const shown = labels()
    expect(shown.filter((label) => label === '我的文件')).toHaveLength(1)
    expect(shown.indexOf('我的文件')).toBe(shown.indexOf('日历') + 1)
    fireEvent.click(screen.getByRole('button', { name: '我的文件' }))
    expect(pageMocks.openStarPage).toHaveBeenLastCalledWith('files')
  })

  // PPT and 3D Make are hidden pages: no entry in any mode.
  it.each<StarMode>(['work', 'code', 'design'])('offers no PPT or 3D Make entry in %s mode', (mode) => {
    renderNav(mode)
    fireEvent.click(screen.getByRole('button', { name: '更多' }))

    expect(labels()).not.toContain('PPT')
    expect(labels()).not.toContain('3D Make')
  })

  it('closes a PPT or 3D Make tab still open, and neither page opens again', async () => {
    const actual = await vi.importActual<typeof import('./starPages')>('./starPages')
    const tab = (id: 'ppt' | '3d' | 'calendar') => ({ sessionId: actual.starPageTabId(id), title: id, type: 'star-page' as const, status: 'idle' as const })
    useTabStore.setState({ tabs: [tab('3d'), tab('calendar'), tab('ppt')], activeTabId: actual.starPageTabId('calendar') })
    try {
      renderNav('work')
      expect(useTabStore.getState().tabs.map(item => item.sessionId)).toEqual([actual.starPageTabId('calendar')])

      actual.openStarPage('ppt')
      actual.openStarPage('3d')
      expect(useTabStore.getState().tabs).toHaveLength(1)
      expect(actual.isStarPageHidden('ppt')).toBe(true)
      expect(actual.isStarPageHidden('calendar')).toBe(false)
    } finally {
      useTabStore.setState({ tabs: [], activeTabId: null })
    }
  })

  // 分销中心 + 开一个自己的AI站 and 记忆图谱 + 运行时 are one page each now.
  it('has one entry for each merged page', () => {
    renderNav('work')
    fireEvent.click(screen.getByRole('button', { name: '更多' }))

    expect(labels().filter((label) => label === '分销中心')).toHaveLength(1)
    fireEvent.click(screen.getByRole('button', { name: '分销中心' }))
    expect(pageMocks.openStarPage).toHaveBeenLastCalledWith('distribution')
    fireEvent.click(screen.getByRole('button', { name: '记忆图谱' }))
    expect(pageMocks.openStarPage).toHaveBeenLastCalledWith('memory')
  })
})
