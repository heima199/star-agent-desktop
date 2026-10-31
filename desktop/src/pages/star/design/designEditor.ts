import html2canvas from 'html2canvas'
import { getBaseUrl } from '@/api/client'
import { designFileUrl, starApi } from '@/api/star'
import { buildImagePdf, canvasToJpeg, pdfBlob, PDF_MAX_PAGE_PT, PDF_PAGE_WIDTH_PT, type PdfImagePage } from '@/lib/imagePdf'

/**
 * In-canvas editing of HTML artboards. The board is loaded into a same-origin
 * srcdoc iframe without scripts; ../assets/ links become absolute (tokenized)
 * URLs while editing and are written back as ../assets/ on save.
 */

const EDITOR_STYLE_ID = 'star-editor-style'
const EDITOR_CSS = '[data-star-hover]{outline:1px dashed #4f7cff!important;outline-offset:1px}' +
  '[data-star-selected]{outline:2px solid #4f7cff!important;outline-offset:2px;cursor:move}' +
  '[data-star-cell]{box-shadow:inset 0 0 0 2px rgba(79,124,255,.55)!important}' +
  '[contenteditable="true"]{outline:2px solid #f0a020!important;cursor:text}'
const EDITOR_ATTRIBUTES = ['data-star-selected', 'data-star-hover', 'data-star-cell', 'contenteditable']

function assetBase(projectId: string): { prefix: string; suffix: string } {
  const url = designFileUrl(projectId, 'assets/__STAR__')
  const [head = '', query = ''] = url.split('?')
  return { prefix: head.replace('__STAR__', ''), suffix: query ? `?${query}` : '' }
}

const escapeRe = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

