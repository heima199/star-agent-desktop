import { useEffect, useRef, useState } from 'react'
import { ArrowLeft, BookOpen, Copy, FileText, FolderOpen, Library, Lightbulb, Loader2, MessageSquarePlus, Plus, Search, Trash2, Upload } from 'lucide-react'
import { starApi, starErrorText, type KnowledgeBase, type StarPlazaItem } from '@/api/star'
import { useBrokenImages, useInfiniteScroll, usePlazaFeed } from '../starFeed'
import { FeedCover, FeedWall } from '../FeedWall'
import { Modal } from '@/components/ui/Modal'
import { getDesktopHost } from '@/lib/desktopHost'
import { seedStarComposer } from '../../../components/star/starComposerSeed'
import { useStarBrand } from '../../../stores/starBrandStore'
import { STAR_CREATE_DRAFT_SLOT, useStarCreateStore } from '../../../stores/starCreateStore'
import { useUIStore } from '../../../stores/uiStore'
import { EmptyHint, ErrorRow, LoadingRow, PillTabs, StarPageShell, formatDate, useLoad } from './StarPageShell'

const toast = (type: 'success' | 'error' | 'info', message: string) => useUIStore.getState().addToast({ type, message })

// ─── 灵感社区 ──────────────────────────────────────────────

export function makeSameStyle(item: { prompt: string; invokePath?: string }): void {
  seedStarComposer(item.prompt)
  if (item.invokePath === '/image') useStarCreateStore.getState().arm(STAR_CREATE_DRAFT_SLOT, 'text2image')
  if (item.invokePath === '/video') useStarCreateStore.getState().arm(STAR_CREATE_DRAFT_SLOT, 'text2video')
}

