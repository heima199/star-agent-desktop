import { useEffect, useRef, useState } from 'react'
import { Download, Eye, EyeOff, FileCode2, Film, FlipHorizontal2, FlipVertical2, Image as ImageIcon, Lock, LockOpen, RotateCcw, RotateCw, Shapes, Trash2, Upload } from 'lucide-react'
import { designFileUrl, type DesignBoard, type DesignProject } from '@/api/star'
import { downloadBlob } from '@/lib/downloadBlob'
import { useUIStore } from '../../../stores/uiStore'
import type { EditorController } from './BoardEditor'
import { flipLayer, hasImageEdits, IMAGE_ADJUSTMENTS, readImageAdjustment, resetImageEdits, rotateLayer, setImageAdjustment, tableRows, type TableEdit } from './designEditor'
import { rowsToCsv, rowsToXlsx } from './tableSpreadsheet'

const panel = 'flex flex-col overflow-hidden rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-surface-container-lowest)] shadow-[var(--shadow-dropdown)]'
const input = 'h-7 w-full rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-surface)] px-2 text-[12px] text-[var(--color-text-primary)] outline-none focus:border-[#4f7cff]'

function toHex(color: string): string {
  const match = /rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(color)
  if (!match) return /^#[0-9a-f]{6}$/i.test(color) ? color : '#000000'
  return `#${match.slice(1, 4).map(part => Number(part).toString(16).padStart(2, '0')).join('')}`
}

const TABLE_ACTIONS: { edit: TableEdit; label: string }[] = [
  { edit: 'row-above', label: '上方加行' },
  { edit: 'row-below', label: '下方加行' },
  { edit: 'col-left', label: '左侧加列' },
  { edit: 'col-right', label: '右侧加列' },
  { edit: 'delete-row', label: '删除所在行' },
  { edit: 'delete-col', label: '删除所在列' },
]

/** Rows, columns and cell text of a selected table. */
function TableSection({ controller, table, refresh }: { controller: EditorController; table: HTMLTableElement; refresh: () => void }) {
  const view = controller.doc.defaultView!
  const cell = controller.activeCell()
  const row = cell ? (cell.parentElement as HTMLTableRowElement).rowIndex : -1
  const columns = Math.max(0, ...Array.from(table.rows).map(line => line.cells.length))
  const anyCell = table.querySelector<HTMLTableCellElement>('td, th')
  const headCell = table.querySelector<HTMLTableCellElement>('th')
  const run = (edit: TableEdit) => {
    controller.table(edit)
    refresh()
  }
  const paint = (selector: string, property: string, value: string) => {
    table.querySelectorAll<HTMLElement>(selector).forEach(item => item.style.setProperty(property, value))
    controller.changed()
    refresh()
  }
  return (
    <div className="space-y-2 border-t border-[var(--color-border)] pt-2.5" data-testid="table-section">
      <div className="flex items-center justify-between">
        <span className="font-medium text-[var(--color-text-primary)]">行与列</span>
        <span className="tabular-nums text-[var(--color-text-tertiary)]">{table.rows.length} 行 × {columns} 列</span>
      </div>
      <p className="text-[11px] leading-4 text-[var(--color-text-tertiary)]">
        {cell ? `当前单元格：第 ${row + 1} 行第 ${cell.cellIndex + 1} 列` : '单击单元格定位，双击输入文字，Tab 跳到下一格。'}
      </p>
      {cell ? (
        <label className="block space-y-1">单元格文字
          <textarea key={`${row}:${cell.cellIndex}:${cell.textContent}`} defaultValue={cell.textContent ?? ''} rows={2}
            onBlur={event => { if (event.target.value !== cell.textContent) { cell.textContent = event.target.value; controller.changed(); refresh() } }}
            className={`${input} h-auto py-1.5`} />
        </label>
      ) : null}
      <div className="grid grid-cols-2 gap-1.5">
        {TABLE_ACTIONS.map(action => (
          <button key={action.edit} type="button" onClick={() => run(action.edit)} className="h-7 whitespace-nowrap rounded-[var(--radius-sm)] border border-[var(--color-border)] hover:bg-[var(--color-surface-hover)]">{action.label}</button>
        ))}
      </div>
      <div className="grid grid-cols-2 gap-2">
        <label className="space-y-1">边框颜色<input type="color" value={toHex(anyCell ? view.getComputedStyle(anyCell).borderTopColor : '#d0d4dc')} onChange={event => paint('td, th', 'border-color', event.target.value)} className={`${input} p-0.5`} /></label>
        {headCell ? <label className="space-y-1">表头底色<input type="color" value={toHex(view.getComputedStyle(headCell).backgroundColor)} onChange={event => paint('th', 'background-color', event.target.value)} className={`${input} p-0.5`} /></label> : null}
      </div>
      {/* The table as a spreadsheet, to go on working in Excel or WPS. */}
      <div className="space-y-1">
        <span className="block text-[11px] leading-4 text-[var(--color-text-tertiary)]">从 Excel 复制一片单元格，选中单元格后粘贴即可整片填入。</span>
        <div className="grid grid-cols-2 gap-1.5">
          <button type="button" onClick={() => void exportTable(table, 'xlsx')} className="inline-flex h-7 items-center justify-center gap-1 whitespace-nowrap rounded-[var(--radius-sm)] border border-[var(--color-border)] hover:bg-[var(--color-surface-hover)]"><Download size={12} strokeWidth={1.75} aria-hidden="true" />导出 Excel</button>
          <button type="button" onClick={() => void exportTable(table, 'csv')} className="inline-flex h-7 items-center justify-center gap-1 whitespace-nowrap rounded-[var(--radius-sm)] border border-[var(--color-border)] hover:bg-[var(--color-surface-hover)]"><Download size={12} strokeWidth={1.75} aria-hidden="true" />导出 CSV</button>
        </div>
      </div>
    </div>
  )
}