export function toEditableHtml(html: string, projectId: string): string {
  const { prefix, suffix } = assetBase(projectId)
  return html.replace(/((?:src|href|poster)\s*=\s*["']|url\(\s*["']?)(?:\.\.\/)?assets\/([^"')\s?#]+)/gi, (_m, head: string, name: string) => `${head}${prefix}${name}${suffix}`)
}

export function fromEditableHtml(html: string, projectId: string): string {
  const { prefix, suffix } = assetBase(projectId)
  return html.replace(new RegExp(`${escapeRe(prefix)}([^"')\\s?#]+)(?:${escapeRe(suffix)})?`, 'g'), '../assets/$1')
}

export function serializeDocument(doc: Document, projectId: string): string {
  const clone = doc.documentElement.cloneNode(true) as HTMLElement
  clone.querySelector(`#${EDITOR_STYLE_ID}`)?.remove()
  clone.querySelectorAll(EDITOR_ATTRIBUTES.map(name => `[${name}]`).join(',')).forEach(element => {
    for (const name of EDITOR_ATTRIBUTES) element.removeAttribute(name)
  })
  const doctype = doc.doctype ? `<!DOCTYPE ${doc.doctype.name}>` : '<!DOCTYPE html>'
  return fromEditableHtml(`${doctype}\n${clone.outerHTML}`, projectId)
}

export function blankBoardHtml(width: number, height: number, title = '双击编辑标题'): string {
  return `<!DOCTYPE html>
<html lang="zh-CN" data-artboard-width="${width}" data-artboard-height="${height}">
<head>
<meta charset="utf-8">
<style>
  html, body { margin: 0; width: ${width}px; height: ${height}px; overflow: hidden; }
  body { position: relative; background: #ffffff; font-family: "PingFang SC", "Microsoft YaHei", "Noto Sans SC", sans-serif; color: #141414; }
</style>
</head>
<body>
  <div data-layer="标题" style="position:absolute;left:${Math.round(width * 0.08)}px;top:${Math.round(height * 0.1)}px;font-size:${Math.round(Math.min(width, height) * 0.07)}px;font-weight:700;">${title}</div>
</body>
</html>
`
}

export type LayerItem = { element: HTMLElement; name: string; depth: number }

/** Elements marked data-layer, or the body's children (two levels) when none are marked. */
export function listLayers(doc: Document): LayerItem[] {
  const marked = Array.from(doc.querySelectorAll<HTMLElement>('[data-layer]'))
  const describe = (element: HTMLElement) => element.getAttribute('data-layer')
    || (element.childElementCount === 0 && element.textContent?.trim() ? element.textContent.trim().slice(0, 18) : '')
    || element.tagName.toLowerCase()
  if (marked.length) return marked.map(element => ({ element, name: describe(element), depth: 0 }))
  const items: LayerItem[] = []
  for (const child of Array.from(doc.body?.children ?? []) as HTMLElement[]) {
    if (child.tagName === 'SCRIPT' || child.tagName === 'STYLE') continue
    items.push({ element: child, name: describe(child), depth: 0 })
    for (const inner of Array.from(child.children) as HTMLElement[]) items.push({ element: inner, name: describe(inner), depth: 1 })
  }
  return items.slice(0, 200)
}

function readTranslate(element: HTMLElement): [number, number] {
  const parts = (element.style.translate || '').split(/\s+/).map(part => Number.parseFloat(part))
  return [Number.isFinite(parts[0]) ? parts[0]! : 0, Number.isFinite(parts[1]) ? parts[1]! : 0]
}

/** Whether `right` / `bottom` shape the box: setting them to auto would move or resize it. */
function anchoredFromEnd(element: HTMLElement): boolean {
  const before = element.getBoundingClientRect()
  const right = element.style.right
  const bottom = element.style.bottom
  element.style.right = 'auto'
  element.style.bottom = 'auto'
  const after = element.getBoundingClientRect()
  element.style.right = right
  element.style.bottom = bottom
  return Math.abs(before.left - after.left) > 0.5 || Math.abs(before.top - after.top) > 0.5 ||
    Math.abs(before.width - after.width) > 0.5 || Math.abs(before.height - after.height) > 0.5
}

/**
 * Turns a move into the element's own left/top. A translated box keeps the
 * width it had where it started, so text dragged to the right ran past the
 * board's edge and was cut off; placed with left/top it wraps at the edge
 * again. Boxes laid out any other way (in the flow, or held by right/bottom)
 * keep the translate.
 */
export function settleOffset(element: HTMLElement): void {
  const [tx, ty] = readTranslate(element)
  if (!tx && !ty) return
  const view = element.ownerDocument.defaultView
  const style = view?.getComputedStyle(element)
  if (!style || (style.position !== 'absolute' && style.position !== 'fixed')) return
  const left = Number.parseFloat(style.left)
  const top = Number.parseFloat(style.top)
  if (!Number.isFinite(left) || !Number.isFinite(top) || anchoredFromEnd(element)) return
  element.style.left = `${Math.round(left + tx)}px`
  element.style.top = `${Math.round(top + ty)}px`
  element.style.removeProperty('translate')
}

export type EditorEvents = {
  onSelect: (element: HTMLElement | null) => void
  onChange: () => void
}

export type TableEdit = 'row-above' | 'row-below' | 'col-left' | 'col-right' | 'delete-row' | 'delete-col'

export type EditorHandle = {
  detach: () => void
  select: (element: HTMLElement | null) => void
  /** Deletes the selected element. */
  remove: () => void
  /** Moves the selected element by a few pixels. */
  nudge: (dx: number, dy: number) => void
  /** The table cell last clicked or edited, while its table is selected. */
  activeCell: () => HTMLTableCellElement | null
  table: (edit: TableEdit) => void
}

const cellOf = (node: EventTarget | null): HTMLTableCellElement | null => {
  const element = node && typeof (node as Element).closest === 'function' ? node as Element : null
  return (element?.closest('td, th') as HTMLTableCellElement | null) ?? null
}

/** Wires selection, double-click text editing, drag-to-move and keyboard nudges into a board document. */
export function attachEditor(doc: Document, events: EditorEvents): EditorHandle {
  let style = doc.getElementById(EDITOR_STYLE_ID)
  if (!style) {
    style = doc.createElement('style')
    style.id = EDITOR_STYLE_ID
    style.textContent = EDITOR_CSS
    doc.head?.appendChild(style)
  }
  // Undo and redo rewrite the document from snapshots that carry these marks.
  doc.querySelectorAll('[data-star-selected],[data-star-hover],[data-star-cell]').forEach(element => {
    element.removeAttribute('data-star-selected')
    element.removeAttribute('data-star-hover')
    element.removeAttribute('data-star-cell')
  })
  let selected: HTMLElement | null = null
  let hovered: HTMLElement | null = null
  let cell: HTMLTableCellElement | null = null
  let drag: { element: HTMLElement; startX: number; startY: number; tx: number; ty: number; moved: boolean } | null = null

  const target = (node: EventTarget | null): HTMLElement | null => {
    const element = node instanceof doc.defaultView!.HTMLElement ? node : null
    if (!element || element === doc.body || element === doc.documentElement) return null
    return (element.closest('[data-layer]') as HTMLElement | null) ?? element
  }
  /** The table cell that row and column edits start from, outlined while its table is selected. */
  const markCell = (next: HTMLTableCellElement | null) => {
    if (cell === next) return
    cell?.removeAttribute('data-star-cell')
    cell = next
    cell?.setAttribute('data-star-cell', '')
  }
  const select = (element: HTMLElement | null) => {
    selected?.removeAttribute('data-star-selected')
    selected = element
    selected?.setAttribute('data-star-selected', '')
    if (!selected || !cell || !selected.contains(cell)) markCell(null)
    events.onSelect(selected)
  }
  // pointerdown is cancelled below (no text selection, no native image drag),
  // and that also leaves keyboard focus where it was, often the chat box.
  // Pull it into the board so Delete and the arrow keys reach this document.
  const focusBoard = () => {
    const frame = doc.defaultView?.frameElement as HTMLElement | null
    if (frame && !doc.hasFocus()) frame.focus({ preventScroll: true })
  }
  const remove = () => {
    if (!selected) return
    selected.remove()
    select(null)
    events.onChange()
  }
  const nudge = (dx: number, dy: number) => {
    if (!selected) return
    const [tx, ty] = readTranslate(selected)
    selected.style.translate = `${tx + dx}px ${ty + dy}px`
    settleOffset(selected)
    events.onChange()
  }
  const tableOf = (element: HTMLElement | null): HTMLTableElement | null =>
    element ? (element.tagName === 'TABLE' ? element as HTMLTableElement : element.querySelector('table')) : null
  const onOver = (event: Event) => {
    const element = target(event.target)
    if (hovered && hovered !== element) hovered.removeAttribute('data-star-hover')
    hovered = element
    if (element && element !== selected) element.setAttribute('data-star-hover', '')
  }
  const onDown = (event: PointerEvent) => {
    const editing = (event.target as HTMLElement | null)?.closest?.('[contenteditable="true"]')
    if (editing) return
    const element = target(event.target)
    // Set before select(), which keeps a cell only when it is inside the selection.
    markCell(element ? cellOf(event.target) : null)
    select(element)
    focusBoard()
    if (!element) return
    event.preventDefault()
    const [tx, ty] = readTranslate(element)
    drag = { element, startX: event.clientX, startY: event.clientY, tx, ty, moved: false }
  }
  const onMove = (event: PointerEvent) => {
    if (!drag) return
    const dx = event.clientX - drag.startX
    const dy = event.clientY - drag.startY
    if (!drag.moved && Math.abs(dx) + Math.abs(dy) < 3) return
    drag.moved = true
    drag.element.style.translate = `${Math.round(drag.tx + dx)}px ${Math.round(drag.ty + dy)}px`
  }
  const onUp = () => {
    if (drag?.moved) {
      settleOffset(drag.element)
      events.onChange()
    }
    drag = null
  }
  const startEditing = (editable: HTMLElement) => {
    editable.setAttribute('contenteditable', 'true')
    editable.focus()
    const range = doc.createRange()
    range.selectNodeContents(editable)
    const selection = doc.getSelection()
    selection?.removeAllRanges()
    selection?.addRange(range)
    const finish = () => {
      editable.removeAttribute('contenteditable')
      editable.removeEventListener('blur', finish)
      events.onChange()
    }
    editable.addEventListener('blur', finish)
  }
  const onDblClick = (event: MouseEvent) => {
    const element = event.target instanceof doc.defaultView!.HTMLElement ? event.target : null
    if (!element || element === doc.body) return
    // A table cell is edited on its own, empty or not.
    const tableCell = cellOf(element)
    if (tableCell) {
      markCell(tableCell)
      startEditing(tableCell)
      return
    }
    if (!element.textContent?.trim()) return
    startEditing(element.childElementCount === 0 ? element : (target(element) ?? element))
  }
  // A range copied from a spreadsheet fills the table from the cell being
  // edited, or the current cell of a selected table, growing it as needed.
  // Plain text pastes as text, into the one cell.
  const onPaste = (event: ClipboardEvent) => {
    const editingCell = cellOf(event.target)
    const from = editingCell?.isContentEditable ? editingCell : (cell && selected?.contains(cell) ? cell : null)
    const table = from?.closest('table')
    if (!from || !table) return
    const rows = parseCopiedRange(event.clipboardData?.getData('text/plain') ?? '')
    if (!rows) {
      if (!editingCell?.isContentEditable) return
      // Text only: what a spreadsheet or page puts on the clipboard as HTML
      // would bring its fonts and colours into the cell.
      const selection = doc.getSelection()
      if (!selection?.rangeCount) return
      event.preventDefault()
      const range = selection.getRangeAt(0)
      range.deleteContents()
      const text = doc.createTextNode(event.clipboardData?.getData('text/plain') ?? '')
      range.insertNode(text)
      range.setStartAfter(text)
      range.collapse(true)
      selection.removeAllRanges()
      selection.addRange(range)
      return
    }
    event.preventDefault()
    editingCell?.blur()
    markCell(pasteIntoTable(table, from, rows))
    events.onChange()
  }
  const onKey = (event: KeyboardEvent) => {
    const editingCell = cellOf(event.target)
    // Tab walks the cells while one is edited; Tab on the last cell adds a row.
    if (event.key === 'Tab' && editingCell?.isContentEditable) {
      event.preventDefault()
      const cells = Array.from(editingCell.closest('table')?.querySelectorAll<HTMLTableCellElement>('td, th') ?? [])
      const index = cells.indexOf(editingCell)
      let next = cells[index + (event.shiftKey ? -1 : 1)] ?? null
      if (!next && !event.shiftKey) {
        const table = editingCell.closest('table')
        next = table ? editTable(table, editingCell, 'row-below') : null
        if (next) next = (next.parentElement as HTMLTableRowElement).cells[0] ?? next
      }
      if (!next) return
      editingCell.blur()
      markCell(next)
      startEditing(next)
      return
    }
    if (event.key === 'Escape' && (event.target as HTMLElement | null)?.isContentEditable) {
      (event.target as HTMLElement).blur()
      return
    }
    if (!selected || (event.target as HTMLElement | null)?.closest?.('[contenteditable="true"]')) return
    if (event.key === 'Delete' || event.key === 'Backspace') {
      event.preventDefault()
      remove()
      return
    }
    if (event.key === 'Escape') { select(null); return }
    const step = event.shiftKey ? 10 : 1
    const delta: Record<string, [number, number]> = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }
    const move = delta[event.key]
    if (!move) return
    event.preventDefault()
    nudge(move[0], move[1])
  }
  doc.addEventListener('pointerover', onOver)
  doc.addEventListener('pointerdown', onDown)
  doc.addEventListener('pointermove', onMove)
  doc.addEventListener('pointerup', onUp)
  doc.addEventListener('dblclick', onDblClick)
  doc.addEventListener('keydown', onKey)
  doc.addEventListener('paste', onPaste)
  return {
    select,
    remove,
    nudge,
    activeCell: () => (cell && selected?.contains(cell) ? cell : null),
    table: edit => {
      const table = tableOf(selected)
      if (!table) return
      const next = editTable(table, cell && table.contains(cell) ? cell : null, edit)
      markCell(next && table.contains(next) ? next : null)
      events.onChange()
    },
    detach: () => {
      doc.removeEventListener('pointerover', onOver)
      doc.removeEventListener('pointerdown', onDown)
      doc.removeEventListener('pointermove', onMove)
      doc.removeEventListener('pointerup', onUp)
      doc.removeEventListener('dblclick', onDblClick)
      doc.removeEventListener('keydown', onKey)
      doc.removeEventListener('paste', onPaste)
      selected?.removeAttribute('data-star-selected')
      hovered?.removeAttribute('data-star-hover')
      cell?.removeAttribute('data-star-cell')
    },
  }
}

export type LayerKind = 'text' | 'shape' | 'image' | 'table'

const LAYER_NAMES: Record<LayerKind, string> = { text: '文字', shape: '形状', image: '图片', table: '表格' }

/** Inline styles, so a copied cell (new row or column) keeps the look of its neighbour. */
const HEAD_CELL_STYLE = 'padding:14px 20px;border:2px solid #d0d4dc;background:#f3f4f7;font-weight:600;text-align:left;white-space:nowrap'
const BODY_CELL_STYLE = 'padding:14px 20px;border:2px solid #d0d4dc;text-align:left;white-space:nowrap'

function fillTable(table: HTMLTableElement): void {
  const doc = table.ownerDocument
  const head = table.createTHead().insertRow()
  for (const label of ['项目', '数值', '备注']) {
    const cell = doc.createElement('th')
    cell.setAttribute('style', HEAD_CELL_STYLE)
    cell.textContent = label
    head.appendChild(cell)
  }
  const body = table.createTBody()
  for (let row = 0; row < 3; row++) {
    const line = body.insertRow()
    for (let col = 0; col < 3; col++) {
      const cell = line.insertCell()
      cell.setAttribute('style', BODY_CELL_STYLE)
      cell.textContent = col === 0 ? `第 ${row + 1} 项` : ''
    }
  }
}

/** An empty cell styled like `like`; spans are not copied. */
function emptyCell(like: HTMLTableCellElement, tag: 'td' | 'th' = like.tagName === 'TH' ? 'th' : 'td'): HTMLTableCellElement {
  const cell = like.ownerDocument.createElement(tag)
  const style = tag === 'td' && like.tagName === 'TH' ? BODY_CELL_STYLE : like.getAttribute('style')
  if (style) cell.setAttribute('style', style)
  return cell
}

/**
 * Adds or removes a row or column next to `from` (the last row or column when
 * no cell is chosen). Returns the cell to keep working in. A table keeps at
 * least one row and one column.
 */
export function editTable(table: HTMLTableElement, from: HTMLTableCellElement | null, edit: TableEdit): HTMLTableCellElement | null {
  const rows = Array.from(table.rows)
  if (!rows.length) return null
  const before = edit === 'row-above' || edit === 'col-left'
  const lastRow = rows[rows.length - 1]!
  const ref = from && table.contains(from) ? from : (before ? rows[0]!.cells[0] : lastRow.cells[lastRow.cells.length - 1]) ?? null
  if (!ref) return null
  const row = ref.parentElement as HTMLTableRowElement
  const col = ref.cellIndex
  switch (edit) {
    case 'row-above':
    case 'row-below': {
      // Below a header row the new row starts the body, in body cells.
      const intoBody = !before && row.parentElement?.tagName === 'THEAD'
      const line = table.ownerDocument.createElement('tr')
      for (const like of Array.from(row.cells)) line.appendChild(emptyCell(like, intoBody ? 'td' : undefined))
      if (intoBody) {
        const body = table.tBodies[0] ?? table.createTBody()
        body.insertBefore(line, body.firstChild)
      } else {
        row.parentElement!.insertBefore(line, before ? row : row.nextSibling)
      }
      return line.cells[Math.min(col, line.cells.length - 1)] ?? null
    }
    case 'col-left':
    case 'col-right': {
      let result: HTMLTableCellElement | null = null
      for (const line of rows) {
        const like = line.cells[Math.min(col, line.cells.length - 1)]
        if (!like) continue
        const added = emptyCell(like)
        line.insertBefore(added, before ? like : like.nextSibling)
        if (line === row) result = added
      }
      return result
    }
    case 'delete-row': {
      if (rows.length <= 1) return ref
      const index = rows.indexOf(row)
      const neighbour = rows[index + 1] ?? rows[index - 1]!
      row.remove()
      return neighbour.cells[Math.min(col, neighbour.cells.length - 1)] ?? null
    }
    case 'delete-col': {
      if (Math.max(...rows.map(line => line.cells.length)) <= 1) return ref
      for (const line of rows) if (col < line.cells.length) line.cells[col]!.remove()
      return row.cells[Math.min(col, row.cells.length - 1)] ?? null
    }
  }
}

/** Most rows and columns a board table takes from a spreadsheet; past that a board is no longer readable. */
export const TABLE_IMPORT_LIMITS = { rows: 200, columns: 26 } as const

/**
 * Replaces `table`'s rows with `rows`, the first as the header, in the look a
 * new table has. Says whether rows or columns past TABLE_IMPORT_LIMITS were
 * left out.
 */
export function fillTableFromRows(table: HTMLTableElement, rows: readonly (readonly string[])[]): { truncated: boolean } {
  const doc = table.ownerDocument
  const kept = rows.slice(0, TABLE_IMPORT_LIMITS.rows)
  const columns = Math.min(TABLE_IMPORT_LIMITS.columns, Math.max(1, ...kept.map(row => row.length)))
  const truncated = rows.length > kept.length || rows.some(row => row.length > TABLE_IMPORT_LIMITS.columns)
  while (table.rows.length) table.deleteRow(0)
  table.deleteTHead()
  for (const body of Array.from(table.tBodies)) body.remove()
  const [header = [], ...rest] = kept.length ? kept : [['']]
  const head = table.createTHead().insertRow()
  for (let col = 0; col < columns; col++) {
    const cell = doc.createElement('th')
    cell.setAttribute('style', HEAD_CELL_STYLE)
    cell.textContent = header[col] ?? ''
    head.appendChild(cell)
  }
  const body = table.createTBody()
  for (const values of rest) {
    const line = body.insertRow()
    for (let col = 0; col < columns; col++) {
      const cell = line.insertCell()
      cell.setAttribute('style', BODY_CELL_STYLE)
      cell.textContent = values[col] ?? ''
    }
  }
  return { truncated }
}

/** A table's text by rows and cells, as a spreadsheet holds it. A spanned cell is written once. */
export function tableRows(table: HTMLTableElement): string[][] {
  return Array.from(table.rows, row => Array.from(row.cells, cell => (cell.textContent ?? '').trim()))
}

/**
 * The rows of a range copied from Excel, WPS, Numbers or Google Sheets, which
 * put it on the clipboard as tab-separated text: one line per row, and a cell
 * holding a tab, line break or quote in double quotes, with quotes doubled.
 * Text with neither a tab nor a line break is not a range (null): it pastes
 * as text into the one cell.
 */
export function parseCopiedRange(text: string): string[][] | null {
  const source = text.replace(/\r\n?/g, '\n').replace(/\n$/, '')
  if (!source.includes('\t') && !source.includes('\n')) return null
  const rows: string[][] = []
  let row: string[] = []
  let cell = ''
  let quoted = false
  for (let index = 0; index < source.length; index++) {
    const char = source[index]!
    if (quoted) {
      if (char === '"' && source[index + 1] === '"') { cell += '"'; index++ }
      else if (char === '"') quoted = false
      else cell += char
    } else if (char === '"' && cell === '') {
      quoted = true
    } else if (char === '\t') {
      row.push(cell)
      cell = ''
    } else if (char === '\n') {
      row.push(cell)
      rows.push(row)
      row = []
      cell = ''
    } else {
      cell += char
    }
  }
  row.push(cell)
  rows.push(row)
  return rows
}

/**
 * Writes `rows` into `table` from `from` rightwards and down, adding rows and
 * columns where the range runs past the table's edge. Returns the last cell
 * written.
 */
export function pasteIntoTable(table: HTMLTableElement, from: HTMLTableCellElement, rows: readonly (readonly string[])[]): HTMLTableCellElement {
  const startRow = (from.parentElement as HTMLTableRowElement).rowIndex
  const startCol = from.cellIndex
  const width = Math.min(TABLE_IMPORT_LIMITS.columns, Math.max(0, ...rows.map(row => row.length)))
  let last = from
  rows.slice(0, TABLE_IMPORT_LIMITS.rows).forEach((values, offset) => {
    while (table.rows.length <= startRow + offset) {
      const lastRow = table.rows[table.rows.length - 1]!
      editTable(table, lastRow.cells[0] ?? null, 'row-below')
    }
    const line = table.rows[startRow + offset]!
    while (line.cells.length < startCol + width) {
      // A column is added to every row, so the table stays rectangular.
      editTable(table, line.cells[line.cells.length - 1] ?? null, 'col-right')
    }
    values.slice(0, width).forEach((value, col) => {
      const cell = line.cells[startCol + col]!
      cell.textContent = value
      last = cell
    })
  })
  return last
}

/** A table layer holding `rows` (the first one the header). */
export function insertTableLayer(doc: Document, rows: readonly (readonly string[])[]): { element: HTMLElement; truncated: boolean } {
  const element = insertLayer(doc, 'table')
  return { element, ...fillTableFromRows(element as HTMLTableElement, rows) }
}

/** Adds a positioned layer to the board body. */
export function insertLayer(doc: Document, kind: LayerKind, src?: string): HTMLElement {
  const body = doc.body
  if (doc.defaultView?.getComputedStyle(body).position === 'static') body.style.position = 'relative'
  const element = doc.createElement(kind === 'image' ? 'img' : kind === 'table' ? 'table' : 'div')
  element.setAttribute('data-layer', LAYER_NAMES[kind])
  element.style.position = 'absolute'
  element.style.left = '80px'
  element.style.top = '80px'
  if (kind === 'table') {
    // Columns size to their text; double-click a cell to type, Tab for the next one.
    element.style.borderCollapse = 'collapse'
    element.style.fontSize = '28px'
    element.style.color = '#141414'
    element.style.background = '#ffffff'
    fillTable(element as HTMLTableElement)
  } else if (kind === 'text') {
    element.textContent = '双击编辑文字'
    element.style.fontSize = '48px'
    element.style.fontWeight = '600'
    element.style.color = '#141414'
  } else if (kind === 'shape') {
    element.style.width = '320px'
    element.style.height = '200px'
    element.style.borderRadius = '16px'
    element.style.background = '#4f7cff'
  } else {
    element.setAttribute('src', src ?? '')
    element.style.width = '480px'
    element.style.objectFit = 'cover'
  }
  body.appendChild(element)
  return element
}

// ─── Image edits ──────────────────────────────────────────

/** The image panel's adjustments: CSS filter functions in percent, with their neutral value. */
export const IMAGE_ADJUSTMENTS = [
  { fn: 'brightness', label: '亮度', min: 0, max: 200, neutral: 100 },
  { fn: 'contrast', label: '对比度', min: 0, max: 200, neutral: 100 },
  { fn: 'saturate', label: '饱和度', min: 0, max: 200, neutral: 100 },
  { fn: 'grayscale', label: '黑白', min: 0, max: 100, neutral: 0 },
] as const
export type ImageAdjustment = (typeof IMAGE_ADJUSTMENTS)[number]['fn']

/** One filter function, a nested rgba() in a drop-shadow included. */
const FILTER_FUNCTION = /[a-z-]+\((?:[^()]|\([^()]*\))*\)/gi
const ADJUSTMENT_PART = /^([a-z-]+)\(\s*(-?[\d.]+)(%?)\s*\)$/i

function filterParts(element: HTMLElement): string[] {
  return element.style.filter.match(FILTER_FUNCTION) ?? []
}

/** An adjustment of the element's own filter in percent; neutral when it has none. */
export function readImageAdjustment(element: HTMLElement, fn: ImageAdjustment): number {
  for (const part of filterParts(element)) {
    const match = ADJUSTMENT_PART.exec(part)
    if (match?.[1]?.toLowerCase() === fn) return Math.round(Number(match[2]) * (match[3] ? 1 : 100))
  }
  return IMAGE_ADJUSTMENTS.find(item => item.fn === fn)!.neutral
}

/**
 * Sets one adjustment. Filters the board already had (a drop shadow) stay in
 * front; the adjustments follow in a fixed order, neutral ones left out.
 */
export function setImageAdjustment(element: HTMLElement, fn: ImageAdjustment, percent: number): void {
  const values = new Map(IMAGE_ADJUSTMENTS.map(item => [item.fn, readImageAdjustment(element, item.fn)]))
  const spec = IMAGE_ADJUSTMENTS.find(item => item.fn === fn)!
  values.set(fn, Math.min(spec.max, Math.max(spec.min, Math.round(percent))))
  const ours = new Set<string>(IMAGE_ADJUSTMENTS.map(item => item.fn))
  const parts = [
    ...filterParts(element).filter(part => !ours.has(ADJUSTMENT_PART.exec(part)?.[1]?.toLowerCase() ?? '')),
    ...IMAGE_ADJUSTMENTS.filter(item => values.get(item.fn) !== item.neutral).map(item => `${item.fn}(${values.get(item.fn)}%)`),
  ]
  if (parts.length) element.style.filter = parts.join(' ')
  else element.style.removeProperty('filter')
}

/** Quarter turns (0–3) in the element's own `rotate`. */
function quarterTurns(element: HTMLElement): number {
  const degrees = Number.parseFloat(element.style.rotate) || 0
  return ((Math.round(degrees / 90) % 4) + 4) % 4
}

/**
 * Turns a layer a quarter, 1 clockwise and -1 back. The separate `rotate`
 * property composes with a `transform` the board may centre the layer with,
 * and with the `translate` a drag moves it by.
 */
export function rotateLayer(element: HTMLElement, quarter: 1 | -1): void {
  const turns = (quarterTurns(element) + quarter + 4) % 4
  if (turns) element.style.rotate = `${turns * 90}deg`
  else element.style.removeProperty('rotate')
}

function layerScale(element: HTMLElement): [number, number] {
  const [x, y] = (element.style.scale || '').split(/\s+/).filter(Boolean).map(part => Number.parseFloat(part))
  const sx = Number.isFinite(x) ? x! : 1
  return [sx, Number.isFinite(y) ? y! : sx]
}

/** Mirrors a layer left to right ('x') or top to bottom ('y'). */
export function flipLayer(element: HTMLElement, axis: 'x' | 'y'): void {
  const [x, y] = layerScale(element)
  const [nx, ny] = axis === 'x' ? [-x, y] : [x, -y]
  if (nx === 1 && ny === 1) element.style.removeProperty('scale')
  else element.style.scale = `${nx} ${ny}`
}

/** Whether the image carries any turn, mirroring or adjustment from the panel. */
export function hasImageEdits(element: HTMLElement): boolean {
  if (quarterTurns(element) !== 0) return true
  const [x, y] = layerScale(element)
  if (x !== 1 || y !== 1) return true
  return IMAGE_ADJUSTMENTS.some(item => readImageAdjustment(element, item.fn) !== item.neutral)
}

/** Takes the panel's edits off again; filters the board brought along stay. */
export function resetImageEdits(element: HTMLElement): void {
  element.style.removeProperty('rotate')
  element.style.removeProperty('scale')
  for (const item of IMAGE_ADJUSTMENTS) setImageAdjustment(element, item.fn, item.neutral)
}

/**
 * The separate translate/rotate/scale of `style` written as one transform list
 * in the order CSS applies them, or null when there is none (or a 3D one).
 */
export function individualTransform(style: Pick<CSSStyleDeclaration, 'translate' | 'rotate' | 'scale' | 'transform'>): string | null {
  const parts: string[] = []
  const translate = style.translate && style.translate !== 'none' ? style.translate.split(/\s+/) : []
  if (translate.length > 2) return null
  if (translate.length) parts.push(`translate(${translate[0]}, ${translate[1] ?? '0px'})`)
  if (style.rotate && style.rotate !== 'none') {
    if (!/^-?[\d.]+deg$/.test(style.rotate)) return null
    parts.push(`rotate(${style.rotate})`)
  }
  const scale = style.scale && style.scale !== 'none' ? style.scale.split(/\s+/) : []
  if (scale.length > 2) return null
  if (scale.length) parts.push(`scale(${scale[0]}, ${scale[1] ?? scale[0]})`)
  if (!parts.length) return null
  if (style.transform && style.transform !== 'none') parts.push(style.transform)
  return parts.join(' ')
}

/** The image drawn through `filter` into a PNG blob URL, or null when it cannot be read. */
async function bakeFilter(image: HTMLImageElement, filter: string): Promise<string | null> {
  const width = image.naturalWidth
  const height = image.naturalHeight
  if (!width || !height || !fitsOneImage(width, height) || filter.includes('url(')) return null
  try {
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const context = canvas.getContext('2d')
    if (!context) return null
    context.filter = filter
    context.drawImage(image, 0, 0, width, height)
    const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/png'))
    return blob ? URL.createObjectURL(blob) : null
  } catch {
    // A canvas tainted by an image it may not read: export the image as it is.
    return null
  }
}

/** Sets an inline property for the export and returns how to put the old value back. */
function overrideStyle(element: HTMLElement, property: string, value: string): () => void {
  const previous = element.style.getPropertyValue(property)
  const priority = element.style.getPropertyPriority(property)
  element.style.setProperty(property, value, 'important')
  return () => {
    if (previous) element.style.setProperty(property, previous, priority)
    else element.style.removeProperty(property)
  }
}

/**
 * html2canvas draws neither CSS filters nor the separate rotate and scale
 * properties. While a board exports, an image's filter is baked into its
 * pixels and its turn and mirroring move into `transform`, which it does
 * draw; the board is put back afterwards.
 */
async function withBakedImageEdits<T>(doc: Document, run: () => Promise<T>): Promise<T> {
  const view = doc.defaultView
  const restore: Array<() => void> = []
  try {
    for (const image of Array.from(doc.images)) {
      const style = view?.getComputedStyle(image)
      if (!style) continue
      if (style.filter && style.filter !== 'none') {
        const baked = await bakeFilter(image, style.filter)
        if (baked) {
          const previous = image.getAttribute('src') ?? ''
          const filter = overrideStyle(image, 'filter', 'none')
          image.setAttribute('src', baked)
          await image.decode().catch(() => undefined)
          restore.push(() => { image.setAttribute('src', previous); filter(); URL.revokeObjectURL(baked) })
        }
      }
      const transform = individualTransform(style)
      if (transform) {
        const undo = [
          overrideStyle(image, 'transform', transform),
          overrideStyle(image, 'translate', 'none'),
          overrideStyle(image, 'rotate', 'none'),
          overrideStyle(image, 'scale', 'none'),
        ]
        restore.push(() => undo.forEach(item => item()))
      }
    }
    return await run()
  } finally {
    for (const undo of restore.reverse()) undo()
  }
}

/**
 * Chromium's canvas ceiling: 32,767 px a side and 16,384² px in all. Past it
 * the canvas stays blank and toBlob yields nothing, which used to surface as a
 * bare 「导出失败」 with no way forward.
 */
export const MAX_IMAGE_SIDE = 32_767
export const MAX_IMAGE_AREA = 16_384 * 16_384

/** Whether a board this size can be exported as a single picture. */
export function fitsOneImage(width: number, height: number): boolean {
  return width <= MAX_IMAGE_SIDE && height <= MAX_IMAGE_SIDE && width * height <= MAX_IMAGE_AREA
}

/** A board too large for one picture. The message sends the user to PDF, which pages it. */
export class BoardTooLargeForImageError extends Error {
  constructor(width: number, height: number) {
    super(`画板 ${width}×${height} 超出单张图片的导出上限，请改用「导出 PDF」，长画板会分页保存`)
    this.name = 'BoardTooLargeForImageError'
  }
}

/** Remote and local images go through blob URLs while `run` draws, so the canvas stays exportable. */
async function withExportableImages<T>(doc: Document, run: () => Promise<T>): Promise<T> {
  const restore: Array<() => void> = []
  const base = getBaseUrl()
  for (const image of Array.from(doc.images)) {
    const src = image.currentSrc || image.src
    if (!src || src.startsWith('blob:') || src.startsWith('data:')) continue
    try {
      const blob = /^https:\/\//i.test(src)
        ? await starApi.proxiedImage(src)
        : src.startsWith(base) ? await (await fetch(src)).blob() : null
      if (!blob) continue
      const url = URL.createObjectURL(blob)
      const previous = image.getAttribute('src') ?? ''
      image.setAttribute('src', url)
      await image.decode().catch(() => undefined)
      restore.push(() => { image.setAttribute('src', previous); URL.revokeObjectURL(url) })
    } catch {
      // Leave the image as is; html2canvas skips what it cannot read.
    }
  }
  try {
    // Baked from the readable copies above, so a filtered canvas stays untainted.
    return await withBakedImageEdits(doc, run)
  } finally {
    for (const undo of restore) undo()
  }
}

/** Renders a board document to PNG, or says to use PDF when one picture cannot hold it. */
export async function renderBoardPng(doc: Document, width: number, height: number): Promise<Blob> {
  if (!fitsOneImage(width, height)) throw new BoardTooLargeForImageError(width, height)
  return withExportableImages(doc, async () => {
    const canvas = await html2canvas(doc.documentElement, { width, height, windowWidth: width, windowHeight: height, scale: 1, useCORS: true, backgroundColor: null, logging: false })
    // Within the ceiling a canvas can still fail for want of memory; PDF draws it in strips.
    return await new Promise<Blob>((resolve, reject) => canvas.toBlob(blob => (blob ? resolve(blob) : reject(new BoardTooLargeForImageError(width, height))), 'image/png'))
  })
}

/** A drawn picture (an SVG or bitmap board) as a PDF, a page per strip like renderBoardPdf. */
export async function pictureToPdf(image: CanvasImageSource, width: number, height: number, onProgress?: (page: number, total: number) => void): Promise<Blob> {
  const strip = pdfStripHeight(width)
  const total = Math.max(1, Math.ceil(height / strip))
  const pages: PdfImagePage[] = []
  for (let index = 0; index < total; index++) {
    onProgress?.(index + 1, total)
    const top = index * strip
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = Math.min(strip, height - top)
    const context = canvas.getContext('2d')
    if (!context) throw new Error('导出失败：无法创建画布')
    // Drawn whole and shifted up: the strip keeps only its own band.
    context.drawImage(image, 0, -top, width, height)
    pages.push(await canvasToJpeg(canvas))
  }
  return pdfBlob(buildImagePdf(pages))
}

/** Tallest strip one PDF page draws: big enough that cuts are rare, small enough to render quickly. */
const PDF_STRIP_MAX_PX = 8_192

/** Height of each PDF strip for a board `width` px wide; see PDF_STRIP_MAX_PX. */
export function pdfStripHeight(width: number): number {
  return Math.max(1, Math.min(
    PDF_STRIP_MAX_PX,
    Math.floor(MAX_IMAGE_AREA / Math.max(1, width)),
    // Pages are A4-wide; a strip taller than this would pass the PDF page ceiling.
    Math.floor((width * PDF_MAX_PAGE_PT) / PDF_PAGE_WIDTH_PT),
  ))
}

/**
 * Renders a board document to a PDF, one page per horizontal strip, so a board
 * of any height exports: a single picture stops at the canvas ceiling.
 * `onProgress` hears each page as it starts.
 */
export async function renderBoardPdf(doc: Document, width: number, height: number, onProgress?: (page: number, total: number) => void): Promise<Blob> {
  const strip = pdfStripHeight(width)
  const total = Math.max(1, Math.ceil(height / strip))
  return withExportableImages(doc, async () => {
    const pages: PdfImagePage[] = []
    for (let index = 0; index < total; index++) {
      onProgress?.(index + 1, total)
      const top = index * strip
      const canvas = await html2canvas(doc.documentElement, {
        x: 0, y: top, width, height: Math.min(strip, height - top),
        windowWidth: width, windowHeight: height, scale: 1, useCORS: true, backgroundColor: '#ffffff', logging: false,
      })
      pages.push(await canvasToJpeg(canvas))
    }
    return pdfBlob(buildImagePdf(pages))
  })
}

/** Loads a board's HTML into a hidden same-origin iframe (for export / reference upload). */
export async function withBoardDocument<T>(projectId: string, html: string, width: number, height: number, run: (doc: Document) => Promise<T>): Promise<T> {
  const frame = document.createElement('iframe')
  frame.setAttribute('sandbox', 'allow-same-origin')
  frame.style.cssText = `position:fixed;left:-${width + 100}px;top:0;width:${width}px;height:${height}px;border:0;visibility:hidden`
  document.body.appendChild(frame)
  try {
    await new Promise<void>(resolve => {
      frame.onload = () => resolve()
      frame.srcdoc = toEditableHtml(html, projectId)
    })
    const doc = frame.contentDocument
    if (!doc) throw new Error('无法读取画板')
    await doc.fonts?.ready.catch(() => undefined)
    await new Promise(resolve => setTimeout(resolve, 150))
    return await run(doc)
  } finally {
    frame.remove()
  }
}