export function InspirationPage() {
  const [category, setCategory] = useState('')
  const [sub, setSub] = useState('')
  const [preview, setPreview] = useState<StarPlazaItem | null>(null)
  // One step of works at a time, the next when the list is scrolled down at
  // its end; placeholder cards hold the place of a step on its way, and works
  // whose picture no longer loads drop out of the wall.
  const feed = usePlazaFeed({ category, subcategory: sub })
  const { isBroken } = useBrokenImages()
  const sentinel = useInfiniteScroll(feed.hasMore && !feed.loading, feed.more)
  const works = feed.items.filter(item => !item.coverUrl || !isBroken(item.coverUrl))
  const empty = feed.loadedPages > 0 && works.length === 0 && !feed.hasMore && !feed.loading

  const categories = feed.categories
  const current = categories.find(item => item.id === category)
  const pick = (next: string, nextSub = '') => { setCategory(next); setSub(nextSub) }

  return (
    <StarPageShell icon={Lightbulb} title="灵感社区" description="大家的作品和提示词，看到喜欢的点「做同款」。"
      toolbar={(
        <div className="space-y-2">
          <PillTabs items={[{ id: '', label: '全部' }, ...categories.map(item => ({ id: item.id, label: item.name }))]} value={category} onChange={value => pick(value)} />
          {current?.children.length ? <PillTabs size="sm" items={[{ id: '', label: '全部' }, ...current.children.map(item => ({ id: item.id, label: item.name }))]} value={sub} onChange={value => pick(category, value)} /> : null}
        </div>
      )}>
      {feed.error ? <ErrorRow message={feed.error} onRetry={feed.retry} /> : null}
      {empty ? <EmptyHint title="这里还没有作品" /> : (
        <FeedWall
          testId="inspiration-wall"
          items={works}
          keyOf={item => item.id}
          pending={feed.loading && !feed.error}
          render={item => (
            <button type="button" onClick={() => setPreview(item)} className="block w-full overflow-hidden rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-surface-container-lowest)] text-left transition-colors hover:border-[var(--color-border-strong)]">
              {item.coverUrl ? <FeedCover url={item.coverUrl} className="object-cover" /> : null}
              <div className="px-3 py-2.5">
                <div className="line-clamp-1 text-[13px] font-medium text-[var(--color-text-primary)]">{item.title}</div>
                {item.summary ? <div className="mt-0.5 line-clamp-2 text-[12px] leading-[18px] text-[var(--color-text-tertiary)]">{item.summary}</div> : null}
              </div>
            </button>
          )}
        />
      )}
      {/* The end of the wall: scrolling down here loads the next step. */}
      <div ref={sentinel} data-testid="inspiration-more" className="flex h-12 items-center justify-center text-[12px] text-[var(--color-text-tertiary)]">
        {!feed.hasMore && !feed.loading && works.length > 0 ? '已经到底了' : null}
      </div>
      <Modal open={Boolean(preview)} onClose={() => setPreview(null)} width={900} title="作品预览">
        {preview ? (
          <div className="flex max-h-[70vh] gap-5">
            {preview.coverUrl ? <img src={preview.coverUrl} alt="" className="max-h-[70vh] w-1/2 shrink-0 rounded-[var(--radius-md)] object-contain" /> : null}
            <div className="flex min-w-0 flex-1 flex-col">
              <div className="text-[15px] font-semibold text-[var(--color-text-primary)]">{preview.title}</div>
              {preview.summary ? <p className="mt-1 text-[13px] text-[var(--color-text-tertiary)]">{preview.summary}</p> : null}
              <div className="mt-3 min-h-0 flex-1 overflow-y-auto whitespace-pre-wrap rounded-[var(--radius-md)] bg-[var(--color-surface-container)] p-3 text-[13px] leading-6 text-[var(--color-text-secondary)]">{preview.prompt || '这件作品没有公开提示词。'}</div>
              <div className="mt-3 flex gap-2">
                <button type="button" disabled={!preview.prompt} onClick={() => { void navigator.clipboard.writeText(preview.prompt); toast('success', '提示词已复制') }} className="inline-flex h-9 items-center gap-1.5 rounded-[var(--radius-md)] border border-[var(--color-border)] px-3 text-[13px] disabled:opacity-50"><Copy size={13} aria-hidden="true" />复制提示词</button>
                <button type="button" disabled={!preview.prompt} onClick={() => { makeSameStyle(preview); setPreview(null) }} className="h-9 flex-1 rounded-[var(--radius-md)] bg-[var(--color-btn-primary-bg)] text-[13px] font-medium text-[var(--color-btn-primary-fg)] disabled:opacity-50">做同款</button>
              </div>
            </div>
          </div>
        ) : null}
      </Modal>
    </StarPageShell>
  )
}

// ─── 知识库 ────────────────────────────────────────────────

