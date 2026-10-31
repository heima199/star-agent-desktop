import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { Brain, Eye, EyeOff, Loader2, Lock, Maximize2, MessageSquare, PencilLine, RefreshCw, Unlock, ZoomIn, ZoomOut } from 'lucide-react'
import { memoryApi } from '../../../api/memory'
import { starErrorText } from '../../../api/star'
import { MarkdownRenderer } from '../../../components/markdown/MarkdownRenderer'
import { SegmentedControl } from '../../../components/ui/SegmentedControl'
import { useChatStore } from '../../../stores/chatStore'
import { useSessionStore } from '../../../stores/sessionStore'
import { useStarBrand } from '../../../stores/starBrandStore'
import { SETTINGS_TAB_ID, useTabStore } from '../../../stores/tabStore'
import { useUIStore } from '../../../stores/uiStore'
import type { MemoryGraphCluster, MemoryGraphData, MemoryGraphSession } from '../../../types/memory'
import { formatStarTime } from '../starMedia'
import { readMemoryForm, writeMemoryForm, type MemoryForm } from '../memoryGraph/memoryForm'
import { CORE_ID, MEMORY_TYPE_LABELS, buildGraphModel, traceChain, type GraphLayer, type GraphModel, type GraphNode, type MemoryShape } from '../memoryGraph/memoryGraphModel'
import { MemoryGraphRenderer, parseCssColor, type GraphView } from '../memoryGraph/memoryGraphRenderer'
import { NEBULA_GROUPS, NEBULA_TONE_TOKENS, type NebulaTone } from '../memoryGraph/memoryNebulaModel'
import { MemoryNebulaRenderer, type NebulaTheme } from '../memoryGraph/memoryNebulaRenderer'
import { MemoryRuntimePage } from './MemoryRuntimePage'

const MIN_SCALE = 0.2
const MAX_SCALE = 4
const LAYERS: GraphLayer[] = ['L3', 'L2', 'L1']
const LAYER_LABELS: Record<GraphLayer, string> = { L3: '综合', L2: '记忆', L1: '会话' }
const SHAPE_LEGEND: Array<[MemoryShape, string]> = [['circle', '用户'], ['diamond', '反馈'], ['square', '项目'], ['triangle', '参考'], ['ring', '会话 / 未分类']]
const FORMS: ReadonlyArray<{ value: MemoryForm; label: string }> = [{ value: 'graph', label: '图谱' }, { value: 'nebula', label: '星云' }]
const FORM_TEXT: Record<MemoryForm, { name: string; description: string; hint: string }> = {
  graph: {
    name: '记忆图谱',
    description: '中心为 L3 综合，中圈为 L2 记忆，外圈为 L1 原始会话。',
    hint: '悬停节点可预览记忆。点击可锁定高亮，并追踪其向内（L1 → L2 → L3）或向外的引用关系。',
  },
  nebula: {
    name: '记忆星云',
    description: '同类记忆聚成星团，越亮越重要；微光连线是引用关系。',
    hint: '悬停星点可预览记忆。点击可锁定高亮，并追踪它的来源与去向。',
  },
}
/** The legend dot for each nebula tone: the same tokens the canvas reads. */
const TONE_SWATCHES: Record<NebulaTone, string> = {
  0: 'bg-[var(--color-text-primary)]',
  1: 'bg-[var(--color-series-1)]',
  2: 'bg-[var(--color-series-2)]',
  3: 'bg-[var(--color-series-3)]',
  4: 'bg-[var(--color-series-4)]',
  5: 'bg-[var(--color-series-5)]',
  6: 'bg-[var(--color-text-secondary)]',
}

/** What the page drives; both forms' renderers take the same calls. */
type MemoryCanvasRenderer = Pick<
  MemoryGraphRenderer,
  'setSize' | 'setView' | 'setModel' | 'setFocus' | 'setLayers' | 'setOccluders' | 'start' | 'stop' | 'destroy' | 'hitTest' | 'clusterAt'
> & { setTheme: (theme: NebulaTheme) => void }

