import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent, type WheelEvent as ReactWheelEvent } from 'react'
import {
  Bot,
  Clapperboard,
  Copy,
  Download,
  FileText,
  FolderOpen,
  Hand,
  History,
  ImagePlus,
  Layers,
  Maximize,
  Minus,
  MousePointer2,
  PenLine,
  Plus,
  Redo2,
  Scissors,
  Shapes,
  Sheet,
  Square,
  Table2,
  Trash2,
  Type,
  Undo2,
  Wand2,
} from 'lucide-react'
import { designFileUrl, designVersionUrl, isFileTooLargeError, starApi, starErrorText, type DesignBoard, type DesignProject } from '@/api/star'
import { connectorsApi } from '@/api/connectors'
import { Modal } from '@/components/ui/Modal'
import { getDesktopHost } from '@/lib/desktopHost'
import { useStarBrand } from '../../../stores/starBrandStore'
import { useUIStore } from '../../../stores/uiStore'
import { openConnector } from '../market/marketActions'
import { ScaledFrame, formatDate } from '../pages/StarPageShell'
import { BoardEditor, type EditorController, type SaveState } from './BoardEditor'
import { BoardNode } from './BoardNode'
import { LayersPanel, LibraryPanel, PropertiesPanel } from './CanvasPanels'
import { BoardTooLargeForImageError, blankBoardHtml, renderBoardPdf, renderBoardPng, TABLE_IMPORT_LIMITS, withBoardDocument } from './designEditor'
import { readSpreadsheetRows, SPREADSHEET_ACCEPT } from './tableSpreadsheet'
import { boardImageBlob, boardPdfBlob, runBoardOperation, type BoardOperation } from './designMedia'
import { DESIGN_KINDS, KindArt, designKind } from './designModel'

type View = { x: number; y: number; zoom: number }
type Dialog =
  | { type: 'ai'; board: DesignBoard; operation: BoardOperation | 'agent' }
  | { type: 'versions'; board: DesignBoard }
  | { type: 'code'; board: DesignBoard; text: string }
  | null

const toast = (type: 'success' | 'error' | 'info', message: string) => useUIStore.getState().addToast({ type, message })
const MIN_ZOOM = 0.03
const MAX_ZOOM = 4
const clampZoom = (zoom: number) => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom))

function boardNumber(boards: DesignBoard[]): string {
  const max = boards.reduce((value, board) => Math.max(value, Number(/\/(\d{1,3})[-_.\s]/.exec(board.path)?.[1] ?? 0)), 0)
  return String(max + 1).padStart(2, '0')
}

function nextSlot(boards: DesignBoard[]): { x: number; y: number } {
  if (!boards.length) return { x: 0, y: 0 }
  const right = Math.max(...boards.map(board => board.x + board.width))
  return { x: right + 120, y: Math.min(...boards.map(board => board.y)) }
}