function KnowledgeDetail({ id, onBack }: { id: string; onBack: () => void }) {
  const brand = useStarBrand()
  const [base, setBase] = useState<KnowledgeBase | null>(null)
  const [uploading, setUploading] = useState(0)
  const [query, setQuery] = useState('')
  const [hits, setHits] = useState<{ docId: string; name: string; snippet: string }[] | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  useEffect(() => { void starApi.knowledgeBase(id).then(result => setBase(result.base)).catch(error => toast('error', starErrorText(error))) }, [id])

  const upload = async (files: FileList) => {
    for (const file of Array.from(files)) {
      setUploading(count => count + 1)
      try {
        setBase(await starApi.addKnowledgeDoc(id, file))
      } catch (error) {
        toast('error', `${file.name}：${starErrorText(error)}`)
      }
      setUploading(count => count - 1)
    }
  }
  const search = async () => {
    if (!query.trim()) { setHits(null); return }
    try {
      setHits((await starApi.searchKnowledge(id, query.trim())).hits)
    } catch (error) {
      toast('error', starErrorText(error))
    }
  }

  if (!base) return <LoadingRow />
  return (
    <div>
      <button type="button" onClick={onBack} className="mb-3 inline-flex items-center gap-1 text-[13px] text-[var(--color-text-tertiary)] hover:text-[var(--color-text-primary)]"><ArrowLeft size={14} aria-hidden="true" />全部知识库</button>
      <div className="flex flex-wrap items-start gap-3">
        <div className="min-w-0 flex-1">
          <div className="text-[18px] font-semibold text-[var(--color-text-primary)]">{base.name}</div>
          <div className="mt-0.5 text-[12px] text-[var(--color-text-tertiary)]">{base.description || `上传文档后，${brand.name} 会提取文字，回答时检索并注明出处。`}</div>
        </div>
        <button type="button" onClick={() => void getDesktopHost().shell.openPath(base.dir)} className="inline-flex h-8 items-center gap-1.5 rounded-[var(--radius-md)] border border-[var(--color-border)] px-3 text-[13px]"><FolderOpen size={14} aria-hidden="true" />打开文件夹</button>
        <button type="button" onClick={() => fileRef.current?.click()} className="inline-flex h-8 items-center gap-1.5 rounded-[var(--radius-md)] border border-[var(--color-border)] px-3 text-[13px]">{uploading ? <Loader2 size={14} className="animate-spin" aria-hidden="true" /> : <Upload size={14} aria-hidden="true" />}上传文档</button>
        <button type="button" onClick={() => seedStarComposer(`请基于知识库「${base.name}」回答：先在 text/ 目录中检索相关内容，回答时注明出处文件。\n问题：`, { workDir: base.dir })} className="inline-flex h-8 items-center gap-1.5 rounded-[var(--radius-md)] bg-[var(--color-btn-primary-bg)] px-3 text-[13px] font-medium text-[var(--color-btn-primary-fg)]"><MessageSquarePlus size={14} aria-hidden="true" />在对话中使用</button>
        <input ref={fileRef} type="file" multiple className="hidden" accept=".pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.md,.csv,.json,.html" onChange={event => { if (event.target.files?.length) void upload(event.target.files); event.target.value = '' }} />
      </div>
      <label className="mt-4 flex h-9 items-center gap-2 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface-container-lowest)] px-3 text-[13px]">
        <Search size={14} className="text-[var(--color-text-tertiary)]" aria-hidden="true" />
        <input value={query} onChange={event => setQuery(event.target.value)} onKeyDown={event => { if (event.key === 'Enter') void search() }} placeholder="检索知识库内容，回车搜索" className="min-w-0 flex-1 bg-transparent outline-none" />
      </label>
      {hits ? (
        <div className="mt-3 space-y-2">
          {hits.length === 0 ? <div className="text-[13px] text-[var(--color-text-tertiary)]">没有找到相关内容。</div> : hits.map((hit, index) => (
            <div key={`${hit.docId}-${index}`} className="rounded-[var(--radius-md)] border border-[var(--color-border)] p-3">
              <div className="mb-1 text-[12px] font-medium text-[var(--color-text-accent)]">{hit.name}</div>
              <div className="line-clamp-4 whitespace-pre-wrap text-[12px] leading-5 text-[var(--color-text-secondary)]">{hit.snippet}</div>
            </div>
          ))}
        </div>
      ) : null}
      <div className="mt-5 overflow-hidden rounded-[var(--radius-lg)] border border-[var(--color-border)]">
        {base.docs.length === 0 ? <div className="px-4 py-10 text-center text-[13px] text-[var(--color-text-tertiary)]">还没有文档，支持 PDF、Word、Excel、PPT、TXT、Markdown 等。</div> : base.docs.map(doc => (
          <div key={doc.id} className="flex items-center gap-3 border-b border-[var(--color-border)] px-4 py-2.5 last:border-b-0">
            <FileText size={16} className="shrink-0 text-[var(--color-text-tertiary)]" aria-hidden="true" />
            <div className="min-w-0 flex-1">
              <div className="truncate text-[13px] text-[var(--color-text-primary)]">{doc.name}</div>
              <div className="text-[11px] text-[var(--color-text-tertiary)]">{(doc.size / 1024).toFixed(0)} KB · {doc.chars.toLocaleString()} 字 · {formatDate(doc.addedAt)}{doc.error ? ` · 解析失败：${doc.error}` : ''}</div>
            </div>
            <button type="button" aria-label={`删除 ${doc.name}`} onClick={() => void starApi.deleteKnowledgeDoc(id, doc.id).then(result => setBase(result.base)).catch(error => toast('error', starErrorText(error)))} className="rounded p-1 text-[var(--color-text-tertiary)] hover:text-[var(--color-error)]"><Trash2 size={14} aria-hidden="true" /></button>
          </div>
        ))}
      </div>
    </div>
  )
}

