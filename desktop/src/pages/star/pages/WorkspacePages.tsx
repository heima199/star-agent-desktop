import { useState, type DragEvent } from 'react'
import {
  AppWindow, CalendarDays, ChartColumn, Flower2, Kanban, Megaphone, PenTool,
  Plus, Send, Trash2, type LucideIcon,
} from 'lucide-react'
import { getStarBrandName, useStarBrand } from '../../../stores/starBrandStore'
import { useStarWorkbenchStore, type BoardColumn } from '../../../stores/starWorkbenchStore'
import { seedStarComposer } from '../../../components/star/starComposerSeed'
import { openStarPage } from '../../../components/star/starPages'
import { startDesignProject } from '../design/designModel'
import { openConnector } from '../market/marketActions'
import { formatDue, isOverdue } from '../calendar/calendarModel'
import { MarketIcon, StarPageShell, formatDate } from './StarPageShell'

// ─── 看板 ──────────────────────────────────────────────────

const COLUMNS: { id: BoardColumn; label: string }[] = [
  { id: 'todo', label: '待办' },
  { id: 'doing', label: '进行中' },
  { id: 'done', label: '已完成' },
]

export function BoardPage() {
  const brand = useStarBrand()
  // The calendar edits the same cards (it sets their due dates), so both read one store.
  const cards = useStarWorkbenchStore(s => s.cards)
  const setCards = useStarWorkbenchStore(s => s.setCards)
  const [drafts, setDrafts] = useState<Record<string, string>>({})
  const [dragging, setDragging] = useState<string | null>(null)

  const add = (column: BoardColumn) => {
    const title = (drafts[column] ?? '').trim()
    if (!title) return
    setCards(current => [...current, { id: `c${Date.now().toString(36)}`, title, note: '', column, createdAt: Date.now(), due: null }])
    setDrafts(current => ({ ...current, [column]: '' }))
  }
  const drop = (event: DragEvent, column: BoardColumn) => {
    event.preventDefault()
    const id = event.dataTransfer.getData('text/plain') || dragging
    if (id) setCards(current => current.map(card => (card.id === id ? { ...card, column } : card)))
    setDragging(null)
  }

  return (
    <StarPageShell icon={Kanban} title="看板" description={`把任务拖到对应的列；点「交给 ${brand.name}」会在新对话里开始处理这项任务。截止日期在日历里排。`}
      actions={(
        <button type="button" onClick={() => openStarPage('calendar')} className="inline-flex h-8 items-center gap-1.5 rounded-[var(--radius-md)] border border-[var(--color-border)] px-3 text-[13px] text-[var(--color-text-primary)] hover:bg-[var(--color-surface-hover)]">
          <CalendarDays size={14} aria-hidden="true" />在日历中查看
        </button>
      )}>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        {COLUMNS.map(column => {
          const list = cards.filter(card => card.column === column.id)
          return (
            <div key={column.id} onDragOver={event => event.preventDefault()} onDrop={event => drop(event, column.id)}
              className="flex min-h-[360px] flex-col rounded-[var(--radius-lg)] bg-[var(--color-surface-container-low)] p-3">
              <div className="mb-2 flex items-center justify-between px-1 text-[13px] font-medium text-[var(--color-text-secondary)]">{column.label}<span className="text-[var(--color-text-tertiary)]">{list.length}</span></div>
              <div className="flex flex-1 flex-col gap-2">
                {list.map(card => (
                  <div key={card.id} draggable onDragStart={event => { event.dataTransfer.setData('text/plain', card.id); setDragging(card.id) }}
                    className={`group rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface-container-lowest)] p-3 ${dragging === card.id ? 'opacity-50' : ''}`}>
                    <div className={`text-[13px] leading-5 ${card.column === 'done' ? 'text-[var(--color-text-tertiary)] line-through' : 'text-[var(--color-text-primary)]'}`}>{card.title}</div>
                    <div className="mt-2 flex items-center gap-1 text-[11px] text-[var(--color-text-tertiary)]">
                      {card.due ? (
                        <span className={`inline-flex items-center gap-1 ${card.column !== 'done' && isOverdue(card.due) ? 'text-[var(--color-error)]' : ''}`} title="截止日期">
                          <CalendarDays size={11} aria-hidden="true" />{formatDue(card.due)}
                        </span>
                      ) : formatDate(card.createdAt).slice(5)}
                      <span className="flex-1" />
                      {card.column !== 'done' ? (
                        <button type="button" onClick={() => { setCards(current => current.map(item => (item.id === card.id ? { ...item, column: 'doing' } : item))); seedStarComposer(card.title) }}
                          className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[var(--color-text-accent)] hover:bg-[var(--color-surface-hover)]"><Send size={11} aria-hidden="true" />交给 {brand.name}</button>
                      ) : null}
                      <button type="button" aria-label="删除" onClick={() => setCards(current => current.filter(item => item.id !== card.id))} className="rounded p-0.5 opacity-0 hover:text-[var(--color-error)] group-hover:opacity-100"><Trash2 size={12} aria-hidden="true" /></button>
                    </div>
                  </div>
                ))}
              </div>
              <div className="mt-2 flex items-center gap-1.5">
                <input value={drafts[column.id] ?? ''} onChange={event => setDrafts(current => ({ ...current, [column.id]: event.target.value }))} onKeyDown={event => { if (event.key === 'Enter') add(column.id) }}
                  placeholder="添加任务" className="h-8 min-w-0 flex-1 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface-container-lowest)] px-2.5 text-[13px] outline-none" />
                <button type="button" aria-label="添加" onClick={() => add(column.id)} className="flex h-8 w-8 items-center justify-center rounded-[var(--radius-md)] border border-[var(--color-border)] hover:bg-[var(--color-surface-hover)]"><Plus size={14} aria-hidden="true" /></button>
              </div>
            </div>
          )
        })}
      </div>
    </StarPageShell>
  )
}

