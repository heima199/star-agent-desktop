import { useMemo, useState } from 'react'
import { ArrowUp, Check, ChevronDown, LayoutTemplate, Presentation, X } from 'lucide-react'
import { designFileUrl, designLibraryUrl, starApi, type OpenDesignTemplate } from '@/api/star'
import { Modal } from '@/components/ui/Modal'
import { openStarPage } from '../../../components/star/starPages'
import { getStarBrandName } from '../../../stores/starBrandStore'
import { startDesignProject } from '../design/designModel'
import { EmptyHint, LoadingRow, PillTabs, ScaledFrame, StarPageShell, useLoad } from './StarPageShell'

type PptCategory = 'all' | 'custom' | 'report' | 'finance' | 'promo' | 'academic' | 'strategy'

const CATEGORIES: { id: PptCategory; label: string }[] = [
  { id: 'all', label: '全部模版' },
  { id: 'custom', label: '自定义' },
  { id: 'report', label: '工作汇报' },
  { id: 'finance', label: '金融投资' },
  { id: 'promo', label: '宣传推广' },
  { id: 'academic', label: '学术研究' },
  { id: 'strategy', label: '战略咨询' },
]

const RULES: [Exclude<PptCategory, 'all' | 'custom'>, RegExp][] = [
  ['finance', /financ|fundrais|investor|pitch|valuation|ib-pitch|banking|金融|投资|融资|路演/i],
  ['report', /weekly|report|review|okr|status|summary|汇报|周报|复盘|总结/i],
  ['promo', /launch|marketing|promo|xhs|social|brand|poster|broadside|playful|pink|sakura|daisy|宣传|发布|小红书|品牌/i],
  ['academic', /academic|course|lecture|research|education|knowledge|thesis|teaching|graph|学术|课程|教学|知识|研究/i],
  ['strategy', /strategy|consult|executive|board|decision|editorial|professional|grid|monochrome|signal|战略|咨询|决策/i],
]

function categoryOf(template: OpenDesignTemplate): Exclude<PptCategory, 'all' | 'custom'> | null {
  const text = `${template.id} ${template.tags.join(' ')} ${template.description} ${template.zhDescription}`
  return RULES.find(([, rule]) => rule.test(text))?.[0] ?? null
}

export function templateTitle(template: OpenDesignTemplate): string {
  return template.zhName || template.name.replace(/^html-ppt-/, '').replace(/[-_]/g, ' ')
}