export function KnowledgePage() {
  const brand = useStarBrand()
  const bases = useLoad(() => starApi.knowledgeBases(), 'kb')
  const [selected, setSelected] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')

  const create = async () => {
    try {
      const { base } = await starApi.createKnowledgeBase({ name: name.trim(), description: description.trim() })
      setCreating(false)
      setName('')
      setDescription('')
      bases.reload()
      setSelected(base.id)
    } catch (error) {
      toast('error', starErrorText(error))
    }
  }

  return (
    <StarPageShell icon={Library} title="知识库" description={`把资料放进知识库，${brand.name} 回答时会先检索它们。资料保存在你的电脑上。`}
      actions={!selected ? <button type="button" onClick={() => setCreating(true)} className="inline-flex h-8 items-center gap-1.5 rounded-[var(--radius-md)] bg-[var(--color-btn-primary-bg)] px-3 text-[13px] font-medium text-[var(--color-btn-primary-fg)]"><Plus size={14} aria-hidden="true" />新建知识库</button> : null}>
      {selected ? <KnowledgeDetail id={selected} onBack={() => { setSelected(null); bases.reload() }} /> : (
        <>
          {bases.error ? <ErrorRow message={bases.error} onRetry={bases.reload} /> : null}
          {bases.loading && !bases.data ? <LoadingRow /> : !bases.data?.bases.length ? (
            <EmptyHint icon={BookOpen} title="还没有知识库" hint="新建一个知识库，上传产品手册、制度文件或研究资料。" />
          ) : (
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
              {bases.data.bases.map(base => (
                <button key={base.id} type="button" onClick={() => setSelected(base.id)} className="flex flex-col gap-2 rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-surface-container-lowest)] p-4 text-left hover:border-[var(--color-border-strong)]">
                  <span className="flex items-center gap-2.5"><span className="flex h-9 w-9 items-center justify-center rounded-[var(--radius-md)] bg-[var(--color-brand-soft)] text-[var(--color-text-accent)]"><BookOpen size={17} aria-hidden="true" /></span><span className="truncate text-[14px] font-medium text-[var(--color-text-primary)]">{base.name}</span></span>
                  <span className="line-clamp-2 text-[12px] text-[var(--color-text-tertiary)]">{base.description || '暂无描述'}</span>
                  <span className="text-[11px] text-[var(--color-text-tertiary)]">{base.docCount} 篇文档 · {base.chars.toLocaleString()} 字 · {formatDate(base.updatedAt)}</span>
                </button>
              ))}
            </div>
          )}
        </>
      )}
      <Modal open={creating} onClose={() => setCreating(false)} title="新建知识库" width={460}
        footer={<div className="flex w-full justify-end gap-2"><button type="button" onClick={() => setCreating(false)} className="h-8 rounded-[var(--radius-md)] border border-[var(--color-border)] px-3 text-[13px]">取消</button><button type="button" disabled={!name.trim()} onClick={() => void create()} className="h-8 rounded-[var(--radius-md)] bg-[var(--color-btn-primary-bg)] px-3 text-[13px] font-medium text-[var(--color-btn-primary-fg)] disabled:opacity-50">创建</button></div>}>
        <div className="space-y-3 text-[13px]">
          <input autoFocus value={name} onChange={event => setName(event.target.value)} placeholder="名称，例如：产品手册" className="h-9 w-full rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface-container-lowest)] px-3 outline-none" />
          <textarea value={description} onChange={event => setDescription(event.target.value)} rows={3} placeholder="用途说明（可选）" className="w-full rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface-container-lowest)] px-3 py-2 outline-none" />
        </div>
      </Modal>
    </StarPageShell>
  )
}
