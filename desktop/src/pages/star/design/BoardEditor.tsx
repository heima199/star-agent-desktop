import { useCallback, useEffect, useRef, useState } from 'react'
import { starApi, starErrorText, type DesignBoard, type DesignProject } from '@/api/star'
import { useUIStore } from '../../../stores/uiStore'
import { attachEditor, insertLayer, insertTableLayer, listLayers, serializeDocument, toEditableHtml, type LayerItem, type LayerKind, type TableEdit } from './designEditor'

export type EditorController = {
  doc: Document
  insert: (kind: LayerKind, src?: string) => void
  /** Adds a table layer holding `rows` (the first the header); says whether rows or columns were left out. */
  insertTable: (rows: string[][]) => { truncated: boolean }
  select: (element: HTMLElement | null) => void
  /** Deletes the selected element (the Delete key, from the board or the panels around it). */
  remove: () => void
  nudge: (dx: number, dy: number) => void
  /** The selected table's current cell, if a cell was clicked. */
  activeCell: () => HTMLTableCellElement | null
  table: (edit: TableEdit) => void
  changed: () => void
  layers: () => LayerItem[]
  undo: () => void
  redo: () => void
  canUndo: () => boolean
  canRedo: () => boolean
  flush: () => Promise<void>
}

export type SaveState = 'saved' | 'dirty' | 'saving' | 'error'

/**
 * The same-origin, script-free copy of an HTML board used while editing.
 * Every change is kept for undo and saved after a short pause; the server
 * keeps the previous file as a version.
 */
export function BoardEditor({ project, board, onReady, onSelectElement, onSaveState, onSaved }: {
  project: DesignProject
  board: DesignBoard
  onReady: (controller: EditorController | null) => void
  onSelectElement: (element: HTMLElement | null) => void
  onSaveState: (state: SaveState) => void
  onSaved: (project: DesignProject) => void
}) {
  const frameRef = useRef<HTMLIFrameElement>(null)
  const [srcdoc, setSrcdoc] = useState<string | null>(null)
  const history = useRef<{ stack: string[]; index: number }>({ stack: [], index: -1 })
  const timer = useRef<number | null>(null)
  const detach = useRef<(() => void) | null>(null)
  const latest = useRef({ onSaved, onSaveState, onSelectElement, onReady })
  latest.current = { onSaved, onSaveState, onSelectElement, onReady }

  useEffect(() => {
    let cancelled = false
    starApi.designFileText(project.id, board.path)
      .then(html => {
        if (cancelled) return
        const editable = toEditableHtml(html, project.id)
        history.current = { stack: [editable], index: 0 }
        setSrcdoc(editable)
      })
      .catch(error => useUIStore.getState().addToast({ type: 'error', message: starErrorText(error) }))
    return () => { cancelled = true }
    // Load once per board; later file changes from the agent do not replace an open edit.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project.id, board.path])

  const save = useCallback(async () => {
    const doc = frameRef.current?.contentDocument
    if (!doc) return
    if (timer.current) window.clearTimeout(timer.current)
    timer.current = null
    latest.current.onSaveState('saving')
    try {
      const saved = await starApi.writeDesignFile(project.id, board.path, serializeDocument(doc, project.id))
      latest.current.onSaveState('saved')
      latest.current.onSaved(saved)
    } catch (error) {
      latest.current.onSaveState('error')
      useUIStore.getState().addToast({ type: 'error', message: `保存失败：${starErrorText(error)}` })
    }
  }, [project.id, board.path])

  const changed = useCallback(() => {
    const doc = frameRef.current?.contentDocument
    if (!doc) return
    const snapshot = doc.documentElement.outerHTML
    const { stack, index } = history.current
    if (stack[index] !== snapshot) {
      history.current = { stack: [...stack.slice(0, index + 1), snapshot].slice(-60), index: Math.min(index + 1, 59) }
    }
    latest.current.onSaveState('dirty')
    if (timer.current) window.clearTimeout(timer.current)
    timer.current = window.setTimeout(() => void save(), 700)
  }, [save])

  const restoreSnapshot = useCallback((snapshot: string) => {
    const doc = frameRef.current?.contentDocument
    if (!doc) return
    detach.current?.()
    doc.open()
    doc.write(`<!DOCTYPE html>${snapshot}`)
    doc.close()
    window.setTimeout(() => {
      wire()
      latest.current.onSaveState('dirty')
      if (timer.current) window.clearTimeout(timer.current)
      timer.current = window.setTimeout(() => void save(), 400)
    }, 30)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [save])

  const wire = useCallback(() => {
    const doc = frameRef.current?.contentDocument
    if (!doc?.body) return
    detach.current?.()
    const handle = attachEditor(doc, { onSelect: element => latest.current.onSelectElement(element), onChange: changed })
    detach.current = handle.detach
    latest.current.onReady({
      doc,
      insert: (kind, src) => {
        handle.select(insertLayer(doc, kind, src))
        changed()
        // The toolbar button keeps focus otherwise; Delete and the arrow keys
        // should act on the new layer straight away.
        frameRef.current?.focus({ preventScroll: true })
      },
      insertTable: rows => {
        const { element, truncated } = insertTableLayer(doc, rows)
        handle.select(element)
        changed()
        frameRef.current?.focus({ preventScroll: true })
        return { truncated }
      },
      select: handle.select,
      remove: handle.remove,
      nudge: handle.nudge,
      activeCell: handle.activeCell,
      table: handle.table,
      changed,
      layers: () => listLayers(doc),
      undo: () => {
        const { stack, index } = history.current
        if (index <= 0) return
        history.current = { stack, index: index - 1 }
        restoreSnapshot(stack[index - 1]!)
      },
      redo: () => {
        const { stack, index } = history.current
        if (index >= stack.length - 1) return
        history.current = { stack, index: index + 1 }
        restoreSnapshot(stack[index + 1]!)
      },
      canUndo: () => history.current.index > 0,
      canRedo: () => history.current.index < history.current.stack.length - 1,
      flush: save,
    })
  }, [changed, restoreSnapshot, save])

  useEffect(() => () => {
    detach.current?.()
    if (timer.current) {
      window.clearTimeout(timer.current)
      void save()
    }
    latest.current.onReady(null)
  }, [save])

  if (srcdoc === null) return <div className="flex h-full w-full items-center justify-center bg-[var(--color-surface-container-lowest)] text-[14px] text-[var(--color-text-tertiary)]">加载画板…</div>
  return (
    <iframe
      ref={frameRef}
      title={`编辑 ${board.name}`}
      srcDoc={srcdoc}
      sandbox="allow-same-origin"
      onLoad={wire}
      className="h-full w-full border-0 bg-white"
      style={{ width: board.width, height: board.height }}
    />
  )
}
