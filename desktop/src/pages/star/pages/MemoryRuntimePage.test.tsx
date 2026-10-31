import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import '@testing-library/jest-dom'
import type { StarRuntimeSnapshot } from '../../../api/star'
import type { MemoryGraphData } from '../../../types/memory'

const apis = vi.hoisted(() => ({
  graph: vi.fn(),
  readFile: vi.fn(),
  runtime: vi.fn(),
}))

vi.mock('../../../api/memory', () => ({ memoryApi: { graph: apis.graph, readFile: apis.readFile } }))
vi.mock('@/api/star', () => ({
  starApi: { runtime: apis.runtime },
  starErrorText: (error: unknown) => String(error),
}))
// The locked-node card previews memory files as markdown; the markdown renderer is not under test.
vi.mock('../../../components/markdown/MarkdownRenderer', () => ({
  MarkdownRenderer: ({ content }: { content: string }) => <div>{content}</div>,
}))

import { MEMORY_FORM_STORAGE_KEY } from '../memoryGraph/memoryForm'
import { MemoryGraphPage } from './MemoryGraphPage'
import { MemoryRuntimePage } from './MemoryRuntimePage'
import { RuntimePage } from './RuntimePage'

const GRAPH: MemoryGraphData = {
  generatedAt: '2025-06-01T00:00:00.000Z',
  userMemory: { exists: true, bytes: 120, updatedAt: '2025-06-01T00:00:00.000Z' },
  clusters: [{
    id: 'alpha',
    label: '/work/alpha',
    isCurrent: true,
    memoryDir: '/home/me/.claude/projects/alpha/memory',
    index: { exists: true, updatedAt: '2025-06-01T00:00:00.000Z', links: 1 },
    memories: [{ path: 'user_tone.md', title: '回答要简洁', type: 'user', description: '用户偏好简短的回答', updatedAt: '2025-05-30T00:00:00.000Z', bytes: 80, indexed: true, sessionId: 's1' }],
    memoryTotal: 1,
    sessions: [{
      id: 's1',
      title: '第一次对话',
      createdAt: '2025-05-29T00:00:00.000Z',
      modifiedAt: '2025-05-30T00:00:00.000Z',
      messageCount: 12,
      projectPath: '/work/alpha',
      projectRoot: null,
      workDir: null,
      workDirExists: false,
    }],
    sessionTotal: 1,
  }],
}

const SNAPSHOT: StarRuntimeSnapshot = {
  at: Date.parse('2025-06-01T08:00:00.000Z'),
  platform: 'win32',
  cpuCount: 8,
  totalMemoryBytes: 16 * 1024 ** 3,
  freeMemoryBytes: 8 * 1024 ** 3,
  server: { pid: 4242, port: 3456, startedAt: Date.parse('2025-06-01T07:58:00.000Z'), uptimeSec: 120, bunVersion: '1.2.0', rssBytes: 1, heapUsedBytes: 1 },
  processes: [],
  processError: null,
  totals: { count: 3, memoryBytes: 512 * 1024 ** 2, cpuPercent: 1.5 },
  sessions: [],
  plugins: { signedIn: true, checkedAt: null, items: [{ group: 'media', name: 'star-media', description: '生图与视频', enabled: true, ok: true, status: 200, tools: 4, latencyMs: 12 }] },
  tasks: { running: 0, recent: [] },
}

// jsdom lays nothing out and has no 2D canvas, observers or pointer events; these stand in.
class FakeResizeObserver {
  constructor(_callback: ResizeObserverCallback) {}
  observe() {}
  unobserve() {}
  disconnect() {}
}

const intersections: FakeIntersectionObserver[] = []
class FakeIntersectionObserver {
  constructor(readonly callback: IntersectionObserverCallback) {
    intersections.push(this)
  }
  observe() {}
  unobserve() {}
  disconnect() {}
  takeRecords() {
    return []
  }
}

class FakePointerEvent extends MouseEvent {
  readonly pointerId: number
  constructor(type: string, init: PointerEventInit = {}) {
    super(type, init)
    this.pointerId = init.pointerId ?? 1
  }
}

function fakeContext(): CanvasRenderingContext2D {
  const target: Record<string | symbol, unknown> = {
    measureText: () => ({ width: 24 }),
    createRadialGradient: () => ({ addColorStop: () => {} }),
  }
  return new Proxy(target, {
    get: (object, key) => (key in object ? object[key] : (object[key] = () => {})),
    set: (object, key, value) => {
      object[key] = value
      return true
    },
  }) as unknown as CanvasRenderingContext2D
}

let frameId = 0
const requestFrame = vi.fn(() => ++frameId)
const cancelFrame = vi.fn()

const viewSwitch = () => screen.getByRole('tablist', { name: '记忆图谱与运行时' })
const headerOf = (container: HTMLElement) => container.querySelector('header')!

