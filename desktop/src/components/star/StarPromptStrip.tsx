import { useCallback, useEffect, useMemo, useState, type CSSProperties } from 'react'
import { ArrowLeft, ChevronRight, Copy, LibraryBig, Loader2, PenLine } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { Modal } from '@/components/ui/Modal'
import { SearchField } from '@/components/ui/SearchField'
import { starApi, starErrorText, type StarPromptCard, type StarPromptDetail, type StarPromptFacets, type StarPromptGroup } from '../../api/star'
import { useStarBrand } from '../../stores/starBrandStore'
import { useStarCreateStore } from '../../stores/starCreateStore'
import { useUIStore } from '../../stores/uiStore'
import { starCreateSpec } from '../../lib/starCreateRequest'
import './starPromptStrip.css'

export type StarPromptMode = 'code' | 'design'

/** Code gets the code-driven pieces, Design the generated media. */
export const STAR_PROMPT_GROUPS: Record<StarPromptMode, StarPromptGroup[]> = {
  code: ['design', 'frontend', 'motion'],
  design: ['image', 'video'],
}

const GROUP_NAMES: Record<StarPromptGroup, string> = {
  design: '网页设计',
  frontend: '前端动效组件',
  motion: '动效短片',
  image: '图片生成',
  video: '视频生成',
}

/** Longer prompts (whole-site clones run to hundreds of thousands of characters) are copy-only. */
const MAX_FILL_CHARS = 30_000
/** The detail view shows the start of a long prompt; laying out the whole text can stall the window. */
const PREVIEW_CHARS = 20_000
const CACHE_MS = 10 * 60_000

const stripCache = new Map<StarPromptMode, { at: number; items: StarPromptCard[] }>()
let facetsCache: { at: number; value: StarPromptFacets } | null = null

function useStripData(mode: StarPromptMode) {
  const cached = stripCache.get(mode)
  const [items, setItems] = useState<StarPromptCard[] | null>(cached && Date.now() - cached.at < CACHE_MS ? cached.items : null)
  const [facets, setFacets] = useState<StarPromptFacets | null>(facetsCache && Date.now() - facetsCache.at < CACHE_MS ? facetsCache.value : null)
  const [failed, setFailed] = useState(false)
  useEffect(() => {
    let alive = true
    const hit = stripCache.get(mode)
    if (hit && Date.now() - hit.at < CACHE_MS) {
      setItems(hit.items)
    } else {
      setItems(null)
      void starApi.promptStrip(mode).then(({ items: loaded }) => {
        stripCache.set(mode, { at: Date.now(), items: loaded })
        if (alive) { setItems(loaded); setFailed(false) }
      }).catch(() => { if (alive) setFailed(true) })
    }
    if (!facetsCache || Date.now() - facetsCache.at >= CACHE_MS) {
      void starApi.promptFacets().then((value) => {
        facetsCache = { at: Date.now(), value }
        if (alive) setFacets(value)
      }).catch(() => undefined)
    }
    return () => { alive = false }
  }, [mode])
  return { items, facets, failed }
}

function modeTotal(facets: StarPromptFacets | null, mode: StarPromptMode): number {
  if (!facets) return 0
  return facets.groups.filter(group => STAR_PROMPT_GROUPS[mode].includes(group.id)).reduce((sum, group) => sum + group.count, 0)
}

function Chip({ item, hidden, onOpen }: { item: StarPromptCard; hidden?: boolean; onOpen: (id: string) => void }) {
  return (
    <button
      type="button"
      tabIndex={hidden ? -1 : undefined}
      aria-hidden={hidden ? true : undefined}
      title={item.title}
      onClick={() => onOpen(item.id)}
      className="inline-flex h-9 max-w-[15rem] shrink-0 items-center gap-2 rounded-full bg-[var(--color-surface-container-lowest)] py-1 pl-1 pr-3.5 text-[12px] text-[var(--color-text-secondary)] ring-1 ring-[var(--color-border)] transition-[color,box-shadow,transform] hover:text-[var(--color-text-primary)] hover:ring-[var(--color-border-strong)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-border-focus)] active:scale-[0.98]"
    >
      <img src={item.coverUrl} alt="" loading="lazy" decoding="async" referrerPolicy="no-referrer" className="size-7 shrink-0 rounded-full bg-[var(--color-surface-container)] object-cover" />
      <span className="truncate font-medium">{item.title}</span>
    </button>
  )
}