const IMAGE_TURNS = [
  { label: '向左旋转 90°', icon: RotateCcw, edit: (image: HTMLElement) => rotateLayer(image, -1) },
  { label: '向右旋转 90°', icon: RotateCw, edit: (image: HTMLElement) => rotateLayer(image, 1) },
  { label: '水平翻转', icon: FlipHorizontal2, edit: (image: HTMLElement) => flipLayer(image, 'x') },
  { label: '垂直翻转', icon: FlipVertical2, edit: (image: HTMLElement) => flipLayer(image, 'y') },
]

const IMAGE_FITS = [
  { value: 'cover', label: '裁切填满' },
  { value: 'contain', label: '完整显示' },
  { value: 'fill', label: '拉伸铺满' },
]

/**
 * 图片编辑: turns, mirroring, adjustments and fit of an image layer, all CSS
 * on the layer, so 还原 takes them off again and exports draw them. A slider
 * shows its value as it moves and goes into undo once, when it is let go.
 */
function ImageSection({ controller, image, refresh }: { controller: EditorController; image: HTMLImageElement; refresh: () => void }) {
  const apply = (edit: () => void) => {
    edit()
    controller.changed()
    refresh()
  }
  const fit = controller.doc.defaultView?.getComputedStyle(image).objectFit || 'fill'
  return (
    <div className="space-y-2 border-t border-[var(--color-border)] pt-2.5" data-testid="image-section">
      <div className="flex items-center justify-between">
        <span className="font-medium text-[var(--color-text-primary)]">图片编辑</span>
        {hasImageEdits(image) ? <button type="button" onClick={() => apply(() => resetImageEdits(image))} className="text-[11px] text-[var(--color-text-accent)] hover:underline">还原</button> : null}
      </div>
      <div className="grid grid-cols-4 gap-1.5">
        {IMAGE_TURNS.map(item => (
          <button key={item.label} type="button" aria-label={item.label} title={item.label} onClick={() => apply(() => item.edit(image))}
            className="flex h-7 items-center justify-center rounded-[var(--radius-sm)] border border-[var(--color-border)] hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-text-primary)]">
            <item.icon size={13} strokeWidth={1.75} aria-hidden="true" />
          </button>
        ))}
      </div>
      {IMAGE_ADJUSTMENTS.map(item => {
        const value = readImageAdjustment(image, item.fn)
        return (
          <label key={item.fn} className="block space-y-1">
            <span className="flex items-center justify-between"><span>{item.label}</span><span className="tabular-nums text-[var(--color-text-tertiary)]">{value}%</span></span>
            <input type="range" min={item.min} max={item.max} step={5} value={value}
              onChange={event => { setImageAdjustment(image, item.fn, Number(event.target.value)); refresh() }}
              onPointerUp={controller.changed} onKeyUp={controller.changed} onBlur={controller.changed}
              className="w-full accent-[var(--color-brand)]" />
          </label>
        )
      })}
      <label className="block space-y-1">填充方式
        <select value={IMAGE_FITS.some(item => item.value === fit) ? fit : 'fill'} onChange={event => apply(() => { image.style.objectFit = event.target.value })} className={input}>
          {IMAGE_FITS.map(item => <option key={item.value} value={item.value}>{item.label}</option>)}
        </select>
      </label>
    </div>
  )
}