function createRenderer(form: MemoryForm, canvas: HTMLCanvasElement, theme: NebulaTheme, reducedMotion: boolean): MemoryCanvasRenderer {
  return form === 'nebula' ? new MemoryNebulaRenderer(canvas, theme, reducedMotion) : new MemoryGraphRenderer(canvas, theme, reducedMotion)
}

/**
 * The last graph this session loaded. The page unmounts with its tab; this is
 * what it draws first when it comes back. Local memory files only, no account
 * data, so it does not need clearing on sign-out.
 */
let lastGraph: MemoryGraphData | null = null

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value))

/**
 * The theme's ink and ground, read off the root so both palettes repaint the
 * graph, and the series colours the nebula tints its clouds with. A tone whose
 * token does not parse falls back to the ink.
 */
function readTheme(): NebulaTheme {
  const root = getComputedStyle(document.documentElement)
  const background = root.getPropertyValue('--color-surface').trim() || '#FFFFFF'
  const ground = parseCssColor(background) ?? [255, 255, 255]
  const ink = parseCssColor(root.getPropertyValue('--color-text-primary')) ?? (ground[0] < 128 ? [236, 236, 234] : [24, 24, 23])
  const luminance = (ground[0] * 299 + ground[1] * 587 + ground[2] * 114) / 1000
  const tones = NEBULA_TONE_TOKENS.map((token) => parseCssColor(root.getPropertyValue(token)) ?? ink)
  return { ink, background, dark: luminance < 128, font: getComputedStyle(document.body).fontFamily || 'system-ui, sans-serif', tones }
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

function formatWhen(iso: string | null | undefined): string {
  const time = iso ? Date.parse(iso) : Number.NaN
  return Number.isFinite(time) ? formatStarTime(time) : '--'
}

function stripFrontmatter(markdown: string): string {
  return markdown.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, '').trim()
}

function openMemoryFile(cluster: MemoryGraphCluster, relativePath: string): void {
  const separator = cluster.memoryDir.includes('\\') ? '\\' : '/'
  const ui = useUIStore.getState()
  ui.setPendingMemoryPath(`${cluster.memoryDir.replace(/[\\/]+$/, '')}${separator}${relativePath.replace(/\//g, separator)}`)
  ui.setPendingSettingsTab('memory')
  useTabStore.getState().openTab(SETTINGS_TAB_ID, '设置', 'settings')
}

function openMemorySettings(): void {
  useUIStore.getState().setPendingSettingsTab('memory')
  useTabStore.getState().openTab(SETTINGS_TAB_ID, '设置', 'settings')
}

function openSession(session: MemoryGraphSession): void {
  const known = useSessionStore.getState().sessions.find((item) => item.id === session.id)
  useSessionStore.getState().openHistoricalSession(known ?? session)
  useChatStore.getState().connectToSession(session.id)
}

/**
 * 记忆图谱: every project's MEMORY.md index (L3), its memory files (L2) and
 * the conversations they came from (L1), drawn as one particle field in the
 * theme's ink, or, as 星云, the same nodes gathered into glowing clouds by
 * kind. The canvas fills whatever room it has. The view's description and
 * actions render into `actionsSlot`, the header of the page that hosts it.
 */