function StripRow({ items, reverse, onOpen }: { items: StarPromptCard[]; reverse?: boolean; onOpen: (id: string) => void }) {
  if (!items.length) return null
  const style = { '--star-prompt-marquee-duration': `${Math.max(40, items.length * 6)}s` } as CSSProperties
  return (
    <div className="flex w-max py-0.5">
      <div className={`star-prompt-marquee flex w-max gap-2 pr-2 ${reverse ? 'star-prompt-marquee--reverse' : ''}`} style={style}>
        {items.map(item => <Chip key={item.id} item={item} onOpen={onOpen} />)}
        {items.map(item => <Chip key={`${item.id}-copy`} item={item} hidden onOpen={onOpen} />)}
      </div>
    </div>
  )
}

export type StarPromptStripProps = {
  mode: StarPromptMode
  /** Composer slot to arm 文生图 / 文生视频 in when a media prompt is filled in. */
  slot?: string
  /** Put the prompt into the composer (replacing the draft). */
  onUse: (text: string) => void
  className?: string
}

/**
 * 站点提示词 above the Code / Design composer, as on the STAR web workspace:
 * two slowly scrolling rows of prompt chips (paused on hover) and a 全部 link
 * to the whole library. Hidden when the catalog cannot be reached.
 */
export function StarPromptStrip({ mode, slot, onUse, className = '' }: StarPromptStripProps) {
  const { items, facets, failed } = useStripData(mode)
  const [dialog, setDialog] = useState<{ open: boolean; itemId: string | null }>({ open: false, itemId: null })
  const [top, bottom] = useMemo(() => {
    const a: StarPromptCard[] = []
    const b: StarPromptCard[] = []
    ;(items ?? []).forEach((item, index) => (index % 2 === 0 ? a : b).push(item))
    return [a, b]
  }, [items])
  const total = modeTotal(facets, mode)

  if (failed || (items && items.length === 0)) return null

  const applyPrompt = (detail: StarPromptDetail) => {
    if (slot && detail.invokePath !== '/chat') {
      const kind = detail.invokePath === '/image' ? 'image' : 'video'
      const armed = useStarCreateStore.getState().slots[slot]
      if (!armed || starCreateSpec(armed.mode).kind !== kind) {
        useStarCreateStore.getState().arm(slot, kind === 'image' ? 'text2image' : 'text2video')
      }
    }
    onUse(detail.prompt)
  }

  return (
    <section aria-label="站点提示词" data-testid="star-prompt-strip" className={`flex w-full min-w-0 flex-col gap-1.5 ${className}`}>
      <div className="flex items-center justify-between px-1">
        <span className="inline-flex items-center gap-1.5 text-[12px] text-[var(--color-text-tertiary)]">
          <LibraryBig size={14} strokeWidth={1.75} aria-hidden="true" />
          站点提示词
          <span className="hidden sm:inline">· {STAR_PROMPT_GROUPS[mode].map(group => GROUP_NAMES[group]).join(' · ')}</span>
        </span>
        <button
          type="button"
          data-testid="star-prompt-all"
          onClick={() => setDialog({ open: true, itemId: null })}
          className="inline-flex items-center gap-0.5 rounded-[var(--radius-sm)] px-1.5 py-0.5 text-[12px] text-[var(--color-text-tertiary)] transition-colors hover:text-[var(--color-text-primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-border-focus)]"
        >
          {total > 0 ? `全部 ${total.toLocaleString('zh-CN')} 条` : '全部'}
          <ChevronRight size={14} strokeWidth={1.75} aria-hidden="true" />
        </button>
      </div>
      <div className="star-prompt-strip star-prompt-strip-fade relative w-full overflow-hidden rounded-[var(--radius-xl)] bg-[var(--color-surface-container-low)] py-2">
        {items === null ? (
          <div className="flex flex-col gap-2 px-6" aria-hidden="true">
            {[0, 1].map(row => (
              <div key={row} className="flex gap-2">
                {Array.from({ length: 6 }, (_, index) => (
                  <span key={index} className="h-9 w-36 shrink-0 animate-pulse rounded-full bg-[var(--color-surface-container)] motion-reduce:animate-none" />
                ))}
              </div>
            ))}
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            <StripRow items={top} onOpen={itemId => setDialog({ open: true, itemId })} />
            <StripRow items={bottom} reverse onOpen={itemId => setDialog({ open: true, itemId })} />
          </div>
        )}
      </div>
      {dialog.open ? (
        <StarPromptLibraryDialog
          mode={mode}
          initialItemId={dialog.itemId}
          facets={facets}
          onClose={() => setDialog({ open: false, itemId: null })}
          onUse={(detail) => { applyPrompt(detail); setDialog({ open: false, itemId: null }) }}
        />
      ) : null}
    </section>
  )
}