/** Downloads `table` as an .xlsx or .csv file named after its layer. */
async function exportTable(table: HTMLTableElement, format: 'xlsx' | 'csv'): Promise<void> {
  const rows = tableRows(table)
  const name = (table.closest('[data-layer]')?.getAttribute('data-layer') || '表格').replace(/[\\/:*?"<>|]+/g, '-')
  try {
    const blob = format === 'xlsx'
      ? await rowsToXlsx(rows, name)
      : new Blob([rowsToCsv(rows)], { type: 'text/csv;charset=utf-8' })
    downloadBlob(blob, `${name}.${format}`)
  } catch (error) {
    useUIStore.getState().addToast({ type: 'error', message: `导出失败：${error instanceof Error ? error.message : String(error)}` })
  }
}

/** Style and text of the element selected inside an edited board. */
export function PropertiesPanel({ controller, element }: { controller: EditorController; element: HTMLElement | null }) {
  const [, force] = useState(0)
  const refresh = () => force(value => value + 1)
  useEffect(refresh, [element])
  // Clicking another cell of the same table, or Tab to the next one, keeps the
  // selection: read the board again after the editor has handled the input.
  useEffect(() => {
    const doc = controller.doc
    const later = () => window.requestAnimationFrame(() => force(value => value + 1))
    doc.addEventListener('pointerup', later)
    doc.addEventListener('keyup', later)
    return () => {
      doc.removeEventListener('pointerup', later)
      doc.removeEventListener('keyup', later)
    }
  }, [controller])
  if (!element) {
    return (
      <div className={`${panel} p-3 text-[12px] leading-5 text-[var(--color-text-tertiary)]`}>
        单击选中元素，拖动移动位置，双击修改文字。方向键微调（Shift ×10），Delete 删除。
      </div>
    )
  }
  const view = controller.doc.defaultView!
  const computed = view.getComputedStyle(element)
  const leaf = element.childElementCount === 0 && element.tagName !== 'IMG'
  const table = element.tagName === 'TABLE' ? element as HTMLTableElement : element.querySelector('table')
  const width = Math.round(element.getBoundingClientRect().width)
  const set = (property: string, value: string) => {
    element.style.setProperty(property, value)
    controller.changed()
    refresh()
  }
  return (
    <div className={`${panel} max-h-full min-h-0 gap-2.5 overflow-y-auto p-3 text-[12px] text-[var(--color-text-secondary)]`}>
      <div className="flex items-center justify-between">
        <span className="font-medium text-[var(--color-text-primary)]">{element.getAttribute('data-layer') || element.tagName.toLowerCase()}</span>
        <button type="button" aria-label="删除图层" title="删除图层（Delete）" onClick={controller.remove} className="rounded p-1 hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-error)]"><Trash2 size={13} aria-hidden="true" /></button>
      </div>
      {table ? <TableSection controller={controller} table={table} refresh={refresh} /> : null}
      {leaf ? (
        <label className="block space-y-1">文字
          <textarea defaultValue={element.textContent ?? ''} key={`${element.textContent}`} rows={3} onBlur={event => { if (event.target.value !== element.textContent) { element.textContent = event.target.value; controller.changed() } }} className={`${input} h-auto py-1.5`} />
        </label>
      ) : null}
      {element.tagName === 'IMG' ? (
        <label className="block space-y-1">图片地址<input defaultValue={element.getAttribute('src') ?? ''} onBlur={event => { element.setAttribute('src', event.target.value); controller.changed() }} className={input} /></label>
      ) : null}
      {element.tagName === 'IMG' ? <ImageSection controller={controller} image={element as HTMLImageElement} refresh={refresh} /> : null}
      <div className="grid grid-cols-2 gap-2">
        <label className="space-y-1">字号<input type="number" min={6} max={600} defaultValue={Math.round(Number.parseFloat(computed.fontSize))} key={`fs-${computed.fontSize}`} onBlur={event => { const value = Math.round(Number(event.target.value)); if (value > 0 && value !== Math.round(Number.parseFloat(computed.fontSize))) set('font-size', `${value}px`) }} className={input} /></label>
        <label className="space-y-1">字重
          <select value={computed.fontWeight} onChange={event => set('font-weight', event.target.value)} className={input}>
            {['300', '400', '500', '600', '700', '800', '900'].map(weight => <option key={weight} value={weight}>{weight}</option>)}
          </select>
        </label>
        <label className="space-y-1">文字颜色<input type="color" value={toHex(computed.color)} onChange={event => set('color', event.target.value)} className={`${input} p-0.5`} /></label>
        <label className="space-y-1">背景色<input type="color" value={toHex(computed.backgroundColor)} onChange={event => set('background-color', event.target.value)} className={`${input} p-0.5`} /></label>
        {/* Text boxes fit their text until a width is typed in; leaving the
            field untouched must not pin the width it happens to show. */}
        <div className="space-y-1">
          <div className="flex items-center justify-between">
            <label htmlFor="star-layer-width">宽度</label>
            {element.style.width && element.tagName !== 'IMG' ? (
              <button type="button" title="宽度随文字变化，到画板边缘换行" onClick={() => { element.style.removeProperty('width'); controller.changed(); refresh() }} className="text-[11px] text-[var(--color-text-accent)] hover:underline">自适应</button>
            ) : null}
          </div>
          <input id="star-layer-width" type="number" min={1} defaultValue={width} key={`w-${width}`}
            onBlur={event => { const value = Math.round(Number(event.target.value)); if (value > 0 && value !== width) set('width', `${value}px`) }}
            className={input} />
        </div>
        <label className="space-y-1">圆角<input type="number" min={0} defaultValue={Math.round(Number.parseFloat(computed.borderTopLeftRadius) || 0)} onBlur={event => { const value = Math.round(Number(event.target.value)); if (value >= 0 && value !== Math.round(Number.parseFloat(computed.borderTopLeftRadius) || 0)) set('border-radius', `${value}px`) }} className={input} /></label>
      </div>
      <label className="block space-y-1">不透明度 {Math.round(Number(computed.opacity) * 100)}%
        <input type="range" min={0} max={1} step={0.05} value={Number(computed.opacity)} onChange={event => set('opacity', event.target.value)} className="w-full accent-[var(--color-brand)]" />
      </label>
      <div className="flex gap-1.5">
        <button type="button" onClick={() => set('z-index', String((Number.parseInt(computed.zIndex, 10) || 0) + 1))} className="h-7 flex-1 rounded-[var(--radius-sm)] border border-[var(--color-border)] hover:bg-[var(--color-surface-hover)]">上移一层</button>
        <button type="button" onClick={() => set('z-index', String((Number.parseInt(computed.zIndex, 10) || 0) - 1))} className="h-7 flex-1 rounded-[var(--radius-sm)] border border-[var(--color-border)] hover:bg-[var(--color-surface-hover)]">下移一层</button>
      </div>
    </div>
  )
}

const KIND_ICON = { html: FileCode2, svg: Shapes, image: ImageIcon, video: Film }

/** Boards (and, while editing, the edited board's element layers). */
export function LayersPanel({ boards, selected, editing, controller, element, onSelect, onToggle, onRename }: {
  boards: DesignBoard[]
  selected: string | null
  editing: string | null
  controller: EditorController | null
  element: HTMLElement | null
  onSelect: (board: DesignBoard) => void
  onToggle: (board: DesignBoard, key: 'hidden' | 'locked') => void
  onRename: (board: DesignBoard, name: string) => void
}) {
  const [renaming, setRenaming] = useState<string | null>(null)
  const layers = editing && controller ? controller.layers() : []
  return (
    <div className={`${panel} max-h-full min-h-0`}>
      <div className="border-b border-[var(--color-border)] px-3 py-2 text-[12px] font-medium text-[var(--color-text-primary)]">{editing ? '图层' : `画板 · ${boards.length}`}</div>
      <div className="min-h-0 flex-1 overflow-y-auto p-1">
        {editing ? layers.map((layer, index) => (
          <button key={index} type="button" onClick={() => controller?.select(layer.element)}
            className={`flex w-full items-center gap-1.5 rounded-[var(--radius-sm)] py-1 pr-2 text-left text-[12px] ${layer.element === element ? 'bg-[rgba(79,124,255,0.14)] text-[var(--color-text-primary)]' : 'text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-hover)]'}`}
            style={{ paddingLeft: 8 + layer.depth * 14 }}>
            <span className="truncate">{layer.name}</span>
          </button>
        )) : boards.map(board => {
          const Icon = KIND_ICON[board.kind]
          return (
            <div key={board.path} onClick={() => onSelect(board)} onDoubleClick={() => setRenaming(board.path)}
              className={`group flex cursor-pointer items-center gap-1.5 rounded-[var(--radius-sm)] px-2 py-1 text-[12px] ${selected === board.path ? 'bg-[rgba(79,124,255,0.14)] text-[var(--color-text-primary)]' : 'text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-hover)]'}`}>
              <Icon size={13} className="shrink-0 opacity-70" aria-hidden="true" />
              {renaming === board.path ? (
                <input autoFocus defaultValue={board.name} onClick={event => event.stopPropagation()} onBlur={event => { onRename(board, event.target.value.trim() || board.name); setRenaming(null) }} onKeyDown={event => { if (event.key === 'Enter') (event.target as HTMLInputElement).blur(); if (event.key === 'Escape') setRenaming(null) }} className="h-5 min-w-0 flex-1 rounded border border-[#4f7cff] bg-transparent px-1 outline-none" />
              ) : <span className="min-w-0 flex-1 truncate">{board.name}</span>}
              <button type="button" aria-label={board.hidden ? '显示' : '隐藏'} onClick={event => { event.stopPropagation(); onToggle(board, 'hidden') }} className={`rounded p-0.5 ${board.hidden ? '' : 'opacity-0 group-hover:opacity-100'}`}>{board.hidden ? <EyeOff size={12} aria-hidden="true" /> : <Eye size={12} aria-hidden="true" />}</button>
              <button type="button" aria-label={board.locked ? '解锁' : '锁定'} onClick={event => { event.stopPropagation(); onToggle(board, 'locked') }} className={`rounded p-0.5 ${board.locked ? '' : 'opacity-0 group-hover:opacity-100'}`}>{board.locked ? <Lock size={12} aria-hidden="true" /> : <LockOpen size={12} aria-hidden="true" />}</button>
            </div>
          )
        })}
      </div>
    </div>
  )
}

/** 文件库: project assets and exports; click an image to place it. */
export function LibraryPanel({ project, onUpload, onPick }: { project: DesignProject; onUpload: (files: FileList) => void; onPick: (path: string) => void }) {
  const fileRef = useRef<HTMLInputElement>(null)
  const assets = project.assets.filter(asset => asset.kind !== 'other')
  return (
    <div className="flex h-full w-[260px] shrink-0 flex-col border-r border-[var(--color-border)] bg-[var(--color-surface-sidebar,var(--color-surface))]">
      <div className="flex items-center justify-between px-3 py-2.5 text-[13px] font-medium text-[var(--color-text-primary)]">文件库
        <button type="button" aria-label="上传" onClick={() => fileRef.current?.click()} className="rounded p-1 text-[var(--color-text-tertiary)] hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-text-primary)]"><Upload size={14} aria-hidden="true" /></button>
      </div>
      <input ref={fileRef} type="file" multiple accept="image/*,video/*" className="hidden" onChange={event => { if (event.target.files?.length) onUpload(event.target.files); event.target.value = '' }} />
      {assets.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 px-6 text-center">
          <svg viewBox="0 0 120 70" className="w-[120px] text-[var(--color-text-tertiary)]" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.6">
            <rect x="8" y="16" width="44" height="34" rx="5" transform="rotate(-8 30 33)" /><path d="M14 44 l10-10 8 8 6-6 10 10" transform="rotate(-8 30 33)" />
            <rect x="46" y="10" width="48" height="38" rx="6" /><path d="M64 29h12M70 23v12" /><rect x="74" y="34" width="38" height="26" rx="5" />
          </svg>
          <div className="text-[12px] text-[var(--color-text-tertiary)]">储存灵感，随时查看</div>
          <button type="button" onClick={() => fileRef.current?.click()} className="h-8 rounded-[var(--radius-md)] bg-[var(--color-surface-container-high)] px-4 text-[12px] font-medium text-[var(--color-text-primary)]">立即上传</button>
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-2 overflow-y-auto p-3">
          {assets.map(asset => (
            <button key={asset.path} type="button" title={`${asset.name}（单击放到画布）`} onClick={() => onPick(asset.path)} className="aspect-square overflow-hidden rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface-container)]">
              {asset.kind === 'image' ? <img src={designFileUrl(project.id, asset.path, asset.updatedAt)} alt={asset.name} className="h-full w-full object-cover" /> : <Film size={20} className="m-auto text-[var(--color-text-tertiary)]" aria-hidden="true" />}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