export function PptPage() {
  const library = useLoad(() => starApi.designLibrary(), 'od-library')
  const projects = useLoad(() => starApi.designProjects(), 'design-projects')
  const [category, setCategory] = useState<PptCategory>('all')
  const [prompt, setPrompt] = useState('')
  const [pages, setPages] = useState(10)
  const [template, setTemplate] = useState<OpenDesignTemplate | null>(null)
  const [preview, setPreview] = useState<OpenDesignTemplate | null>(null)
  const [pickerOpen, setPickerOpen] = useState(false)
  const [busy, setBusy] = useState(false)

  const decks = useMemo(() => (library.data?.templates ?? []).filter(item => item.mode === 'deck' && item.hasExample), [library.data])
  const shown = category === 'all' ? decks : decks.filter(item => categoryOf(item) === category)
  const myDecks = (projects.data?.projects ?? []).filter(item => item.kind === 'ppt')

  const create = async () => {
    const topic = prompt.trim()
    if (!topic || busy) return
    setBusy(true)
    const style = template ? `参考模板「${templateTitle(template)}」的版式与配色` : '自由风格，根据主题选择合适的版式'
    await startDesignProject({
      kind: 'ppt',
      title: topic,
      ...(template ? { templateId: template.id } : {}),
      prompt: `做一份约 ${pages} 页的演示文稿：${topic}\n\n要求：每页一个 1920×1080 的 HTML 画板（artboards/01-封面.html、02-…），${style}；先给出逐页大纲再逐页制作，数据页配图表，需要配图时用 ${getStarBrandName()} 绘图生成。`,
    })
    setBusy(false)
  }

  return (
    <StarPageShell icon={Presentation} title="PPT" description="一句话生成专业演示文稿：先出大纲，再逐页排版，每页都能在画板里继续修改。">
      <div className="mx-auto mt-2 max-w-[820px] rounded-[var(--radius-xl)] border border-[var(--color-border)] bg-[var(--color-surface-container-lowest)] p-3 shadow-[var(--shadow-raised,0_1px_2px_rgba(0,0,0,0.06))]">
        <textarea value={prompt} onChange={event => setPrompt(event.target.value)} rows={3}
          onKeyDown={event => { if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); void create() } }}
          placeholder="输入 PPT 主题，例如：2026 年第三季度经营复盘，面向管理层"
          className="w-full resize-none bg-transparent px-1 text-[14px] leading-6 text-[var(--color-text-primary)] outline-none placeholder:text-[var(--color-text-tertiary)]" />
        <div className="flex items-center gap-2">
          <div className="relative">
            <button type="button" onClick={() => setPickerOpen(open => !open)} className="inline-flex h-7 items-center gap-1 rounded-full border border-[var(--color-border)] px-2.5 text-[12px] text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-hover)]">
              <LayoutTemplate size={13} aria-hidden="true" />{template ? templateTitle(template) : '自由风格'}<ChevronDown size={12} aria-hidden="true" />
            </button>
            {pickerOpen ? (
              <div className="absolute left-0 top-8 z-[var(--z-dropdown)] max-h-[280px] w-[260px] overflow-y-auto rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface-container-lowest)] p-1 shadow-[var(--shadow-dropdown)]" onMouseLeave={() => setPickerOpen(false)}>
                <button type="button" onClick={() => { setTemplate(null); setPickerOpen(false) }} className="flex w-full items-center justify-between rounded-[var(--radius-sm)] px-2.5 py-1.5 text-left text-[13px] hover:bg-[var(--color-surface-hover)]">自由风格{!template ? <Check size={13} aria-hidden="true" /> : null}</button>
                {decks.map(item => (
                  <button key={item.id} type="button" onClick={() => { setTemplate(item); setPickerOpen(false) }} className="flex w-full items-center justify-between gap-2 rounded-[var(--radius-sm)] px-2.5 py-1.5 text-left text-[13px] hover:bg-[var(--color-surface-hover)]">
                    <span className="truncate">{templateTitle(item)}</span>{template?.id === item.id ? <Check size={13} aria-hidden="true" /> : null}
                  </button>
                ))}
              </div>
            ) : null}
          </div>
          {template ? <button type="button" aria-label="清除模板" onClick={() => setTemplate(null)} className="text-[var(--color-text-tertiary)] hover:text-[var(--color-text-primary)]"><X size={13} aria-hidden="true" /></button> : null}
          <label className="inline-flex h-7 items-center gap-1 rounded-full border border-[var(--color-border)] px-2.5 text-[12px] text-[var(--color-text-secondary)]">
            页数
            <select value={pages} onChange={event => setPages(Number(event.target.value))} className="bg-transparent outline-none">
              {[5, 8, 10, 12, 15, 20, 30].map(value => <option key={value} value={value}>{value} 页</option>)}
            </select>
          </label>
          <span className="flex-1" />
          <button type="button" aria-label="开始生成" disabled={!prompt.trim() || busy} onClick={() => void create()}
            className="flex h-8 w-8 items-center justify-center rounded-full bg-[var(--color-btn-primary-bg)] text-[var(--color-btn-primary-fg)] disabled:opacity-40"><ArrowUp size={16} aria-hidden="true" /></button>
        </div>
      </div>

      <div className="mt-8 flex flex-wrap items-center justify-between gap-3">
        <PillTabs items={CATEGORIES} value={category} onChange={setCategory} size="sm" />
        {library.data && !library.data.available ? <span className="text-[12px] text-[var(--color-text-tertiary)]">模板资源未安装（scripts/sync-open-design.ts）</span> : null}
      </div>
      <div className="mt-4">
        {category === 'custom' ? (
          myDecks.length ? (
            <div className="grid grid-cols-2 gap-4 lg:grid-cols-3 xl:grid-cols-4">
              {myDecks.map(item => (
                <button key={item.id} type="button" onClick={() => openStarPage('design', { project: item.id })} className="group overflow-hidden rounded-[var(--radius-lg)] border border-[var(--color-border)] text-left hover:border-[var(--color-border-strong)]">
                  {item.cover && item.coverKind === 'html'
                    ? <ScaledFrame src={designFileUrl(item.id, item.cover, item.updatedAt)} width={item.width} height={item.height} title={item.title} sandbox="" />
                    : <div className="aspect-video bg-[var(--color-surface-container)]" />}
                  <div className="px-3 py-2"><div className="truncate text-[13px] font-medium">{item.title}</div><div className="text-[11px] text-[var(--color-text-tertiary)]">{item.boardCount} 页</div></div>
                </button>
              ))}
            </div>
          ) : <EmptyHint icon={Presentation} title="还没有自己的演示文稿" hint="在上面输入主题生成第一份 PPT，之后会出现在这里。" />
        ) : library.loading && !library.data ? <LoadingRow /> : shown.length === 0 ? (
          <EmptyHint icon={LayoutTemplate} title="这个分类下暂时没有模板" />
        ) : (
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-3 xl:grid-cols-4">
            {shown.map(item => (
              <button key={item.id} type="button" onClick={() => setPreview(item)} className="group overflow-hidden rounded-[var(--radius-lg)] border border-[var(--color-border)] text-left transition-colors hover:border-[var(--color-border-strong)]">
                <ScaledFrame src={designLibraryUrl(`template/${encodeURIComponent(item.id)}/example`)} width={1920} height={1080} title={templateTitle(item)} />
                <div className="px-3 py-2">
                  <div className="truncate text-[13px] font-medium text-[var(--color-text-primary)]">{templateTitle(item)}</div>
                  <div className="truncate text-[11px] text-[var(--color-text-tertiary)]">{item.zhDescription || item.description}</div>
                </div>
              </button>
            ))}
          </div>
        )}
      </div>
      <p className="mt-6 text-[11px] text-[var(--color-text-tertiary)]">模板来自开源项目 open-design（Apache-2.0）。</p>

      <Modal open={Boolean(preview)} onClose={() => setPreview(null)} width={980} title={preview ? templateTitle(preview) : ''}
        footer={preview ? (
          <div className="flex w-full items-center justify-end gap-2">
            <button type="button" onClick={() => setPreview(null)} className="h-8 rounded-[var(--radius-md)] border border-[var(--color-border)] px-3 text-[13px]">关闭</button>
            <button type="button" onClick={() => { setTemplate(preview); setPreview(null) }} className="h-8 rounded-[var(--radius-md)] bg-[var(--color-btn-primary-bg)] px-3 text-[13px] font-medium text-[var(--color-btn-primary-fg)]">使用此模板</button>
          </div>
        ) : null}>
        {preview ? (
          <div className="space-y-3">
            <div className="overflow-hidden rounded-[var(--radius-md)] border border-[var(--color-border)]">
              <iframe title={templateTitle(preview)} src={designLibraryUrl(`template/${encodeURIComponent(preview.id)}/example`)} sandbox="allow-scripts" className="h-[480px] w-full border-0 bg-white" />
            </div>
            <p className="text-[13px] leading-6 text-[var(--color-text-secondary)]">{preview.zhDescription || preview.description}</p>
          </div>
        ) : null}
      </Modal>
    </StarPageShell>
  )
}
