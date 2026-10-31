import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { MemoryGraphData } from '../../../types/memory'
import { CORE_ID, buildGraphModel, memoryNodeId } from './memoryGraphModel'
import { buildNebulaLayout } from './memoryNebulaModel'
import { MemoryNebulaRenderer, type NebulaTheme } from './memoryNebulaRenderer'

/** jsdom has no 2D canvas: a context that accepts every call and counts the ones a frame is made of. */
function fakeContext() {
  const calls = { fillRect: 0, drawImage: 0 }
  const target: Record<string | symbol, unknown> = {
    measureText: () => ({ width: 24 }),
    createRadialGradient: () => ({ addColorStop: () => {} }),
    fillRect: () => { calls.fillRect += 1 },
    drawImage: () => { calls.drawImage += 1 },
  }
  const context = new Proxy(target, {
    get: (object, key) => (key in object ? object[key] : (object[key] = () => {})),
    set: (object, key, value) => {
      object[key] = value
      return true
    },
  })
  return { context: context as unknown as CanvasRenderingContext2D, calls }
}

const THEME: NebulaTheme = {
  ink: [236, 236, 234],
  background: '#121212',
  dark: true,
  font: 'sans-serif',
  tones: [[236, 236, 234], [53, 166, 157], [173, 100, 78], [97, 119, 182], [153, 115, 43], [180, 176, 166], [200, 200, 196]],
}

const DATA: MemoryGraphData = {
  generatedAt: '2025-06-01T00:00:00.000Z',
  userMemory: { exists: true, bytes: 10, updatedAt: '2025-06-01T00:00:00.000Z' },
  clusters: [{
    id: 'alpha',
    label: '/work/alpha',
    isCurrent: true,
    memoryDir: '/home/me/.claude/projects/alpha/memory',
    index: { exists: true, updatedAt: '2025-06-01T00:00:00.000Z', links: 1 },
    memories: [{ path: 'user_tone.md', title: '回答要简洁', type: 'user', updatedAt: '2025-05-30T00:00:00.000Z', bytes: 80, indexed: true, sessionId: null }],
    memoryTotal: 1,
    sessions: [],
    sessionTotal: 0,
  }],
}

describe('MemoryNebulaRenderer', () => {
  let canvas: HTMLCanvasElement
  let main: ReturnType<typeof fakeContext>
  let frames: FrameRequestCallback[]
  let frameId = 0
  const requestFrame = vi.fn((callback: FrameRequestCallback) => {
    frames.push(callback)
    frameId += 1
    return frameId
  })
  const cancelFrame = vi.fn()

  beforeEach(() => {
    frames = []
    frameId = 0
    requestFrame.mockClear()
    cancelFrame.mockClear()
    vi.stubGlobal('requestAnimationFrame', requestFrame)
    vi.stubGlobal('cancelAnimationFrame', cancelFrame)
    canvas = document.createElement('canvas')
    main = fakeContext()
    // The page's canvas gets the counting context; the glow sprites get their own.
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(function (this: HTMLCanvasElement) {
      return this === canvas ? main.context : fakeContext().context
    } as unknown as HTMLCanvasElement['getContext'])
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('runs a single animation-frame loop and stops it', () => {
    const renderer = new MemoryNebulaRenderer(canvas, THEME, false)
    renderer.setSize(800, 600, 1)
    renderer.setModel(buildGraphModel(DATA))
    renderer.start()
    renderer.start()
    expect(requestFrame).toHaveBeenCalledTimes(1)

    const drawn = main.calls.fillRect
    frames.shift()!(performance.now() + 16)
    // Each frame paints the ground once and books exactly one more frame.
    expect(main.calls.fillRect).toBe(drawn + 1)
    expect(requestFrame).toHaveBeenCalledTimes(2)

    renderer.stop()
    expect(cancelFrame).toHaveBeenCalledWith(2)
    // A frame already in flight when the loop stopped does not start it again.
    frames.shift()!(performance.now() + 32)
    expect(requestFrame).toHaveBeenCalledTimes(2)
  })

  it('draws one still frame under reduced motion and redraws only on change', () => {
    const renderer = new MemoryNebulaRenderer(canvas, THEME, true)
    renderer.setSize(800, 600, 1)
    renderer.setModel(buildGraphModel(DATA))
    const before = main.calls.fillRect
    renderer.start()
    expect(requestFrame).not.toHaveBeenCalled()
    expect(main.calls.fillRect).toBe(before + 1)
    renderer.setView({ scale: 0.8, x: 400, y: 300 })
    expect(main.calls.fillRect).toBe(before + 2)
    expect(requestFrame).not.toHaveBeenCalled()
  })

  it('sizes the backing store for the device pixel ratio', () => {
    const renderer = new MemoryNebulaRenderer(canvas, THEME, true)
    renderer.setSize(400, 300, 2)
    expect([canvas.width, canvas.height]).toEqual([800, 600])
    renderer.setSize(400, 300, 1)
    expect([canvas.width, canvas.height]).toEqual([400, 300])
  })

  it('picks the same graph nodes the page locks, and glows the important ones', () => {
    const model = buildGraphModel(DATA)
    const renderer = new MemoryNebulaRenderer(canvas, THEME, true)
    renderer.setSize(800, 600, 1)
    renderer.setView({ scale: 1, x: 400, y: 300 })
    renderer.setModel(model)
    const layout = buildNebulaLayout(model)
    const memory = layout.stars[layout.starIndex.get(memoryNodeId('alpha', 'user_tone.md'))!]!
    expect(renderer.hitTest(400, 300)?.id).toBe(CORE_ID)
    expect(renderer.hitTest(memory.x + 400, memory.y + 300)).toBe(model.byId.get(memory.node.id))
    expect(renderer.clusterAt(400, 300)).toBe(-1)
    // The indexed memory and its index are important enough for a glow sprite each.
    expect(main.calls.drawImage).toBeGreaterThanOrEqual(2)
    renderer.setLayers({ L3: true, L2: false, L1: true })
    expect(renderer.hitTest(memory.x + 400, memory.y + 300)?.kind).not.toBe('memory')
    renderer.destroy()
    expect(renderer.hitTest(400, 300)).toBeNull()
  })
})