describe('MemoryRuntimePage', () => {
  beforeEach(() => {
    localStorage.clear()
    intersections.length = 0
    requestFrame.mockClear()
    cancelFrame.mockClear()
    apis.graph.mockReset().mockResolvedValue(GRAPH)
    apis.readFile.mockReset().mockResolvedValue({ file: { path: 'user_tone.md', content: '回答要简洁', updatedAt: '2025-05-30T00:00:00.000Z', bytes: 80 } })
    apis.runtime.mockReset().mockResolvedValue(SNAPSHOT)
    vi.stubGlobal('ResizeObserver', FakeResizeObserver)
    vi.stubGlobal('IntersectionObserver', FakeIntersectionObserver)
    vi.stubGlobal('PointerEvent', FakePointerEvent)
    vi.stubGlobal('requestAnimationFrame', requestFrame)
    vi.stubGlobal('cancelAnimationFrame', cancelFrame)
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation((() => fakeContext()) as unknown as HTMLCanvasElement['getContext'])
    Element.prototype.setPointerCapture = vi.fn()
    Element.prototype.hasPointerCapture = vi.fn(() => false)
    Element.prototype.releasePointerCapture = vi.fn()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
    for (const method of ['setPointerCapture', 'hasPointerCapture', 'releasePointerCapture']) Reflect.deleteProperty(Element.prototype, method)
  })

  it('opens on the memory graph under a single header', async () => {
    const { container } = render(<MemoryRuntimePage />)
    const tabs = within(viewSwitch()).getAllByRole('tab')
    expect(tabs.map((tab) => [tab.textContent, tab.getAttribute('aria-selected')])).toEqual([['记忆图谱', 'true'], ['运行时', 'false']])
    expect(screen.getByTestId('memory-graph')).toBeInTheDocument()
    expect(screen.queryByTestId('runtime-view')).toBeNull()
    expect(container.querySelectorAll('header')).toHaveLength(1)
    expect(screen.getAllByRole('heading', { level: 1 }).map((heading) => heading.textContent)).toEqual(['记忆图谱'])
    // The graph's own description and actions sit in that one header.
    const header = headerOf(container)
    expect(within(header).getByText('中心为 L3 综合，中圈为 L2 记忆，外圈为 L1 原始会话。')).toBeInTheDocument()
    expect(within(header).getByRole('button', { name: '管理记忆' })).toBeInTheDocument()
    await waitFor(() => expect(within(header).getByRole('button', { name: '刷新' })).toBeEnabled())
    expect(apis.graph).toHaveBeenCalledTimes(1)
    expect(apis.runtime).not.toHaveBeenCalled()
  })

  it('opens on the view initialView names', async () => {
    const { container } = render(<MemoryRuntimePage initialView="runtime" />)
    expect(screen.getByRole('tab', { name: '运行时' })).toHaveAttribute('aria-selected', 'true')
    expect(await screen.findByText('STAR 插件接口')).toBeInTheDocument()
    expect(screen.queryByTestId('memory-graph')).toBeNull()
    const header = headerOf(container)
    expect(within(header).getByText('这台电脑上 STAR 的进程、对话、插件和生成任务')).toBeInTheDocument()
    expect(within(header).getByRole('button', { name: '暂停' })).toBeInTheDocument()
    expect(apis.graph).not.toHaveBeenCalled()
  })

  it('swaps the two bodies from the pill switch and keeps one header', async () => {
    const { container } = render(<MemoryRuntimePage />)
    fireEvent.click(screen.getByRole('tab', { name: '运行时' }))
    expect(screen.getByRole('tab', { name: '运行时' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('tab', { name: '记忆图谱' })).toHaveAttribute('aria-selected', 'false')
    expect(screen.getByTestId('runtime-view')).toBeInTheDocument()
    expect(screen.queryByTestId('memory-graph')).toBeNull()
    expect(await screen.findByText('STAR 插件接口')).toBeInTheDocument()
    expect(container.querySelectorAll('header')).toHaveLength(1)
    expect(within(headerOf(container)).queryByRole('button', { name: '管理记忆' })).toBeNull()

    // Arrow keys walk the switch, as a tablist should.
    fireEvent.keyDown(viewSwitch(), { key: 'ArrowLeft' })
    expect(screen.getByRole('tab', { name: '记忆图谱' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('tab', { name: '记忆图谱' })).toHaveFocus()
    expect(screen.getByTestId('memory-graph')).toBeInTheDocument()
    expect(screen.queryByTestId('runtime-view')).toBeNull()
    expect(within(headerOf(container)).getByRole('button', { name: '管理记忆' })).toBeInTheDocument()
    expect(within(headerOf(container)).queryByRole('button', { name: '暂停' })).toBeNull()
    await waitFor(() => expect(within(headerOf(container)).getByRole('button', { name: '刷新' })).toBeEnabled())
  })

  it('follows a later, different initialView', async () => {
    const { rerender } = render(<MemoryRuntimePage initialView="memory" />)
    rerender(<MemoryRuntimePage initialView="runtime" />)
    expect(screen.getByRole('tab', { name: '运行时' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByTestId('runtime-view')).toBeInTheDocument()
    expect(await screen.findByText('STAR 插件接口')).toBeInTheDocument()
  })

  it('keeps MemoryGraphPage and RuntimePage as ways into the merged page', async () => {
    const graph = render(<MemoryGraphPage />)
    expect(screen.getByRole('tab', { name: '记忆图谱' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByTestId('memory-graph')).toBeInTheDocument()
    expect(graph.container.querySelectorAll('header')).toHaveLength(1)
    await waitFor(() => expect(within(headerOf(graph.container)).getByRole('button', { name: '刷新' })).toBeEnabled())
    graph.unmount()

    const runtime = render(<RuntimePage />)
    expect(screen.getByRole('tab', { name: '运行时' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByTestId('runtime-view')).toBeInTheDocument()
    expect(runtime.container.querySelectorAll('header')).toHaveLength(1)
    expect(await screen.findByText('STAR 插件接口')).toBeInTheDocument()
  })

  it('switches the memory view to the nebula and remembers the choice', async () => {
    const first = render(<MemoryRuntimePage />)
    const forms = screen.getByRole('radiogroup', { name: '记忆形态' })
    expect(within(forms).getByRole('radio', { name: '图谱' })).toHaveAttribute('aria-checked', 'true')
    fireEvent.click(within(forms).getByRole('radio', { name: '星云' }))
    expect(localStorage.getItem(MEMORY_FORM_STORAGE_KEY)).toBe('nebula')
    expect(screen.getByTestId('memory-graph')).toHaveAttribute('data-form', 'nebula')
    expect(await screen.findByRole('img', { name: /^记忆星云：/ })).toBeInTheDocument()
    // The legend names the clouds by colour instead of the graph's shapes.
    const legend = screen.getByTestId('memory-legend')
    expect(within(legend).getByText('未分类')).toBeInTheDocument()
    expect(within(legend).queryByText('会话 / 未分类')).toBeNull()
    first.unmount()

    render(<MemoryRuntimePage />)
    expect(screen.getByRole('radio', { name: '星云' })).toHaveAttribute('aria-checked', 'true')
    expect(screen.getByTestId('memory-graph')).toHaveAttribute('data-form', 'nebula')
    fireEvent.click(screen.getByRole('radio', { name: '图谱' }))
    expect(localStorage.getItem(MEMORY_FORM_STORAGE_KEY)).toBe('graph')
    expect(await screen.findByRole('img', { name: /^记忆图谱：/ })).toBeInTheDocument()
  })

  it('falls back to the graph for a stored form it does not know', async () => {
    localStorage.setItem(MEMORY_FORM_STORAGE_KEY, 'galaxy')
    render(<MemoryRuntimePage />)
    expect(screen.getByRole('radio', { name: '图谱' })).toHaveAttribute('aria-checked', 'true')
    expect(screen.getByTestId('memory-graph')).toHaveAttribute('data-form', 'graph')
    expect(await screen.findByRole('img', { name: /^记忆图谱：/ })).toBeInTheDocument()
    await waitFor(() => expect(screen.getByRole('button', { name: '刷新' })).toBeEnabled())
  })

  it('previews and locks a nebula star the way the graph does a node', async () => {
    localStorage.setItem(MEMORY_FORM_STORAGE_KEY, 'nebula')
    render(<MemoryRuntimePage />)
    await screen.findByRole('img', { name: /^记忆星云：/ })
    const field = screen.getByTestId('memory-graph')
    // Nothing is laid out in jsdom, so the field sits at the origin with the core on it.
    fireEvent.pointerMove(field, { clientX: 0, clientY: 0 })
    expect(await screen.findByText(/用户指令 CLAUDE\.md/)).toBeInTheDocument()
    fireEvent.pointerDown(field, { button: 0, clientX: 0, clientY: 0 })
    fireEvent.pointerUp(field, { button: 0, clientX: 0, clientY: 0 })
    expect(await screen.findByText(/已锁定 · L3 综合/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '解除锁定' }))
    expect(screen.queryByText(/已锁定/)).toBeNull()
  })

  it('stops the nebula\'s animation while the window is hidden or the field is off screen', async () => {
    localStorage.setItem(MEMORY_FORM_STORAGE_KEY, 'nebula')
    render(<MemoryRuntimePage />)
    await screen.findByRole('img', { name: /^记忆星云：/ })
    expect(requestFrame).toHaveBeenCalledTimes(1)

    const hidden = vi.spyOn(document, 'hidden', 'get').mockReturnValue(true)
    act(() => { document.dispatchEvent(new Event('visibilitychange')) })
    expect(cancelFrame).toHaveBeenCalledTimes(1)

    hidden.mockReturnValue(false)
    act(() => { document.dispatchEvent(new Event('visibilitychange')) })
    expect(requestFrame).toHaveBeenCalledTimes(2)

    const observer = intersections.at(-1)!
    act(() => { observer.callback([{ isIntersecting: false } as IntersectionObserverEntry], observer as unknown as IntersectionObserver) })
    expect(cancelFrame).toHaveBeenCalledTimes(2)
  })
})