// ─── 应用 Beta ─────────────────────────────────────────────

type App = { id: string; name: string; desc: string; icon: string | LucideIcon; run: () => void }

const APPS: App[] = [
  { id: 'feishu', name: '飞书', desc: '读写云文档、多维表格与日程', icon: 'connector:feishu', run: () => openConnector('feishu') },
  { id: 'github', name: 'GitHub', desc: '仓库、Issue 与 PR 管理', icon: 'connector:github', run: () => openConnector('github') },
  { id: 'notion', name: 'Notion', desc: '读写 Notion 页面与数据库', icon: 'connector:notion', run: () => openConnector('notion') },
  { id: 'canva', name: 'Canva 可画', desc: '图层分层编辑与导出设计', icon: 'connector:canva', run: () => openConnector('canva') },
  { id: 'florist', name: 'AI 花艺师', desc: '描述场合与喜好，生成花束方案与效果图', icon: Flower2, run: () => seedStarComposer(`我想为下周的生日会准备一束花：预算 300 元，喜欢淡雅色系。请给出 3 套花材搭配方案，并用 ${getStarBrandName()} 绘图生成每套的效果图。`) },
  { id: 'logo', name: 'Logo 制作器', desc: '生成矢量 Logo 方案与品牌色', icon: PenTool, run: () => void startDesignProject({ kind: 'vector', title: 'Logo 设计', prompt: '为我的品牌设计 4 个矢量 Logo 方案（SVG 画板），并给出配套的品牌色与字体。品牌信息：' }) },
  { id: 'dashboard', name: '数据画板', desc: '把表格做成可交互的数据看板', icon: ChartColumn, run: () => seedStarComposer('把我上传的数据做成一个单文件 HTML 数据看板：KPI 卡片、趋势折线、分类柱状图和明细表，支持按时间筛选。') },
  { id: 'xhs', name: '小红书笔记', desc: '标题、正文、标签与 3:4 图片卡片', icon: Megaphone, run: () => void startDesignProject({ kind: 'social', title: '小红书笔记', prompt: '帮我做一组小红书笔记（3 张 3:4 图片卡片 + 标题正文标签），主题：' }) },
]

export function AppsPage() {
  return (
    <StarPageShell icon={AppWindow} title="应用" description="常用工具和连接器，一键开始。">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-4">
        {APPS.map(app => {
          const Icon = typeof app.icon === 'string' ? null : app.icon
          return (
            <button key={app.id} type="button" onClick={app.run} className="flex flex-col gap-3 rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-surface-container-lowest)] p-4 text-left transition-colors hover:border-[var(--color-border-strong)]">
              {Icon ? (
                <span className="flex h-11 w-11 items-center justify-center rounded-[var(--radius-lg)] bg-[var(--color-brand-soft)] text-[var(--color-text-accent)]"><Icon size={20} aria-hidden="true" /></span>
              ) : <MarketIcon icon={app.icon as string} size={44} />}
              <span>
                <span className="block text-[14px] font-medium text-[var(--color-text-primary)]">{app.name}</span>
                <span className="mt-0.5 block text-[12px] leading-[18px] text-[var(--color-text-tertiary)]">{app.desc}</span>
              </span>
            </button>
          )
        })}
      </div>
      <button type="button" onClick={() => openStarPage('plugins')} className="mt-6 text-[13px] text-[var(--color-text-accent)] hover:underline">去插件市场发现更多 →</button>
    </StarPageShell>
  )
}