export function MemoryGraphBody({ actionsSlot }: { actionsSlot: HTMLElement | null }) {
  const brand = useStarBrand()
  // Opened again, the page draws the graph it had at once and refreshes behind it.
  const [data, setData] = useState<MemoryGraphData | null>(() => lastGraph)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [form, setForm] = useState<MemoryForm>(readMemoryForm)
  const [layers, setLayers] = useState<Record<GraphLayer, boolean>>({ L3: true, L2: true, L1: true })
  const [hover, setHover] = useState<{ node: GraphNode; x: number; y: number } | null>(null)
  const [hoverCluster, setHoverCluster] = useState(-1)
  const [locked, setLocked] = useState<GraphNode | null>(null)
  const [zoom, setZoom] = useState(1)
  const [dragging, setDragging] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  // The panels over the canvas; wedge and cloud labels keep out from under them.
  const formRef = useRef<HTMLDivElement>(null)
  const toolsRef = useRef<HTMLDivElement>(null)
  const cardRef = useRef<HTMLDivElement>(null)
  const rendererRef = useRef<MemoryCanvasRenderer | null>(null)
  const modelRef = useRef<GraphModel | null>(null)
  const viewRef = useRef<GraphView>({ scale: 1, x: 0, y: 0 })
  const sizeRef = useRef({ width: 0, height: 0 })
  // Fit on every resize until the user pans or zooms by hand.
  const autoFitRef = useRef(true)
  const dragRef = useRef<{ x: number; y: number; viewX: number; viewY: number; moved: boolean } | null>(null)
  const model = useMemo(() => (data ? buildGraphModel(data) : null), [data])

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const graph = await memoryApi.graph()
      // An unchanged graph keeps the field it is already drawing: a new object
      // would rebuild the model and restart every particle stream.
      const unchanged = lastGraph !== null && JSON.stringify(graph) === JSON.stringify(lastGraph)
      lastGraph = graph
      if (!unchanged) setData(graph)
    } catch (failure) {
      setError(starErrorText(failure))
    }
    setLoading(false)
  }, [])

  const applyView = useCallback((view: GraphView) => {
    viewRef.current = view
    rendererRef.current?.setView(view)
    setZoom(view.scale)
  }, [])

  const fitView = useCallback(() => {
    const { width, height } = sizeRef.current
    if (!width || !height) return
    const extent = modelRef.current?.extent ?? 610
    applyView({ scale: clamp(Math.min(width, height) / (extent * 2), MIN_SCALE, MAX_SCALE), x: width / 2, y: height / 2 })
  }, [applyView])

  const zoomAt = useCallback((x: number, y: number, factor: number) => {
    const view = viewRef.current
    const scale = clamp(view.scale * factor, MIN_SCALE, MAX_SCALE)
    const ratio = scale / view.scale
    autoFitRef.current = false
    applyView({ scale, x: x - (x - view.x) * ratio, y: y - (y - view.y) * ratio })
  }, [applyView])

  useEffect(() => { void load() }, [load])

  const chooseForm = (next: MemoryForm) => {
    if (next === form) return
    writeMemoryForm(next)
    // Each form frames itself: fit the new field rather than keep the old pan.
    autoFitRef.current = true
    dragRef.current = null
    setDragging(false)
    setHover(null)
    setHoverCluster(-1)
    setForm(next)
  }

  // One renderer at a time, on its own canvas: a new form tears the old one down.
  useEffect(() => {
    const canvas = canvasRef.current
    const container = containerRef.current
    if (!canvas || !container) return
    const reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false
    const renderer = createRenderer(form, canvas, readTheme(), reducedMotion)
    rendererRef.current = renderer
    renderer.setModel(modelRef.current)
    const resize = () => {
      const rect = container.getBoundingClientRect()
      sizeRef.current = { width: rect.width, height: rect.height }
      renderer.setSize(rect.width, rect.height, Math.min(2, window.devicePixelRatio || 1))
      if (autoFitRef.current) fitView()
      else renderer.setView(viewRef.current)
    }
    const resizeObserver = new ResizeObserver(resize)
    resizeObserver.observe(container)
    resize()
    // Dragged to a screen with another pixel ratio, the window keeps its size: redraw at the new density.
    let densityQuery: MediaQueryList | undefined
    const onDensity = () => {
      resize()
      watchDensity()
    }
    const watchDensity = () => {
      densityQuery?.removeEventListener?.('change', onDensity)
      densityQuery = window.matchMedia?.(`(resolution: ${window.devicePixelRatio || 1}dppx)`)
      densityQuery?.addEventListener?.('change', onDensity)
    }
    watchDensity()
    const measurePanels = () => {
      const origin = container.getBoundingClientRect()
      renderer.setOccluders([formRef.current, toolsRef.current, cardRef.current].flatMap((panel) => {
        if (!panel) return []
        const rect = panel.getBoundingClientRect()
        return [{ x: rect.left - origin.left, y: rect.top - origin.top, width: rect.width, height: rect.height }]
      }))
    }
    // The card grows when a node is locked; the container moves the panels when it resizes.
    const panelObserver = new ResizeObserver(measurePanels)
    for (const panel of [container, formRef.current, toolsRef.current, cardRef.current]) if (panel) panelObserver.observe(panel)
    measurePanels()
    // Animate only while the page is on screen and the window is in front.
    let onScreen = true
    const sync = () => {
      if (onScreen && !document.hidden) renderer.start()
      else renderer.stop()
    }
    const visibility = new IntersectionObserver(([entry]) => {
      onScreen = Boolean(entry?.isIntersecting)
      sync()
    })
    visibility.observe(container)
    document.addEventListener('visibilitychange', sync)
    const themeObserver = new MutationObserver(() => renderer.setTheme(readTheme()))
    themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme', 'class', 'style'] })
    const onWheel = (event: WheelEvent) => {
      event.preventDefault()
      const rect = container.getBoundingClientRect()
      zoomAt(event.clientX - rect.left, event.clientY - rect.top, Math.exp(-event.deltaY * 0.0015))
    }
    container.addEventListener('wheel', onWheel, { passive: false })
    sync()
    return () => {
      resizeObserver.disconnect()
      panelObserver.disconnect()
      visibility.disconnect()
      themeObserver.disconnect()
      densityQuery?.removeEventListener?.('change', onDensity)
      document.removeEventListener('visibilitychange', sync)
      container.removeEventListener('wheel', onWheel)
      renderer.destroy()
      rendererRef.current = null
    }
  }, [fitView, form, zoomAt])

  useEffect(() => {
    modelRef.current = model
    rendererRef.current?.setModel(model)
    setLocked(null)
    setHover(null)
    if (autoFitRef.current) fitView()
  }, [fitView, model])

  // `form` too: a new form's renderer starts with no focus and every layer on.
  const focusNode = locked ?? hover?.node ?? null
  useEffect(() => {
    if (!model) return
    rendererRef.current?.setFocus(focusNode ? traceChain(model, focusNode.id) : null, focusNode?.id ?? null, focusNode ? focusNode.cluster : hoverCluster)
  }, [focusNode, form, hoverCluster, model])

  useEffect(() => { rendererRef.current?.setLayers(layers) }, [form, layers])

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') setLocked(null) }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const localPoint = (event: ReactPointerEvent): [number, number] => {
    const rect = containerRef.current!.getBoundingClientRect()
    return [event.clientX - rect.left, event.clientY - rect.top]
  }

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return
    const [x, y] = localPoint(event)
    event.currentTarget.setPointerCapture(event.pointerId)
    dragRef.current = { x, y, viewX: viewRef.current.x, viewY: viewRef.current.y, moved: false }
  }

  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const [x, y] = localPoint(event)
    const drag = dragRef.current
    if (drag) {
      if (!drag.moved && Math.hypot(x - drag.x, y - drag.y) > 3) {
        drag.moved = true
        setDragging(true)
        setHover(null)
      }
      if (drag.moved) {
        autoFitRef.current = false
        applyView({ ...viewRef.current, x: drag.viewX + x - drag.x, y: drag.viewY + y - drag.y })
        return
      }
    }
    const renderer = rendererRef.current
    const node = renderer?.hitTest(x, y) ?? null
    setHover((current) => (node ? (current?.node.id === node.id && Math.abs(current.x - x) < 2 && Math.abs(current.y - y) < 2 ? current : { node, x, y }) : null))
    setHoverCluster(node ? -1 : renderer?.clusterAt(x, y) ?? -1)
  }

  const onPointerUp = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current
    dragRef.current = null
    setDragging(false)
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
    if (!drag || drag.moved) return
    const [x, y] = localPoint(event)
    const node = rendererRef.current?.hitTest(x, y) ?? null
    setLocked((current) => (node && current?.id !== node.id ? node : null))
  }

  const zoomBy = (factor: number) => {
    const { width, height } = sizeRef.current
    zoomAt(width / 2, height / 2, factor)
  }

  const clusters = model?.clusters ?? []
  const empty = Boolean(model && model.clusters.length === 0)
  const tooltipLeft = hover ? clamp(hover.x + 16, 8, Math.max(8, sizeRef.current.width - 296)) : 0
  const tooltipTop = hover ? clamp(hover.y + 14, 8, Math.max(8, sizeRef.current.height - 150)) : 0
  const text = FORM_TEXT[form]

  const header = (
    <>
      <p className="min-w-0 flex-1 truncate text-[12px] text-[var(--color-text-tertiary)]">{text.description}</p>
      <div className="flex shrink-0 items-center gap-2">
        <button type="button" onClick={openMemorySettings} className={ACTION}>
          <Brain size={13} strokeWidth={1.75} aria-hidden="true" />管理记忆
        </button>
        <button type="button" onClick={() => void load()} disabled={loading} className={`${ACTION} disabled:opacity-60`}>
          {loading ? <Loader2 size={13} strokeWidth={1.75} className="animate-spin" aria-hidden="true" /> : <RefreshCw size={13} strokeWidth={1.75} aria-hidden="true" />}刷新
        </button>
      </div>
    </>
  )

  return (
    <>
      {actionsSlot ? createPortal(header, actionsSlot) : null}
      <div
        ref={containerRef}
        data-testid="memory-graph"
        data-form={form}
        className={`relative min-h-0 flex-1 touch-none select-none overflow-hidden ${dragging ? 'cursor-grabbing' : hover ? 'cursor-pointer' : 'cursor-grab'}`}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onPointerLeave={() => { if (!dragRef.current) { setHover(null); setHoverCluster(-1) } }}
        onDoubleClick={() => { autoFitRef.current = true; fitView() }}
      >
        <canvas key={form} ref={canvasRef} className="absolute inset-0 h-full w-full" role="img" aria-label={model ? `${text.name}：${model.counts.L3} 个索引、${model.counts.L2} 条记忆、${model.counts.L1} 次会话` : text.name} />

        <div ref={formRef} className="absolute left-4 top-4" onPointerDown={(event) => event.stopPropagation()} onDoubleClick={(event) => event.stopPropagation()}>
          <SegmentedControl label="记忆形态" size="sm" items={FORMS} value={form} onChange={chooseForm} />
        </div>

        <div ref={toolsRef} className="absolute right-4 top-4 flex flex-col items-end gap-2" onPointerDown={(event) => event.stopPropagation()} onDoubleClick={(event) => event.stopPropagation()}>
          <div className="flex items-center gap-0.5 rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-surface-glass)] p-1 backdrop-blur-md">
            <ToolButton label="放大" onClick={() => zoomBy(1.25)}><ZoomIn size={15} aria-hidden="true" /></ToolButton>
            <ToolButton label="缩小" onClick={() => zoomBy(0.8)}><ZoomOut size={15} aria-hidden="true" /></ToolButton>
            <ToolButton label="适配" onClick={() => { autoFitRef.current = true; fitView() }}><Maximize2 size={14} aria-hidden="true" /></ToolButton>
            <span className="w-12 text-center text-[12px] tabular-nums text-[var(--color-text-tertiary)]">{Math.round(zoom * 100)}%</span>
          </div>
          <div className="w-[176px] rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-surface-glass)] p-1.5 backdrop-blur-md">
            {LAYERS.map((layer) => (
              <button
                key={layer}
                type="button"
                aria-pressed={layers[layer]}
                aria-label={`${layers[layer] ? '隐藏' : '显示'} ${layer} ${LAYER_LABELS[layer]}`}
                onClick={() => setLayers((current) => ({ ...current, [layer]: !current[layer] }))}
                className={`flex h-7 w-full items-center gap-2 rounded-[var(--radius-sm)] px-2 text-[12px] transition-colors hover:bg-[var(--color-surface-hover)] ${layers[layer] ? 'text-[var(--color-text-primary)]' : 'text-[var(--color-text-tertiary)]'}`}
              >
                <span className="font-semibold">{layer}</span>
                <span className="flex-1 text-left text-[var(--color-text-secondary)]">{LAYER_LABELS[layer]}</span>
                {layers[layer] ? <Eye size={13} aria-hidden="true" /> : <EyeOff size={13} aria-hidden="true" />}
              </button>
            ))}
            <div data-testid="memory-legend" className="mt-1 grid grid-cols-2 gap-x-2 gap-y-1 border-t border-[var(--color-border)] px-2 pb-1 pt-2 text-[11px] text-[var(--color-text-tertiary)]">
              {form === 'nebula'
                ? NEBULA_GROUPS.map((group) => (
                  <span key={group.key} className="flex items-center gap-1.5">
                    <span className={`h-2 w-2 shrink-0 rounded-[var(--radius-full)] ${TONE_SWATCHES[group.tone]}`} aria-hidden="true" />{group.label}
                  </span>
                ))
                : SHAPE_LEGEND.map(([shape, label]) => (
                  <span key={shape} className={`flex items-center gap-1.5 ${shape === 'ring' ? 'col-span-2' : ''}`}><ShapeMark shape={shape} />{label}</span>
                ))}
            </div>
          </div>
        </div>

        <div ref={cardRef} className="absolute bottom-4 left-4 w-[min(420px,calc(100%-2rem))] rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-surface-glass)] p-3.5 backdrop-blur-md" onPointerDown={(event) => event.stopPropagation()} onDoubleClick={(event) => event.stopPropagation()}>
          {locked && model ? (
            <NodeDetail node={locked} model={model} onUnlock={() => setLocked(null)} />
          ) : (
            <>
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] text-[var(--color-text-secondary)]">
                {LAYERS.map((layer) => (
                  <span key={layer} className="tabular-nums"><span className="font-semibold text-[var(--color-text-primary)]">{layer}</span> {model ? model.counts[layer] : '--'}</span>
                ))}
                {model ? <span className="text-[var(--color-text-tertiary)]">· {clusters.length} 个项目</span> : null}
              </div>
              <p className="mt-1.5 text-[12px] leading-5 text-[var(--color-text-tertiary)]">{empty ? `还没有记忆。${brand.name} 在对话中记下的偏好、反馈和项目背景会出现在这里。` : text.hint}</p>
            </>
          )}
        </div>

        {hover && !dragging && hover.node.id !== locked?.id && model ? (
          <div className="pointer-events-none absolute z-[var(--z-raised)] w-[280px] rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface-container-lowest)] px-3 py-2 shadow-[var(--shadow-dropdown)]" style={{ left: tooltipLeft, top: tooltipTop }}>
            <NodeSummary node={hover.node} model={model} />
          </div>
        ) : null}

        {loading && !data ? (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center"><Loader2 size={20} className="animate-spin text-[var(--color-text-tertiary)]" aria-label="加载中" /></div>
        ) : null}
        {error ? (
          <div className="absolute left-1/2 top-6 -translate-x-1/2 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface-container-lowest)] px-3 py-2 text-[12px] text-[var(--color-error)] shadow-[var(--shadow-dropdown)]" role="alert" onPointerDown={(event) => event.stopPropagation()}>
            记忆图谱加载失败：{error}
            <button type="button" onClick={() => void load()} className="ml-2 text-[var(--color-text-accent)] hover:underline">重试</button>
          </div>
        ) : null}
      </div>
    </>
  )
}