function toast(type: 'success' | 'error' | 'info', message: string) {
  useUIStore.getState().addToast({ type, message })
}

function PromptCardTile({ item, onOpen }: { item: StarPromptCard; onOpen: () => void }) {
  return (
    <button
      type="button"
      onClick={onOpen}
      title={item.title}
      className="group flex min-w-0 flex-col overflow-hidden rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-surface-container-lowest)] text-left transition-[border-color,transform] hover:border-[var(--color-border-strong)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-border-focus)] active:scale-[0.99]"
    >
      <div className="aspect-[4/3] w-full overflow-hidden bg-[var(--color-surface-container)]">
        {item.coverUrl ? <img src={item.coverUrl} alt="" loading="lazy" decoding="async" referrerPolicy="no-referrer" className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.03]" /> : null}
      </div>
      <div className="flex min-w-0 flex-col gap-0.5 px-2.5 py-2">
        <span className="line-clamp-2 text-[12px] font-medium leading-[1.4] text-[var(--color-text-primary)]">{item.title}</span>
        <span className="truncate text-[11px] text-[var(--color-text-tertiary)]">{item.group ? GROUP_NAMES[item.group] : '提示词'}</span>
      </div>
    </button>
  )
}

function PromptDetailView({ id, onBack, onUse }: { id: string; onBack?: () => void; onUse: (detail: StarPromptDetail) => void }) {
  const brand = useStarBrand()
  const [detail, setDetail] = useState<StarPromptDetail | null>(null)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    let alive = true
    setDetail(null)
    setError(null)
    void starApi.promptDetail(id).then((value) => { if (alive) setDetail(value) }).catch((reason) => { if (alive) setError(starErrorText(reason)) })
    return () => { alive = false }
  }, [id])
  const copy = async () => {
    if (!detail) return
    try {
      await navigator.clipboard.writeText(detail.prompt)
      void starApi.markPromptUsed(detail.id)
      toast('success', '提示词已复制')
    } catch {
      toast('error', '复制失败，请手动选中正文复制')
    }
  }
  const tooLong = (detail?.prompt.length ?? 0) > MAX_FILL_CHARS
  return (
    <div className="flex flex-col gap-3" data-testid="star-prompt-detail">
      {onBack ? (
        <button type="button" onClick={onBack} className="inline-flex w-fit items-center gap-1 rounded-[var(--radius-sm)] px-1 text-[12px] text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]">
          <ArrowLeft size={14} strokeWidth={1.75} aria-hidden="true" />返回列表
        </button>
      ) : null}
      {error ? <p className="rounded-[var(--radius-md)] bg-[var(--color-error-container)] px-3 py-2 text-[13px] text-[var(--color-on-error-container)]">{error}</p> : null}
      {!detail && !error ? <div className="flex justify-center py-12"><Loader2 size={20} className="animate-spin text-[var(--color-text-tertiary)]" aria-label="加载中" /></div> : null}
      {detail ? (
        <div className="grid gap-4 md:grid-cols-[minmax(0,280px)_minmax(0,1fr)]">
          <div className="flex flex-col gap-2">
            <div className="overflow-hidden rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-surface-container)]">
              {detail.coverUrl ? <img src={detail.coverUrl} alt="" referrerPolicy="no-referrer" className="w-full object-cover" /> : <div className="aspect-[4/3]" />}
            </div>
            <div className="flex flex-wrap gap-1">
              {detail.tags.map(tag => <span key={tag} className="rounded-[var(--radius-xs)] bg-[var(--color-surface-container)] px-1.5 py-0.5 text-[11px] text-[var(--color-text-secondary)]">{tag}</span>)}
            </div>
          </div>
          <div className="flex min-w-0 flex-col gap-2">
            <h3 className="text-[15px] font-semibold leading-snug text-[var(--color-text-primary)]">{detail.title}</h3>
            <p className="text-[12px] text-[var(--color-text-tertiary)]">
              {detail.group ? `${GROUP_NAMES[detail.group]} · ` : ''}{detail.prompt.length.toLocaleString('zh-CN')} 字
            </p>
            {detail.summary ? <p className="text-[13px] leading-6 text-[var(--color-text-secondary)]">{detail.summary}</p> : null}
            <pre className="max-h-[38vh] overflow-auto whitespace-pre-wrap break-words rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface-container-low)] p-3 font-mono text-[12px] leading-5 text-[var(--color-text-primary)]">{detail.prompt.length > PREVIEW_CHARS ? `${detail.prompt.slice(0, PREVIEW_CHARS)}…` : detail.prompt}</pre>
            {detail.prompt.length > PREVIEW_CHARS ? <p className="text-[11px] text-[var(--color-text-tertiary)]">正文共 {detail.prompt.length.toLocaleString('zh-CN')} 字，这里只显示前 {PREVIEW_CHARS.toLocaleString('zh-CN')} 字；「复制正文」会复制全文。</p> : null}
            {detail.promptTruncated ? <p className="text-[11px] text-[var(--color-warning)]">正文没能完整取回，这里只有开头部分。</p> : null}
            <div className="flex flex-wrap items-center gap-2 pt-1">
              <Button size="base" icon={<PenLine size={14} strokeWidth={1.75} aria-hidden="true" />} disabled={tooLong} title={tooLong ? '正文太长，只能复制' : undefined} onClick={() => { void starApi.markPromptUsed(detail.id); onUse(detail) }}>
                {detail.invokePath === '/image' ? `填入并用 ${brand.name} 文生图` : detail.invokePath === '/video' ? `填入并用 ${brand.name} 文生视频` : '填入输入框'}
              </Button>
              <Button size="base" variant="secondary" icon={<Copy size={14} strokeWidth={1.75} aria-hidden="true" />} onClick={() => void copy()}>复制正文</Button>
            </div>
            {tooLong ? <p className="text-[11px] text-[var(--color-text-tertiary)]">这条正文超过 {MAX_FILL_CHARS.toLocaleString('zh-CN')} 字，直接放进输入框会很难编辑，请复制后按需取用。</p> : null}
          </div>
        </div>
      ) : null}
    </div>
  )
}