export function DesignCanvas({ project, onProject, onAskAgent, libraryOpen }: {
  project: DesignProject
  onProject: (project: DesignProject) => void
  onAskAgent: (text: string) => void
  libraryOpen: boolean
}) {
  const brand = useStarBrand()
  const viewportRef = useRef<HTMLDivElement>(null)
  const [view, setView] = useState<View>(() => project.canvas ?? { x: 80, y: 80, zoom: 0.3 })
  const [tool, setTool] = useState<'select' | 'hand'>('select')
  const [spaceDown, setSpaceDown] = useState(false)
  const [selected, setSelected] = useState<string | null>(null)
  const [editing, setEditing] = useState<string | null>(null)
  const [controller, setController] = useState<EditorController | null>(null)
  const [element, setElement] = useState<HTMLElement | null>(null)
  const [saveState, setSaveState] = useState<SaveState>('saved')
  const [drag, setDrag] = useState<{ path: string; x: number; y: number } | null>(null)
  const [busy, setBusy] = useState<Record<string, string>>({})
  const [dialog, setDialog] = useState<Dialog>(null)
  const [prompt, setPrompt] = useState('')
  const [versions, setVersions] = useState<{ id: string; at: number; size: number }[] | null>(null)
  const [layersOpen, setLayersOpen] = useState(true)
  const [newKind, setNewKind] = useState(project.kind)
  const [menu, setMenu] = useState<'new' | 'export' | 'more' | null>(null)
  const fitted = useRef(Boolean(project.canvas))
  const boards = project.boards
  const board = boards.find(item => item.path === selected) ?? null

  // ── view ───────────────────────────────────────────────
  /** `among` is the board list to fit: a caller that just changed the project passes the new one. */
  const fit = useCallback((only?: DesignBoard, among: DesignBoard[] = boards) => {
    const box = viewportRef.current?.getBoundingClientRect()
    const list = only ? [only] : among.filter(item => !item.hidden)
    if (!box || !list.length) return
    const minX = Math.min(...list.map(item => item.x))
    const minY = Math.min(...list.map(item => item.y))
    const maxX = Math.max(...list.map(item => item.x + item.width))
    const maxY = Math.max(...list.map(item => item.y + item.height))
    const zoom = clampZoom(Math.min((box.width - 160) / (maxX - minX), (box.height - 160) / (maxY - minY), 1))
    setView({ zoom, x: (box.width - (maxX - minX) * zoom) / 2 - minX * zoom, y: (box.height - (maxY - minY) * zoom) / 2 - minY * zoom })
  }, [boards])

  useEffect(() => {
    if (!fitted.current && boards.length) {
      fitted.current = true
      requestAnimationFrame(() => fit())
    }
  }, [boards.length, fit])

  // Remember the view a moment after it settles. Only a changed one: saving the
  // view it opened with rewrote the project on every visit, and moved it to
  // the top of 最近项目 without anything in it changing.
  const savedView = useRef<View | null>(project.canvas)
  useEffect(() => {
    const saved = savedView.current
    if (saved && Math.abs(saved.x - view.x) < 1 && Math.abs(saved.y - view.y) < 1 && Math.abs(saved.zoom - view.zoom) < 0.005) return
    const timer = window.setTimeout(() => {
      savedView.current = view
      void starApi.patchDesignProject(project.id, { canvas: view }).catch(() => undefined)
    }, 1500)
    return () => window.clearTimeout(timer)
  }, [project.id, view])

  const zoomAt = (factor: number, clientX?: number, clientY?: number) => {
    const box = viewportRef.current?.getBoundingClientRect()
    if (!box) return
    const px = (clientX ?? box.left + box.width / 2) - box.left
    const py = (clientY ?? box.top + box.height / 2) - box.top
    setView(current => {
      const zoom = clampZoom(current.zoom * factor)
      return { zoom, x: px - ((px - current.x) / current.zoom) * zoom, y: py - ((py - current.y) / current.zoom) * zoom }
    })
  }

  const onWheel = (event: ReactWheelEvent) => {
    if (event.ctrlKey || event.metaKey) {
      zoomAt(Math.exp(-event.deltaY * 0.0022), event.clientX, event.clientY)
    } else {
      setView(current => ({ ...current, x: current.x - event.deltaX, y: current.y - event.deltaY }))
    }
  }

  // Read by the key handler, which is bound once per editing state.
  const keyState = useRef({ board, controller, remove: (_item: DesignBoard) => Promise.resolve() })

  useEffect(() => {
    const down = (event: KeyboardEvent) => {
      const typing = (event.target as HTMLElement | null)?.closest?.('input, textarea, select, [contenteditable="true"]')
      if (typing || event.defaultPrevented) return
      // The page can stay mounted under another tab, and a dialog owns its keys.
      const viewport = viewportRef.current
      if (!viewport || viewport.getClientRects().length === 0 || document.querySelector('[role="dialog"][aria-modal="true"]')) return
      if (event.code === 'Space') { setSpaceDown(true); return }
      const remove = event.key === 'Delete' || event.key === 'Backspace'
      if (editing) {
        // Focus is outside the board (a toolbar button, the layer list): the
        // keys still act on the element selected in it, as the panel says.
        const current = keyState.current.controller
        if (!current) return
        if (remove) {
          event.preventDefault()
          current.remove()
          return
        }
        const step = event.shiftKey ? 10 : 1
        const move = ({ ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] } as Record<string, [number, number]>)[event.key]
        if (move) {
          event.preventDefault()
          current.nudge(move[0], move[1])
        }
        return
      }
      const selectedBoard = keyState.current.board
      if (remove && selectedBoard) {
        event.preventDefault()
        // A locked board does not move on the canvas; it does not go by a stray key either.
        if (selectedBoard.locked) toast('info', `画板「${selectedBoard.name}」已锁定，先在画板列表里解锁`)
        else void keyState.current.remove(selectedBoard)
        return
      }
      if (event.key === 'v' || event.key === 'V') setTool('select')
      if (event.key === 'h' || event.key === 'H') setTool('hand')
      if (event.shiftKey && event.key === '!') fit()
      if (event.key === 'Escape') setSelected(null)
    }
    const up = (event: KeyboardEvent) => { if (event.code === 'Space') setSpaceDown(false) }
    window.addEventListener('keydown', down)
    window.addEventListener('keyup', up)
    return () => { window.removeEventListener('keydown', down); window.removeEventListener('keyup', up) }
  }, [editing, fit])

  // ── pan & board drag ───────────────────────────────────
  const startPan = (event: ReactPointerEvent) => {
    const start = { x: event.clientX, y: event.clientY, view }
    const move = (next: PointerEvent) => setView({ ...start.view, x: start.view.x + next.clientX - start.x, y: start.view.y + next.clientY - start.y })
    const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up) }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  const onViewportDown = (event: ReactPointerEvent) => {
    if (event.button === 1 || tool === 'hand' || spaceDown || event.target === viewportRef.current || (event.target as HTMLElement).dataset.canvasBg) {
      if (event.button === 0 && !spaceDown && tool !== 'hand') setSelected(null)
      startPan(event)
    }
  }

  const onBoardDown = useCallback((event: ReactPointerEvent, item: DesignBoard) => {
    if (event.button === 1 || tool === 'hand' || spaceDown) return
    event.stopPropagation()
    if (editing === item.path) return
    setSelected(item.path)
    if (item.locked) return
    const start = { x: event.clientX, y: event.clientY }
    let moved = false
    const move = (next: PointerEvent) => {
      const dx = (next.clientX - start.x) / view.zoom
      const dy = (next.clientY - start.y) / view.zoom
      if (!moved && Math.abs(dx) + Math.abs(dy) < 2 / view.zoom) return
      moved = true
      setDrag({ path: item.path, x: Math.round(item.x + dx), y: Math.round(item.y + dy) })
    }
    const up = (next: PointerEvent) => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      if (!moved) return
      const x = Math.round(item.x + (next.clientX - start.x) / view.zoom)
      const y = Math.round(item.y + (next.clientY - start.y) / view.zoom)
      onProject({ ...project, boards: project.boards.map(entry => (entry.path === item.path ? { ...entry, x, y } : entry)) })
      setDrag(null)
      void starApi.patchDesignProject(project.id, { boards: { [item.path]: { x, y } } }).then(result => onProject(result.project)).catch(error => toast('error', starErrorText(error)))
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }, [editing, onProject, project, spaceDown, tool, view.zoom])

  // ── board actions ──────────────────────────────────────
  const apply = (promise: Promise<{ project: DesignProject } | DesignProject>) =>
    promise.then(result => onProject('project' in result ? result.project : result)).catch(error => toast('error', starErrorText(error)))

  const createBoard = async (kindId = newKind) => {
    const kind = designKind(kindId)
    const width = kindId === project.kind ? project.width : kind.width
    const height = kindId === project.kind ? project.height : kind.height
    const rel = `artboards/${boardNumber(boards)}-${kind.label}.html`
    const slot = nextSlot(boards)
    try {
      await starApi.writeDesignFile(project.id, rel, blankBoardHtml(width, height))
      const result = await starApi.patchDesignProject(project.id, { boards: { [rel]: { ...slot, width, height } } })
      onProject(result.project)
      setSelected(rel)
      // Fit the boards as they are now, the new one included: `fit` still
      // holds the list from before it existed. It reads only the viewport
      // size, so it need not wait for a frame (none comes in a hidden window).
      fit(undefined, result.project.boards)
    } catch (error) {
      toast('error', starErrorText(error))
    }
  }

  const duplicate = async (item: DesignBoard) => {
    const slot = { x: item.x + item.width + 120, y: item.y }
    await apply(starApi.addDesignMediaBoard(project.id, { source: item.path, name: `${item.name}-副本`, ...slot }))
  }

  const remove = async (item: DesignBoard) => {
    if (!window.confirm(`删除画板「${item.name}」？文件会移到项目的 .star/trash。`)) return
    if (editing === item.path) setEditing(null)
    setSelected(null)
    await apply(starApi.deleteDesignFile(project.id, item.path))
  }
  keyState.current = { board, controller, remove }

  const patchBoard = (item: DesignBoard, patch: Partial<Pick<DesignBoard, 'name' | 'hidden' | 'locked'>>) =>
    apply(starApi.patchDesignProject(project.id, { boards: { [item.path]: patch } }))

  const arrange = async () => {
    let x = 0
    const layout: Record<string, { x: number; y: number }> = {}
    for (const item of boards) {
      layout[item.path] = { x, y: 0 }
      x += item.width + 120
    }
    try {
      const result = await starApi.patchDesignProject(project.id, { boards: layout })
      onProject(result.project)
      fit(undefined, result.project.boards)
    } catch (error) {
      toast('error', starErrorText(error))
    }
  }

  const exportPng = async (item: DesignBoard) => {
    setBusy(current => ({ ...current, [item.path]: '导出中…' }))
    try {
      const blob = editing === item.path && controller
        ? await renderBoardPng(controller.doc, item.width, item.height)
        : item.kind === 'html'
          ? await withBoardDocument(project.id, await starApi.designFileText(project.id, item.path), item.width, item.height, doc => renderBoardPng(doc, item.width, item.height))
          : await boardImageBlob(project, item)
      const rel = `assets/exports/${item.name.replace(/[\\/:*?"<>|]+/g, '-')}-${Date.now().toString(36)}.png`
      onProject(await starApi.writeDesignFile(project.id, rel, blob, 'image/png'))
      toast('success', `已导出到项目 ${rel}`)
    } catch (error) {
      // A picture too large to save goes the same way as one too large to draw: to PDF.
      const tooLarge = !(error instanceof BoardTooLargeForImageError) && isFileTooLargeError(error) ? '，请改用「导出 PDF」' : ''
      toast('error', `导出失败：${starErrorText(error)}${tooLarge}`)
    }
    setBusy(current => { const next = { ...current }; delete next[item.path]; return next })
  }

  // Strips of the board, a page each, so a board of any height exports.
  const exportPdf = async (item: DesignBoard) => {
    setBusy(current => ({ ...current, [item.path]: '导出 PDF…' }))
    const progress = (page: number, total: number) => setBusy(current => ({ ...current, [item.path]: `导出 PDF ${page}/${total} 页…` }))
    try {
      const blob = editing === item.path && controller
        ? await renderBoardPdf(controller.doc, item.width, item.height, progress)
        : await boardPdfBlob(project, item, progress)
      const rel = `assets/exports/${item.name.replace(/[\\/:*?"<>|]+/g, '-')}-${Date.now().toString(36)}.pdf`
      onProject(await starApi.writeDesignFile(project.id, rel, blob, 'application/pdf'))
      toast('success', `已导出到项目 ${rel}`)
    } catch (error) {
      toast('error', `导出失败：${starErrorText(error)}`)
    }
    setBusy(current => { const next = { ...current }; delete next[item.path]; return next })
  }

  const runOperation = async (item: DesignBoard, operation: BoardOperation, text: string) => {
    setBusy(current => ({ ...current, [item.path]: '准备中…' }))
    try {
      onProject(await runBoardOperation(project, item, operation, text, progress => setBusy(current => ({ ...current, [item.path]: progress }))))
      toast('success', '已生成，结果放在右侧新画板')
    } catch (error) {
      toast('error', starErrorText(error))
    }
    setBusy(current => { const next = { ...current }; delete next[item.path]; return next })
  }

  const submitDialog = () => {
    if (dialog?.type !== 'ai') return
    const text = prompt.trim()
    if (dialog.operation === 'agent') {
      if (text) onAskAgent(`请修改画板 ${dialog.board.path}（${dialog.board.name}）：${text}`)
    } else if (text || dialog.operation !== 'image2image') {
      void runOperation(dialog.board, dialog.operation, text)
    }
    setDialog(null)
    setPrompt('')
  }

  const openVersions = async (item: DesignBoard) => {
    setDialog({ type: 'versions', board: item })
    setVersions(null)
    try {
      setVersions((await starApi.designVersions(project.id, item.path)).versions.reverse())
    } catch (error) {
      toast('error', starErrorText(error))
    }
  }

  const openCode = async (item: DesignBoard) => {
    try {
      setDialog({ type: 'code', board: item, text: await starApi.designFileText(project.id, item.path) })
    } catch (error) {
      toast('error', starErrorText(error))
    }
  }

  const askCanva = async (item: DesignBoard) => {
    const canva = await connectorsApi.detail('canva').then(result => result.connector).catch(() => null)
    if (!canva?.installed) {
      toast('info', '先安装并授权 Canva 连接器，再回到这里分层编辑')
      openConnector('canva')
      return
    }
    onAskAgent(`使用 Canva 连接器，把画板 ${item.path}（${item.name}）在 Canva 中重建为可编辑的分层设计：背景、图片、文字分别是独立图层，完成后返回 Canva 编辑链接，并把导出的成品放回 artboards/。`)
  }

  const onDoubleClick = useCallback((item: DesignBoard) => {
    if (item.locked) return
    if (item.kind === 'html') { setSelected(item.path); setEditing(item.path) } else if (item.kind === 'svg') void openCode(item)
    else if (item.kind === 'image') { setSelected(item.path); setDialog({ type: 'ai', board: item, operation: 'image2image' }) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project.id])

  const upload = async (files: FileList) => {
    let latest = project
    for (const file of Array.from(files)) {
      try {
        const asset = await starApi.uploadDesignAsset(project.id, file, file.name)
        latest = (await starApi.designProject(project.id)).project
        if (!libraryOpen) {
          const slot = nextSlot(latest.boards)
          latest = (await starApi.addDesignMediaBoard(project.id, { source: asset.path, name: file.name.replace(/\.[^.]+$/, ''), ...slot })).project
        }
      } catch (error) {
        toast('error', `${file.name}：${starErrorText(error)}`)
      }
    }
    onProject(latest)
  }

  const pickAsset = async (rel: string) => {
    if (editing && controller) {
      const asset = project.assets.find(item => item.path === rel)
      if (asset?.kind === 'image') controller.insert('image', designFileUrl(project.id, rel))
      return
    }
    const slot = nextSlot(boards)
    await apply(starApi.addDesignMediaBoard(project.id, { source: rel, name: rel.split('/').pop()!.replace(/\.[^.]+$/, ''), ...slot }))
  }

  const finishEditing = async () => {
    await controller?.flush()
    setEditing(null)
    setElement(null)
  }

  const selectionScreen = useMemo(() => {
    if (!board) return null
    const position = drag?.path === board.path ? drag : board
    return { left: view.x + position.x * view.zoom, top: view.y + position.y * view.zoom, width: board.width * view.zoom }
  }, [board, drag, view])

  const toolButton = (active: boolean) => `flex h-8 w-8 items-center justify-center rounded-[var(--radius-md)] transition-colors ${active ? 'bg-[#4f7cff] text-white' : 'text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-text-primary)]'}`
  // Whole buttons wrap to a new row in a narrow canvas; a label never breaks per character.
  const actionButton = 'inline-flex h-7 shrink-0 items-center gap-1 whitespace-nowrap rounded-[var(--radius-sm)] px-2 text-[12px] text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-text-primary)]'
  const menuItem = 'flex w-full items-center gap-2 rounded-[var(--radius-sm)] px-2.5 py-1.5 text-left text-[12px] hover:bg-[var(--color-surface-hover)]'
  const editingBoard = boards.find(item => item.path === editing) ?? null

  return (
    <div className="flex h-full min-h-0">
      {libraryOpen ? <LibraryPanel project={project} onUpload={files => void upload(files)} onPick={rel => void pickAsset(rel)} /> : null}
      <div
        ref={viewportRef}
        className={`relative min-w-0 flex-1 overflow-hidden ${tool === 'hand' || spaceDown ? 'cursor-grab' : ''}`}
        style={{ backgroundColor: 'var(--color-surface-container-low)', backgroundImage: 'radial-gradient(var(--color-border) 1px, transparent 1px)', backgroundSize: `${Math.max(8, 24 * view.zoom)}px ${Math.max(8, 24 * view.zoom)}px`, backgroundPosition: `${view.x}px ${view.y}px` }}
        onPointerDown={onViewportDown}
        onWheel={onWheel}
        onDragOver={event => event.preventDefault()}
        onDrop={event => { event.preventDefault(); if (event.dataTransfer.files.length) void upload(event.dataTransfer.files) }}
      >
        <div data-canvas-bg="1" className="absolute inset-0" />
        <div className="absolute left-0 top-0" style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.zoom})`, transformOrigin: '0 0' }}>
          {boards.map(item => {
            const position = drag?.path === item.path ? drag : item
            return (
              <BoardNode key={item.path} projectId={project.id} board={item} x={position.x} y={position.y} zoom={view.zoom}
                selected={selected === item.path} editing={editing === item.path} busy={busy[item.path]}
                onPointerDown={onBoardDown} onDoubleClick={onDoubleClick}>
                {editing === item.path ? (
                  <BoardEditor project={project} board={item} onReady={setController} onSelectElement={setElement} onSaveState={setSaveState} onSaved={onProject} />
                ) : null}
              </BoardNode>
            )
          })}
        </div>

        {boards.length === 0 ? (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-5">
            <div className="text-[13px] text-[var(--color-text-tertiary)]">选择产物类型并创建空白画布</div>
            <div className="flex flex-wrap justify-center gap-3">
              {DESIGN_KINDS.slice(0, 5).map(kind => (
                <button key={kind.id} type="button" onClick={() => setNewKind(kind.id)} className="flex w-[84px] flex-col items-center gap-1.5">
                  <span className={`flex h-[46px] w-[76px] items-center justify-center rounded-[var(--radius-md)] border ${newKind === kind.id ? 'border-[#4f7cff] bg-[rgba(79,124,255,0.1)] text-[#4f7cff]' : 'border-[var(--color-border)] bg-[var(--color-surface-container)] text-[var(--color-text-tertiary)]'}`}><KindArt art={kind.art} active={newKind === kind.id} /></span>
                  <span className={`text-[12px] ${newKind === kind.id ? 'text-[#4f7cff]' : 'text-[var(--color-text-secondary)]'}`}>{kind.label}</span>
                </button>
              ))}
            </div>
            <button type="button" onClick={() => void createBoard()} className="h-8 rounded-[var(--radius-md)] bg-[var(--color-surface-container-high)] px-4 text-[12px] font-medium text-[var(--color-text-primary)] hover:bg-[var(--color-surface-container-highest,var(--color-surface-hover))]">创建画布</button>
            <div className="text-[12px] text-[var(--color-text-tertiary)]">也可以直接在左侧对话里描述需求，{brand.name} 会把画板生成到这里</div>
          </div>
        ) : null}

        {board && selectionScreen && !editing && !drag ? (
          <div className="absolute z-10 flex -translate-y-full flex-wrap items-center gap-0.5 rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-surface-container-lowest)] p-1 shadow-[var(--shadow-dropdown)]"
            style={{ left: Math.max(8, selectionScreen.left), top: Math.max(48, selectionScreen.top - 30), maxWidth: `calc(100% - ${Math.max(8, selectionScreen.left) + 8}px)` }} onPointerDown={event => event.stopPropagation()}>
            {board.kind === 'html' ? <button type="button" className={actionButton} onClick={() => setEditing(board.path)}><PenLine size={13} aria-hidden="true" />编辑</button> : null}
            <button type="button" className={actionButton} onClick={() => { setPrompt(''); setDialog({ type: 'ai', board, operation: 'agent' }) }}><Bot size={13} aria-hidden="true" />AI 修改</button>
            {board.kind !== 'video' ? (
              <>
                <button type="button" className={actionButton} onClick={() => { setPrompt(''); setDialog({ type: 'ai', board, operation: 'image2image' }) }}><Wand2 size={13} aria-hidden="true" />图生图</button>
                <button type="button" className={actionButton} onClick={() => { setPrompt(''); setDialog({ type: 'ai', board, operation: 'image2video' }) }}><Clapperboard size={13} aria-hidden="true" />图生视频</button>
                <button type="button" className={actionButton} onClick={() => void runOperation(board, 'cutout', '')}><Scissors size={13} aria-hidden="true" />抠图</button>
              </>
            ) : null}
            <div className="relative">
              <button type="button" className={actionButton} onClick={() => setMenu(menu === 'more' ? null : 'more')}>更多</button>
              {menu === 'more' ? (
                <div className="absolute left-0 top-8 z-20 w-[210px] rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-surface-container-lowest)] p-1 shadow-[var(--shadow-dropdown)]" onMouseLeave={() => setMenu(null)}>
                  <button type="button" className={menuItem} onClick={() => { setMenu(null); onAskAgent(`把画板 ${board.path}（${board.name}）拆分图层：按 .star/brief.md 中“拆分图层”的流程，生成背景图与独立的文字、元素图层，输出新的 HTML 画板，原画板保留。`) }}><Layers size={13} aria-hidden="true" />图层分离</button>
                  <button type="button" className={menuItem} onClick={() => { setMenu(null); onAskAgent(`把画板 ${board.path}（${board.name}）重绘成矢量 SVG 画板（artboards/ 下新文件），保留构图与配色，形状分组命名。`) }}><Shapes size={13} aria-hidden="true" />转成矢量图</button>
                  <button type="button" className={menuItem} onClick={() => { setMenu(null); onAskAgent(`以画板 ${board.path}（${board.name}）的风格做一套 4 张的套图，每张一个新画板，配色与版式统一。`) }}><Copy size={13} aria-hidden="true" />生成同款套图</button>
                  <button type="button" className={menuItem} onClick={() => { setMenu(null); void askCanva(board) }}><img src="connectors/canva.svg" alt="" className="h-[13px] w-[13px]" />在 Canva 中分层编辑</button>
                  <div className="my-1 h-px bg-[var(--color-border)]" />
                  {board.kind === 'html' || board.kind === 'svg' ? <button type="button" className={menuItem} onClick={() => { setMenu(null); void openCode(board) }}><PenLine size={13} aria-hidden="true" />编辑代码</button> : null}
                  {board.versions > 1 ? <button type="button" className={menuItem} onClick={() => { setMenu(null); void openVersions(board) }}><History size={13} aria-hidden="true" />历史版本</button> : null}
                  <button type="button" className={menuItem} onClick={() => { setMenu(null); void exportPng(board) }}><Download size={13} aria-hidden="true" />导出 PNG</button>
                  {board.kind !== 'video' ? <button type="button" className={menuItem} onClick={() => { setMenu(null); void exportPdf(board) }}><FileText size={13} strokeWidth={1.75} aria-hidden="true" />导出 PDF（长画板分页）</button> : null}
                  <button type="button" className={menuItem} onClick={() => { setMenu(null); void getDesktopHost().shell.openPath(`${project.dir}/artboards`) }}><FolderOpen size={13} aria-hidden="true" />在文件夹中显示（HTML/SVG）</button>
                  <button type="button" className={menuItem} onClick={() => { setMenu(null); void duplicate(board) }}><Copy size={13} aria-hidden="true" />复制画板</button>
                  <button type="button" className={`${menuItem} text-[var(--color-error)]`} onClick={() => { setMenu(null); void remove(board) }}><Trash2 size={13} aria-hidden="true" />删除</button>
                </div>
              ) : null}
            </div>
          </div>
        ) : null}

        {editingBoard && controller ? (
          // Centred in the room left of the side panels (232px at right-3), so
          // it never sits under them; a narrow canvas gives it a second row.
          <div className="pointer-events-none absolute left-3 right-[256px] top-3 z-10 flex justify-center">
          <div className="pointer-events-auto flex max-w-full flex-wrap items-center justify-center gap-0.5 rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-surface-container-lowest)] p-1 shadow-[var(--shadow-dropdown)]" onPointerDown={event => event.stopPropagation()}>
            <span className="max-w-[180px] truncate whitespace-nowrap px-2 text-[12px] text-[var(--color-text-tertiary)]" title={editingBoard.name}>编辑「{editingBoard.name}」</span>
            <button type="button" className={actionButton} onClick={() => controller.insert('text')}><Type size={13} aria-hidden="true" />文字</button>
            <button type="button" className={actionButton} onClick={() => controller.insert('shape')}><Square size={13} aria-hidden="true" />形状</button>
            <button type="button" className={actionButton} onClick={() => controller.insert('table')}><Table2 size={13} aria-hidden="true" />表格</button>
            {/* A spreadsheet's first sheet as a new table; ranges copied from one paste straight into a table. */}
            <label className={`${actionButton} cursor-pointer`} title="把 Excel / CSV 的第一个工作表导入为表格"><Sheet size={13} strokeWidth={1.75} aria-hidden="true" />导入表格
              <input type="file" accept={SPREADSHEET_ACCEPT} aria-label="导入表格文件" className="hidden" onChange={event => {
                const file = event.target.files?.[0]
                event.target.value = ''
                if (!file) return
                void readSpreadsheetRows(file).then(({ rows, truncated }) => {
                  const result = controller.insertTable(rows)
                  toast('success', truncated || result.truncated ? `已导入「${file.name}」，表格较大，只保留前 ${TABLE_IMPORT_LIMITS.rows} 行、${TABLE_IMPORT_LIMITS.columns} 列` : `已导入「${file.name}」`)
                }).catch(error => toast('error', error instanceof Error ? error.message : starErrorText(error)))
              }} />
            </label>
            <label className={`${actionButton} cursor-pointer`}><ImagePlus size={13} aria-hidden="true" />图片
              <input type="file" accept="image/*" className="hidden" onChange={event => {
                const file = event.target.files?.[0]
                event.target.value = ''
                if (!file) return
                void starApi.uploadDesignAsset(project.id, file, file.name).then(asset => controller.insert('image', designFileUrl(project.id, asset.path))).catch(error => toast('error', starErrorText(error)))
              }} />
            </label>
            <button type="button" aria-label="撤销" className={actionButton} onClick={controller.undo}><Undo2 size={13} aria-hidden="true" /></button>
            <button type="button" aria-label="重做" className={actionButton} onClick={controller.redo}><Redo2 size={13} aria-hidden="true" /></button>
            <span className="whitespace-nowrap px-2 text-[11px] text-[var(--color-text-tertiary)]">{saveState === 'saving' ? '保存中…' : saveState === 'dirty' ? '未保存' : saveState === 'error' ? '保存失败' : '已保存'}</span>
            <button type="button" onClick={() => void finishEditing()} className="h-7 shrink-0 whitespace-nowrap rounded-[var(--radius-sm)] bg-[#4f7cff] px-3 text-[12px] font-medium text-white">完成</button>
          </div>
          </div>
        ) : null}

        <div className="absolute bottom-4 left-1/2 z-10 flex w-max -translate-x-1/2 items-center gap-0.5 rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-surface-container-lowest)] p-1 shadow-[var(--shadow-dropdown)]" onPointerDown={event => event.stopPropagation()}>
          <button type="button" aria-label="选择 (V)" title="选择 (V)" className={toolButton(tool === 'select')} onClick={() => setTool('select')}><MousePointer2 size={15} aria-hidden="true" /></button>
          <button type="button" aria-label="抓手 (H / 空格)" title="抓手 (H / 空格)" className={toolButton(tool === 'hand')} onClick={() => setTool('hand')}><Hand size={15} aria-hidden="true" /></button>
          <span className="mx-1 h-5 w-px bg-[var(--color-border)]" />
          <div className="relative">
            <button type="button" aria-label="新建画板" title="新建画板" className={toolButton(false)} onClick={() => setMenu(menu === 'new' ? null : 'new')}><Plus size={15} aria-hidden="true" /></button>
            {menu === 'new' ? (
              <div className="absolute bottom-10 left-0 w-[200px] rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-surface-container-lowest)] p-1 shadow-[var(--shadow-dropdown)]" onMouseLeave={() => setMenu(null)}>
                {DESIGN_KINDS.map(kind => (
                  <button key={kind.id} type="button" className={menuItem} onClick={() => { setMenu(null); void createBoard(kind.id) }}>
                    <span className="h-4 w-6 text-[var(--color-text-tertiary)]"><KindArt art={kind.art} /></span>{kind.label}<span className="ml-auto text-[11px] text-[var(--color-text-tertiary)]">{kind.width}×{kind.height}</span>
                  </button>
                ))}
              </div>
            ) : null}
          </div>
          <label aria-label="上传图片" title="上传图片或视频" className={`${toolButton(false)} cursor-pointer`}><ImagePlus size={15} aria-hidden="true" /><input type="file" multiple accept="image/*,video/*" className="hidden" onChange={event => { if (event.target.files?.length) void upload(event.target.files); event.target.value = '' }} /></label>
          <button type="button" aria-label="排成一行" title="排成一行（套图）" className={toolButton(false)} onClick={() => void arrange()}><Layers size={15} aria-hidden="true" /></button>
          <span className="mx-1 h-5 w-px bg-[var(--color-border)]" />
          <button type="button" aria-label="缩小" className={toolButton(false)} onClick={() => zoomAt(1 / 1.2)}><Minus size={15} aria-hidden="true" /></button>
          <button type="button" title="Ctrl + 滚轮缩放，滚轮平移" className="w-12 text-center text-[12px] tabular-nums text-[var(--color-text-secondary)]" onClick={() => setView(current => ({ ...current, zoom: 1 }))}>{Math.round(view.zoom * 100)}%</button>
          <button type="button" aria-label="放大" className={toolButton(false)} onClick={() => zoomAt(1.2)}><Plus size={15} aria-hidden="true" /></button>
          <button type="button" aria-label="适应画布 (Shift+1)" title="适应画布 (Shift+1)" className={toolButton(false)} onClick={() => fit()}><Maximize size={14} aria-hidden="true" /></button>
          <button type="button" aria-label="图层面板" title="图层面板" className={toolButton(layersOpen)} onClick={() => setLayersOpen(open => !open)}><Layers size={15} aria-hidden="true" /></button>
        </div>

        {(layersOpen && boards.length > 0) || (editing && controller) ? (
          <div className="absolute bottom-20 right-3 top-3 z-10 flex w-[232px] flex-col gap-2" onPointerDown={event => event.stopPropagation()}>
            {layersOpen ? (
              <LayersPanel boards={boards} selected={selected} editing={editing} controller={controller} element={element}
                onSelect={item => { setSelected(item.path); fit(item) }}
                onToggle={(item, key) => void patchBoard(item, { [key]: !item[key] })}
                onRename={(item, name) => void patchBoard(item, { name })} />
            ) : null}
            {editing && controller ? <PropertiesPanel controller={controller} element={element} /> : null}
          </div>
        ) : null}
      </div>

      <Modal open={dialog?.type === 'ai'} onClose={() => setDialog(null)} width={520}
        title={dialog?.type === 'ai' ? ({ agent: 'AI 修改画板', image2image: '图生图', image2video: '图生视频', cutout: '抠图' } as const)[dialog.operation] : ''}
        footer={<div className="flex w-full justify-end gap-2"><button type="button" onClick={() => setDialog(null)} className="h-8 rounded-[var(--radius-md)] border border-[var(--color-border)] px-3 text-[13px]">取消</button><button type="button" onClick={submitDialog} className="h-8 rounded-[var(--radius-md)] bg-[var(--color-btn-primary-bg)] px-3 text-[13px] font-medium text-[var(--color-btn-primary-fg)]">开始</button></div>}>
        {dialog?.type === 'ai' ? (
          <div className="space-y-2 text-[13px] text-[var(--color-text-secondary)]">
            <p>{dialog.operation === 'agent' ? `描述要怎么改，${brand.name} 会直接修改这个画板（原内容保存为历史版本）。` : dialog.operation === 'image2video' ? '以画板为首帧生成 5 秒视频，结果作为新画板放在右侧。' : '以画板为参考图生成新图，结果作为新画板放在右侧。'}</p>
            <textarea autoFocus value={prompt} onChange={event => setPrompt(event.target.value)} rows={4} onKeyDown={event => { if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) submitDialog() }}
              placeholder={dialog.operation === 'agent' ? '例如：标题改成金色、加大一号，背景换成深蓝渐变' : dialog.operation === 'image2video' ? '例如：镜头缓慢推进，人物抬头微笑（可留空）' : '例如：改成水彩插画风格，保留构图'}
              className="w-full rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface-container-lowest)] px-3 py-2 outline-none" />
          </div>
        ) : null}
      </Modal>

      <Modal open={dialog?.type === 'versions'} onClose={() => setDialog(null)} width={860} title={dialog?.type === 'versions' ? `历史版本 · ${dialog.board.name}` : ''}>
        {dialog?.type === 'versions' ? (
          versions === null ? <div className="py-10 text-center text-[13px] text-[var(--color-text-tertiary)]">加载中…</div> : (
            <div className="grid max-h-[60vh] grid-cols-3 gap-3 overflow-y-auto">
              {versions.map((version, index) => (
                <div key={version.id} className="overflow-hidden rounded-[var(--radius-md)] border border-[var(--color-border)]">
                  <ScaledFrame src={designVersionUrl(project.id, dialog.board.path, version.id)} width={dialog.board.width} height={dialog.board.height} title={`版本 ${version.id}`} sandbox="" className="max-h-[220px]" />
                  <div className="flex items-center justify-between px-2 py-1.5 text-[11px] text-[var(--color-text-tertiary)]">
                    {formatDate(version.at)}{index === 0 ? ' · 当前' : ''}
                    {index > 0 ? <button type="button" onClick={() => { void apply(starApi.restoreDesignVersion(project.id, dialog.board.path, version.id)); setDialog(null) }} className="text-[var(--color-text-accent)] hover:underline">恢复</button> : null}
                  </div>
                </div>
              ))}
            </div>
          )
        ) : null}
      </Modal>

      <Modal open={dialog?.type === 'code'} onClose={() => setDialog(null)} width={900} title={dialog?.type === 'code' ? `编辑代码 · ${dialog.board.name}` : ''}
        footer={dialog?.type === 'code' ? <div className="flex w-full justify-end gap-2"><button type="button" onClick={() => setDialog(null)} className="h-8 rounded-[var(--radius-md)] border border-[var(--color-border)] px-3 text-[13px]">取消</button><button type="button" onClick={() => { const current = dialog; setDialog(null); void starApi.writeDesignFile(project.id, current.board.path, current.text, current.board.kind === 'svg' ? 'image/svg+xml' : 'text/html; charset=utf-8').then(onProject).catch(error => toast('error', starErrorText(error))) }} className="h-8 rounded-[var(--radius-md)] bg-[var(--color-btn-primary-bg)] px-3 text-[13px] font-medium text-[var(--color-btn-primary-fg)]">保存</button></div> : null}>
        {dialog?.type === 'code' ? <textarea value={dialog.text} onChange={event => setDialog({ ...dialog, text: event.target.value })} spellCheck={false} className="h-[60vh] w-full rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface-container-lowest)] p-3 font-mono text-[12px] leading-5 outline-none" /> : null}
      </Modal>
      {menu ? <button type="button" aria-label="关闭菜单" className="fixed inset-0 z-[var(--z-base)] cursor-default" onClick={() => setMenu(null)} /> : null}
    </div>
  )
}