/** 记忆图谱 as its own route: the merged 记忆图谱 · 运行时 page, opened on the graph. */
export function MemoryGraphPage() {
  return <MemoryRuntimePage initialView="memory" />
}

function ToolButton({ label, onClick, children }: { label: string; onClick: () => void; children: ReactNode }) {
  return (
    <button type="button" aria-label={label} title={label} onClick={onClick} className="flex h-7 w-7 items-center justify-center rounded-[var(--radius-sm)] text-[var(--color-text-secondary)] transition-colors hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-text-primary)]">
      {children}
    </button>
  )
}

/** The same marks the canvas draws, for the legend. */
function ShapeMark({ shape }: { shape: MemoryShape }) {
  return (
    <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true" className="shrink-0 text-[var(--color-text-secondary)]">
      {shape === 'circle' ? <circle cx="5" cy="5" r="3.4" fill="currentColor" /> : null}
      {shape === 'diamond' ? <path d="M5 0.8 9.2 5 5 9.2 0.8 5Z" fill="currentColor" /> : null}
      {shape === 'square' ? <rect x="1.6" y="1.6" width="6.8" height="6.8" fill="currentColor" /> : null}
      {shape === 'triangle' ? <path d="M5 0.9 9.2 8.6H0.8Z" fill="currentColor" /> : null}
      {shape === 'ring' ? <circle cx="5" cy="5" r="3.4" fill="none" stroke="currentColor" strokeWidth="1.2" /> : null}
    </svg>
  )
}