const CHIP = 'inline-flex h-7 items-center rounded-full border px-3 text-[12px] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-border-focus)]'
const CHIP_ON = 'border-[var(--color-btn-primary-bg)] bg-[var(--color-btn-primary-bg)] text-[var(--color-btn-primary-fg)]'
const CHIP_OFF = 'border-[var(--color-border)] text-[var(--color-text-secondary)] hover:border-[var(--color-border-strong)] hover:text-[var(--color-text-primary)]'

/** The whole library for one mode: groups, sub-categories, search, then a prompt's full text. */
export function StarPromptLibraryDialog({ mode, initialItemId, facets, onClose, onUse }: {
  mode: StarPromptMode
  initialItemId: string | null
  facets: StarPromptFacets | null
  onClose: () => void
  onUse: (detail: StarPromptDetail) => void
}) {
  const brand = useStarBrand()
  const groups = STAR_PROMPT_GROUPS[mode]
  const [group, setGroup] = useState<StarPromptGroup>(groups[0]!)
  const [sub, setSub] = useState('')
  const [query, setQuery] = useState('')
  const [debounced, setDebounced] = useState('')
  const [items, setItems] = useState<StarPromptCard[]>([])
  const [page, setPage] = useState(1)
  const [hasMore, setHasMore] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [openId, setOpenId] = useState<string | null>(initialItemId)
  const [fromList, setFromList] = useState(!initialItemId)

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(query.trim()), 300)
    return () => clearTimeout(timer)
  }, [query])

  const load = useCallback(async (nextPage: number) => {
    setLoading(true)
    setError(null)
    try {
      const result = await starApi.promptList({ group, sub, q: debounced, page: nextPage, pageSize: 24 })
      setItems(previous => (nextPage === 1 ? result.items : [...previous, ...result.items]))
      setHasMore(result.hasMore)
      setPage(nextPage)
    } catch (reason) {
      setError(starErrorText(reason))
    } finally {
      setLoading(false)
    }
  }, [group, sub, debounced])

  useEffect(() => { void load(1) }, [load])

  const groupFacet = facets?.groups.find(entry => entry.id === group)
  const title = mode === 'code' ? '站点提示词 · Code' : '站点提示词 · Design'

  return (
    <Modal open onClose={onClose} title={title} width={980} typography="interface">
      {openId ? (
        <PromptDetailView id={openId} onBack={fromList ? () => setOpenId(null) : () => { setFromList(true); setOpenId(null) }} onUse={onUse} />
      ) : (
        <div className="flex flex-col gap-3" data-testid="star-prompt-library">
          <p className="text-[12px] leading-5 text-[var(--color-text-tertiary)]">
            {brand.name} 精选提示词。点开一条可以看完整正文，一键填入输入框或复制。
          </p>
          <div className="flex flex-wrap items-center gap-2">
            {groups.map(id => {
              const count = facets?.groups.find(entry => entry.id === id)?.count
              return (
                <button key={id} type="button" className={`${CHIP} ${group === id ? CHIP_ON : CHIP_OFF}`} onClick={() => { setGroup(id); setSub('') }}>
                  {GROUP_NAMES[id]}{count ? <span className="ml-1 tabular-nums opacity-70">{count}</span> : null}
                </button>
              )
            })}
            <div className="ml-auto w-full sm:w-[260px]">
              <SearchField label="搜索提示词" value={query} onChange={setQuery} size="md" clearable clearLabel="清除搜索" placeholder="搜索标题、风格、用途…" />
            </div>
          </div>
          {groupFacet?.subs.length ? (
            <div className="flex flex-wrap gap-1.5">
              <button type="button" className={`${CHIP} h-6 px-2.5 ${sub === '' ? CHIP_ON : CHIP_OFF}`} onClick={() => setSub('')}>全部</button>
              {groupFacet.subs.filter(entry => entry.count > 0).map(entry => (
                <button key={entry.id} type="button" className={`${CHIP} h-6 px-2.5 ${sub === entry.id ? CHIP_ON : CHIP_OFF}`} onClick={() => setSub(entry.id)}>
                  {entry.name}<span className="ml-1 tabular-nums opacity-60">{entry.count}</span>
                </button>
              ))}
            </div>
          ) : null}
          {error ? <p className="rounded-[var(--radius-md)] bg-[var(--color-error-container)] px-3 py-2 text-[13px] text-[var(--color-on-error-container)]">{error}</p> : null}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
            {items.map(item => <PromptCardTile key={item.id} item={item} onOpen={() => { setFromList(true); setOpenId(item.id) }} />)}
          </div>
          {!loading && !error && items.length === 0 ? <p className="py-10 text-center text-[13px] text-[var(--color-text-tertiary)]">没有找到匹配的提示词，换个关键词试试。</p> : null}
          <div className="flex justify-center py-2">
            {loading ? <Loader2 size={18} className="animate-spin text-[var(--color-text-tertiary)]" aria-label="加载中" /> : hasMore ? (
              <Button size="base" variant="secondary" onClick={() => void load(page + 1)}>加载更多</Button>
            ) : null}
          </div>
        </div>
      )}
    </Modal>
  )
}