function clusterOf(model: GraphModel, node: GraphNode): (GraphModel['clusters'][number]) | undefined {
  return node.cluster >= 0 ? model.clusters[node.cluster] : undefined
}

function NodeSummary({ node, model }: { node: GraphNode; model: GraphModel }) {
  const cluster = clusterOf(model, node)
  if (node.kind === 'core') {
    const user = model.userMemory
    return (
      <>
        <div className="text-[13px] font-semibold text-[var(--color-text-primary)]">L3 综合</div>
        <div className="mt-0.5 text-[12px] text-[var(--color-text-secondary)]">{user.exists ? `用户指令 CLAUDE.md · ${formatBytes(user.bytes)} · 更新于 ${formatWhen(user.updatedAt)}` : '还没有用户级 CLAUDE.md'}</div>
        <div className="mt-0.5 text-[12px] text-[var(--color-text-tertiary)]">{model.clusters.length} 个项目 · {model.counts.L2} 条记忆 · {model.counts.L1} 次会话</div>
      </>
    )
  }
  if (!cluster) return null
  if (node.kind === 'index') {
    return (
      <>
        <div className="truncate text-[13px] font-semibold text-[var(--color-text-primary)]">{cluster.name} · MEMORY.md</div>
        <div className="mt-0.5 text-[12px] text-[var(--color-text-secondary)]">{cluster.data.index.exists ? `${cluster.data.index.links} 条索引链接 · 更新于 ${formatWhen(cluster.data.index.updatedAt)}` : '这个项目还没有 MEMORY.md 索引'}</div>
        <div className="mt-0.5 truncate text-[11px] text-[var(--color-text-tertiary)]">{cluster.data.label}</div>
      </>
    )
  }
  if (node.kind === 'memory' && node.memory) {
    const memory = node.memory
    return (
      <>
        <div className="truncate text-[13px] font-semibold text-[var(--color-text-primary)]">{memory.title}</div>
        <div className="mt-0.5 text-[12px] text-[var(--color-text-secondary)]">{(memory.type && MEMORY_TYPE_LABELS[memory.type]) || '未分类'} · {cluster.name} · 更新于 {formatWhen(memory.updatedAt)}</div>
        {memory.description ? <div className="mt-1 line-clamp-3 text-[12px] leading-5 text-[var(--color-text-tertiary)]">{memory.description}</div> : null}
        {!memory.indexed ? <div className="mt-1 text-[11px] text-[var(--color-text-tertiary)]">未写入 MEMORY.md 索引</div> : null}
      </>
    )
  }
  if (node.kind === 'session' && node.session) {
    const session = node.session
    return (
      <>
        <div className="truncate text-[13px] font-semibold text-[var(--color-text-primary)]">{session.title || '未命名会话'}</div>
        <div className="mt-0.5 text-[12px] text-[var(--color-text-secondary)]">{session.messageCount} 条消息 · {formatWhen(session.modifiedAt)}</div>
        <div className="mt-0.5 truncate text-[11px] text-[var(--color-text-tertiary)]">{cluster.name}</div>
      </>
    )
  }
  return null
}

/** Loads one memory file for the locked card; the graph itself carries metadata only. */
function useMemoryPreview(clusterId: string | null, path: string | null) {
  const key = clusterId && path ? `${clusterId}\n${path}` : ''
  const [result, setResult] = useState<{ key: string; text: string | null; error: string | null } | null>(null)
  useEffect(() => {
    if (!clusterId || !path) return
    let alive = true
    memoryApi.readFile(clusterId, path)
      .then(({ file }) => { if (alive) setResult({ key, text: stripFrontmatter(file.content).slice(0, 2400), error: null }) })
      .catch((failure: unknown) => { if (alive) setResult({ key, text: null, error: starErrorText(failure) }) })
    return () => { alive = false }
  }, [clusterId, key, path])
  if (!key) return null
  return result?.key === key ? result : { key, text: null, error: null, loading: true as const }
}

const ACTION = 'inline-flex h-7 items-center gap-1.5 rounded-[var(--radius-md)] border border-[var(--color-border)] px-2.5 text-[12px] text-[var(--color-text-secondary)] transition-colors hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-text-primary)]'

function NodeDetail({ node, model, onUnlock }: { node: GraphNode; model: GraphModel; onUnlock: () => void }) {
  const cluster = clusterOf(model, node)
  const previewPath = node.kind === 'memory' && node.memory ? node.memory.path : node.kind === 'index' && cluster?.data.index.exists ? 'MEMORY.md' : null
  const preview = useMemoryPreview(cluster && previewPath ? cluster.data.id : null, previewPath)
  const kindLabel = node.kind === 'core' ? 'L3 综合' : node.kind === 'index' ? 'L3 索引' : node.kind === 'memory' ? 'L2 记忆' : 'L1 会话'
  return (
    <div>
      <div className="mb-2 flex items-center gap-1.5 text-[11px] text-[var(--color-text-tertiary)]">
        <Lock size={12} aria-hidden="true" />已锁定 · {kindLabel}
        <button type="button" onClick={onUnlock} aria-label="解除锁定" title="解除锁定（Esc）" className="ml-auto flex h-6 w-6 items-center justify-center rounded-[var(--radius-sm)] hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-text-primary)]">
          <Unlock size={12} aria-hidden="true" />
        </button>
      </div>
      <NodeSummary node={node} model={model} />
      {preview ? (
        <div className="mt-2 max-h-[min(32vh,240px)] overflow-y-auto rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface-container-lowest)] px-3 py-2">
          {preview.text ? <MarkdownRenderer content={preview.text} variant="compact" /> : preview.error ? <span className="text-[12px] text-[var(--color-error)]">{preview.error}</span> : <Loader2 size={14} className="animate-spin text-[var(--color-text-tertiary)]" aria-label="加载记忆" />}
        </div>
      ) : null}
      <div className="mt-2.5 flex flex-wrap gap-2">
        {node.kind === 'memory' && node.memory && cluster ? (
          <button type="button" className={ACTION} onClick={() => openMemoryFile(cluster.data, node.memory!.path)}><PencilLine size={13} aria-hidden="true" />在记忆中编辑</button>
        ) : null}
        {node.kind === 'index' && cluster?.data.index.exists ? (
          <button type="button" className={ACTION} onClick={() => openMemoryFile(cluster.data, 'MEMORY.md')}><PencilLine size={13} aria-hidden="true" />打开索引</button>
        ) : null}
        {node.kind === 'session' && node.session ? (
          <button type="button" className={ACTION} onClick={() => openSession(node.session!)}><MessageSquare size={13} aria-hidden="true" />打开会话</button>
        ) : null}
        {node.id === CORE_ID ? (
          <button type="button" className={ACTION} onClick={openMemorySettings}><PencilLine size={13} aria-hidden="true" />管理记忆</button>
        ) : null}
      </div>
    </div>
  )
}
