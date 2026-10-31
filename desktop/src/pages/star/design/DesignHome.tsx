import { useMemo, useRef, useState } from 'react'
import { ArrowUp, Check, History, Image as ImageIcon, Loader2, Palette, Paperclip, Plus, Ruler, X } from 'lucide-react'
import { designFileUrl, starApi, starErrorText, type DesignProjectSummary, type OpenDesignPrompt, type OpenDesignSystem } from '@/api/star'
import { Modal } from '@/components/ui/Modal'
import { useStarBrand } from '../../../stores/starBrandStore'
import { useUIStore } from '../../../stores/uiStore'
import { EmptyHint, LoadingRow, ScaledFrame, formatDate, useLoad } from '../pages/StarPageShell'
import { useBrokenImages, useInfiniteScroll, usePlazaFeed, useRevealed } from '../starFeed'
import { FeedCover, FeedWall } from '../FeedWall'
import { DESIGN_KINDS, KindArt, designKind, startDesignProject } from './designModel'

type HomeTab = 'recent' | 'inspire' | 'systems'
type Case = { id: string; title: string; prompt: string; image: string; credit: string }

const SIZES: Record<string, [number, number, string][]> = {
  poster: [[1080, 1440, '3:4'], [1080, 1920, '9:16'], [1240, 1754, 'A4'], [1080, 1080, '1:1']],
  social: [[1080, 1350, '4:5'], [1080, 1440, '3:4'], [1080, 1080, '1:1'], [1080, 1920, '9:16']],
  card: [[1080, 1920, '9:16'], [1080, 1440, '3:4'], [1200, 1600, '3:4 大']],
  ppt: [[1920, 1080, '16:9'], [1440, 1080, '4:3']],
  custom: [[1440, 1024, '自由'], [1920, 1080, '16:9'], [1080, 1080, '1:1']],
}
const ADDED_KEY = 'star.design.systems'
/** Prompts that started a project, newest first. */
const PROMPT_HISTORY_KEY = 'star.design.promptHistory'
/** What was being typed, so leaving the page does not lose it. */
const PROMPT_DRAFT_KEY = 'star.design.promptDraft'
const PROMPT_HISTORY_LIMIT = 20

function readStrings(key: string): string[] {
  try {
    const value = JSON.parse(localStorage.getItem(key) ?? '[]') as unknown
    return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []
  } catch {
    return []
  }
}

function writeStorage(key: string, value: string | null) {
  try {
    if (value === null) localStorage.removeItem(key)
    else localStorage.setItem(key, value)
  } catch { /* ignore */ }
}

function readAdded(): string[] {
  return readStrings(ADDED_KEY)
}

function readDraft(): string {
  try {
    return localStorage.getItem(PROMPT_DRAFT_KEY) ?? ''
  } catch {
    return ''
  }
}

/** The history with `text` moved to the front, once, and the oldest beyond the limit dropped. */
export function rememberDesignPrompt(history: readonly string[], text: string): string[] {
  return [text, ...history.filter(item => item !== text)].slice(0, PROMPT_HISTORY_LIMIT)
}

export function SystemSwatch({ system, className = '' }: { system: OpenDesignSystem; className?: string }) {
  const colors = system.colors.length ? system.colors : ['#222222', '#f2efe8']
  return (
    <div className={`grid h-full w-full grid-cols-4 grid-rows-2 ${className}`}>
      <div className="col-span-2 row-span-1" style={{ background: colors[0] }} />
      {colors.slice(1, 3).map(color => <div key={color} style={{ background: color }} />)}
      <div className="col-span-4 row-span-1 flex items-end px-3 pb-2" style={{ background: colors[colors.length - 1] }}>
        <span className="truncate text-[15px]" style={{ color: colors[0] }}>{system.name}</span>
      </div>
    </div>
  )
}

export function DesignHome({ onOpen }: { onOpen: (projectId: string) => void }) {
  const brand = useStarBrand()
  const [tab, setTab] = useState<HomeTab>('inspire')
  const [prompt, setPrompt] = useState(readDraft)
  const [history, setHistory] = useState<string[]>(() => readStrings(PROMPT_HISTORY_KEY))
  const [historyMenu, setHistoryMenu] = useState(false)
  // Where ↑/↓ stand in the history (-1: the text being typed), and that text.
  const historyIndex = useRef(-1)
  const draftBeforeHistory = useRef('')
  const [kind, setKind] = useState('poster')
  const [size, setSize] = useState<[number, number] | null>(null)
  const [systemId, setSystemId] = useState('')
  const [added, setAdded] = useState<string[]>(readAdded)
  const [systemMenu, setSystemMenu] = useState(false)
  const [sizeMenu, setSizeMenu] = useState(false)
  const [references, setReferences] = useState<string[]>([])
  const [busy, setBusy] = useState(false)
  const [preview, setPreview] = useState<Case | null>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const library = useLoad(() => starApi.designLibrary(), 'od-library')
  const projects = useLoad(() => starApi.designProjects(), 'design-projects')
  // 灵感 loads 15 at a time: the 灵感社区 pages first, then the open-design
  // examples, each step on scrolling to the end. Pictures that fail to load
  // (expired links) leave the feed instead of showing as broken images.
  // Only works that can be shown and made again; broken ones are replaced from the next page.
  const plaza = usePlazaFeed({ category: 'image', requireCover: true, requirePrompt: true })
  const prompts = useLoad(() => starApi.designPrompts('image').catch(() => ({ items: [] as OpenDesignPrompt[] })), 'od-prompts')
  const { isBroken, markBroken } = useBrokenImages()

  const systems = library.data?.systems ?? []
  const system = systems.find(item => item.id === systemId) ?? null
  const current = designKind(kind)
  const sizes = SIZES[kind] ?? [[current.width, current.height, '默认']]
  const odCases = useMemo<Case[]>(
    () => (prompts.data?.items ?? []).filter(item => item.previewImageUrl).map(item => ({ id: `o-${item.id}`, title: item.title, prompt: item.prompt, image: item.previewImageUrl, credit: [item.author, item.license].filter(Boolean).join(' · ') })),
    [prompts.data],
  )
  const od = useRevealed(odCases, 'od')
  const plazaPending = plaza.loadedPages === 0 && !plaza.error
  const cases = useMemo<Case[]>(() => {
    const fromPlaza = plaza.items.filter(item => item.coverUrl && item.prompt).map(item => ({ id: `p-${item.id}`, title: item.title, prompt: item.prompt, image: item.coverUrl, credit: `${brand.name} 灵感社区` }))
    return [...fromPlaza, ...(plaza.hasMore || plazaPending ? [] : od.shown)]
  }, [brand.name, od.shown, plaza.hasMore, plaza.items, plazaPending])
  const shownCases = cases.filter(item => !isBroken(item.image))
  const feedLoading = plaza.loading || prompts.loading
  const sentinel = useInfiniteScroll(
    tab === 'inspire' && !feedLoading && (plaza.hasMore || od.hasMore),
    () => (plaza.hasMore ? plaza.more() : od.more()),
  )

  const toggleAdded = (id: string) => {
    const next = added.includes(id) ? added.filter(item => item !== id) : [id, ...added]
    setAdded(next)
    try { localStorage.setItem(ADDED_KEY, JSON.stringify(next)) } catch { /* ignore */ }
  }

  const attach = async (files: FileList) => {
    for (const file of Array.from(files).slice(0, 6)) {
      try {
        const url = await starApi.uploadReference(file, 'image', file.name)
        setReferences(list => [...list, url].slice(0, 6))
      } catch (error) {
        useUIStore.getState().addToast({ type: 'error', message: starErrorText(error) })
      }
    }
  }

  const create = async () => {
    const text = prompt.trim()
    if (!text || busy) return
    setBusy(true)
    const [width, height] = size ?? [current.width, current.height]
    const full = references.length ? `${text}\n\n参考图（用于风格与构图，可用 star_image_to_image 处理）：\n${references.join('\n')}` : text
    const started = await startDesignProject({ kind, width, height, prompt: full, ...(systemId ? { systemId } : {}) })
    setBusy(false)
    if (!started) return
    // Sent: it joins the history and the draft starts over.
    const next = rememberDesignPrompt(history, text)
    setHistory(next)
    writeStorage(PROMPT_HISTORY_KEY, JSON.stringify(next))
    editPrompt('')
  }

  // Every edit is the draft, and leaves the history being stepped through.
  const editPrompt = (text: string) => {
    historyIndex.current = -1
    setPrompt(text)
    writeStorage(PROMPT_DRAFT_KEY, text ? text : null)
  }

  /** ↑ goes back through earlier prompts, ↓ forward and finally to what was being typed. */
  const stepHistory = (direction: 1 | -1): boolean => {
    const next = historyIndex.current + direction
    if (next < -1 || next >= history.length) return false
    if (historyIndex.current === -1) draftBeforeHistory.current = prompt
    historyIndex.current = next
    setPrompt(next === -1 ? draftBeforeHistory.current : history[next]!)
    return true
  }

  const pickHistory = (text: string) => {
    setHistoryMenu(false)
    editPrompt(text)
    requestAnimationFrame(() => inputRef.current?.focus())
  }

  const clearHistory = () => {
    setHistoryMenu(false)
    setHistory([])
    writeStorage(PROMPT_HISTORY_KEY, null)
  }

  const generateSystem = () => {
    setKind('custom')
    editPrompt('为我的品牌生成一套设计系统：主辅色板（含 HEX）、中英文字体搭配、字号层级、按钮与卡片样式，输出一张规范展示画板。品牌是：')
    requestAnimationFrame(() => inputRef.current?.focus())
  }

  const chip = 'inline-flex h-7 items-center gap-1 rounded-full px-2.5 text-[12px] text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-hover)]'
  const tabButton = (id: HomeTab) => `h-8 rounded-full px-3.5 text-[13px] ${tab === id ? 'bg-[var(--color-surface-container-high)] font-medium text-[var(--color-text-primary)]' : 'text-[var(--color-text-tertiary)] hover:text-[var(--color-text-secondary)]'}`
  const recent = projects.data?.projects ?? []

  return (
    <div className="h-full overflow-y-auto bg-[var(--color-surface)] [scrollbar-gutter:stable]">
      <div className="mx-auto w-full max-w-[860px] px-6 pb-20 pt-14">
        <h1 className="mb-8 text-center text-[26px] font-semibold leading-tight text-[var(--color-text-primary)]">
          {brand.name} <span className="font-normal text-[var(--color-text-tertiary)]">Design</span>
        </h1>
        <div className="rounded-[var(--radius-3xl)] border border-[var(--color-border)] bg-[var(--color-surface-container-low)]">
          <div className="rounded-[var(--radius-3xl)] border-b border-[var(--color-border)] bg-[var(--color-surface-container-lowest)] p-3">
            <textarea ref={inputRef} value={prompt} onChange={event => editPrompt(event.target.value)} rows={3} placeholder={history.length ? `和 ${brand.name} 一起创作，↑ 调出历史描述` : `和 ${brand.name} 一起创作`}
              onKeyDown={event => {
                if (event.nativeEvent.isComposing) return
                if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); void create(); return }
                // Like a terminal: ↑ on an empty box, or while showing an earlier prompt unchanged.
                const browsing = historyIndex.current >= 0 && prompt === history[historyIndex.current]
                if (event.key === 'ArrowUp' && (!prompt || browsing) && stepHistory(1)) event.preventDefault()
                else if (event.key === 'ArrowDown' && browsing && stepHistory(-1)) event.preventDefault()
              }}
              className="w-full resize-none bg-transparent px-1 text-[14px] leading-6 text-[var(--color-text-primary)] outline-none placeholder:text-[var(--color-text-tertiary)]" />
            {references.length ? (
              <div className="mb-2 flex flex-wrap gap-2">
                {references.map(url => (
                  <span key={url} className="relative h-12 w-12 overflow-hidden rounded-[var(--radius-md)] border border-[var(--color-border)]">
                    <img src={url} alt="" className="h-full w-full object-cover" />
                    <button type="button" aria-label="移除参考图" onClick={() => setReferences(list => list.filter(item => item !== url))} className="absolute right-0.5 top-0.5 rounded-full bg-black/60 p-0.5 text-white"><X size={9} aria-hidden="true" /></button>
                  </span>
                ))}
              </div>
            ) : null}
            <div className="flex items-center gap-1">
              <label aria-label="添加参考图" title="添加参考图" className={`${chip} cursor-pointer px-1.5`}><Paperclip size={14} aria-hidden="true" /><input type="file" multiple accept="image/*" className="hidden" onChange={event => { if (event.target.files?.length) void attach(event.target.files); event.target.value = '' }} /></label>
              <div className="relative">
                <button type="button" className={chip} onClick={() => { setSystemMenu(open => !open); setSizeMenu(false) }}><Palette size={13} aria-hidden="true" />{system ? system.name : '设计系统'}</button>
                {systemMenu ? (
                  <div className="absolute left-0 top-8 z-[var(--z-dropdown)] max-h-[320px] w-[280px] overflow-y-auto rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-surface-container-lowest)] p-1.5 shadow-[var(--shadow-dropdown)]" onMouseLeave={() => setSystemMenu(false)}>
                    <button type="button" onClick={() => { setSystemId(''); setSystemMenu(false) }} className="flex w-full items-center justify-between rounded-[var(--radius-md)] px-2.5 py-2 text-left text-[12px] hover:bg-[var(--color-surface-hover)]">不使用设计系统{!systemId ? <Check size={13} aria-hidden="true" /> : null}</button>
                    {[...systems.filter(item => added.includes(item.id)), ...systems.filter(item => !added.includes(item.id))].slice(0, 80).map(item => (
                      <button key={item.id} type="button" onClick={() => { setSystemId(item.id); setSystemMenu(false) }} className="flex w-full items-center gap-2 rounded-[var(--radius-md)] px-2.5 py-1.5 text-left text-[12px] hover:bg-[var(--color-surface-hover)]">
                        <span className="flex h-5 w-8 shrink-0 overflow-hidden rounded">{(item.colors.length ? item.colors : ['#ccc']).slice(0, 4).map(color => <span key={color} className="flex-1" style={{ background: color }} />)}</span>
                        <span className="min-w-0 flex-1 truncate">{item.name}</span>{systemId === item.id ? <Check size={13} aria-hidden="true" /> : null}
                      </button>
                    ))}
                  </div>
                ) : null}
              </div>
              <div className="relative">
                <button type="button" className={chip} onClick={() => { setSizeMenu(open => !open); setSystemMenu(false) }}><Ruler size={13} aria-hidden="true" />{size ? `${size[0]}×${size[1]}` : '自适应'}</button>
                {sizeMenu ? (
                  <div className="absolute left-0 top-8 z-[var(--z-dropdown)] w-[200px] rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-surface-container-lowest)] p-1.5 shadow-[var(--shadow-dropdown)]" onMouseLeave={() => setSizeMenu(false)}>
                    <button type="button" onClick={() => { setSize(null); setSizeMenu(false) }} className="flex w-full justify-between rounded-[var(--radius-md)] px-2.5 py-1.5 text-[12px] hover:bg-[var(--color-surface-hover)]">自适应<span className="text-[var(--color-text-tertiary)]">{current.width}×{current.height}</span></button>
                    {sizes.map(([width, height, label]) => (
                      <button key={`${width}x${height}`} type="button" onClick={() => { setSize([width, height]); setSizeMenu(false) }} className="flex w-full justify-between rounded-[var(--radius-md)] px-2.5 py-1.5 text-[12px] hover:bg-[var(--color-surface-hover)]">{label}<span className="text-[var(--color-text-tertiary)]">{width}×{height}</span></button>
                    ))}
                  </div>
                ) : null}
              </div>
              {history.length ? (
                <div className="relative">
                  <button type="button" className={chip} aria-expanded={historyMenu} onClick={() => { setHistoryMenu(open => !open); setSystemMenu(false); setSizeMenu(false) }}><History size={13} strokeWidth={1.75} aria-hidden="true" />历史</button>
                  {historyMenu ? (
                    <div role="menu" aria-label="历史描述" className="absolute left-0 top-8 z-[var(--z-dropdown)] max-h-[320px] w-[340px] overflow-y-auto rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-surface-container-lowest)] p-1.5 shadow-[var(--shadow-dropdown)]" onMouseLeave={() => setHistoryMenu(false)}>
                      {history.map(item => (
                        <button key={item} type="button" role="menuitem" title={item} onClick={() => pickHistory(item)} className="block w-full truncate rounded-[var(--radius-md)] px-2.5 py-1.5 text-left text-[12px] text-[var(--color-text-primary)] hover:bg-[var(--color-surface-hover)]">{item}</button>
                      ))}
                      <div className="my-1 h-px bg-[var(--color-border)]" />
                      <button type="button" role="menuitem" onClick={clearHistory} className="block w-full rounded-[var(--radius-md)] px-2.5 py-1.5 text-left text-[12px] text-[var(--color-text-tertiary)] hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-text-primary)]">清空历史</button>
                    </div>
                  ) : null}
                </div>
              ) : null}
              <span className="flex-1" />
              <button type="button" aria-label="开始创作" disabled={!prompt.trim() || busy} onClick={() => void create()} className="flex h-8 w-8 items-center justify-center rounded-full bg-[var(--color-btn-primary-bg)] text-[var(--color-btn-primary-fg)] disabled:opacity-40">{busy ? <Loader2 size={15} className="animate-spin" aria-hidden="true" /> : <ArrowUp size={15} aria-hidden="true" />}</button>
            </div>
          </div>
          {/* All nine types side by side on one line: the chips share the width
              and never wrap; a very narrow window scrolls the row instead. */}
          <div data-testid="design-kind-row" className="flex flex-nowrap gap-2 overflow-x-auto px-3 py-3 [scrollbar-width:none]">
            {DESIGN_KINDS.map(item => {
              const active = kind === item.id
              return (
                <button key={item.id} type="button" title={item.hint} aria-pressed={active} onClick={() => { setKind(item.id); setSize(null) }} className="flex min-w-[64px] flex-1 flex-col items-center gap-1.5">
                  <span className={`flex h-[44px] w-full max-w-[72px] items-center justify-center rounded-[var(--radius-md)] border ${active ? 'border-[var(--color-brand)] bg-[var(--color-brand-soft)] text-[var(--color-brand)]' : 'border-[var(--color-border)] bg-[var(--color-surface-container)] text-[var(--color-text-tertiary)]'}`}><KindArt art={item.art} active={active} /></span>
                  <span className={`whitespace-nowrap text-[12px] ${active ? 'font-medium text-[var(--color-text-primary)]' : 'text-[var(--color-text-secondary)]'}`}>{item.label}</span>
                </button>
              )
            })}
          </div>
        </div>

        <div className="mb-4 mt-10 flex items-center gap-1">
          <button type="button" className={tabButton('recent')} onClick={() => setTab('recent')}>最近项目</button>
          <button type="button" className={tabButton('inspire')} onClick={() => setTab('inspire')}>探索灵感</button>
          <button type="button" className={tabButton('systems')} onClick={() => setTab('systems')}>设计系统</button>
          <span className="flex-1" />
          {tab === 'systems' ? <button type="button" onClick={generateSystem} className="inline-flex items-center gap-1 text-[12px] text-[var(--color-text-tertiary)] hover:text-[var(--color-text-primary)]"><Plus size={13} aria-hidden="true" />生成设计系统</button> : null}
        </div>

        {tab === 'recent' ? (
          projects.loading && !projects.data ? <LoadingRow /> : recent.length === 0 ? <EmptyHint icon={ImageIcon} title="还没有设计项目" hint="在上面描述你想要的设计，或从「探索灵感」里挑一个做同款。" /> : (
            <div className="grid grid-cols-2 gap-4 md:grid-cols-3">
              {recent.map((item: DesignProjectSummary) => (
                <button key={item.id} type="button" onClick={() => onOpen(item.id)} className="overflow-hidden rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-surface-container-lowest)] text-left hover:border-[var(--color-border-strong)]">
                  <div className="flex aspect-[4/3] items-center justify-center overflow-hidden bg-[var(--color-surface-container)]">
                    {item.cover && item.coverKind === 'html' ? <div className="w-full"><ScaledFrame src={designFileUrl(item.id, item.cover, item.updatedAt)} width={item.width} height={item.height} title={item.title} sandbox="" /></div>
                      : item.cover && (item.coverKind === 'image' || item.coverKind === 'svg') && !isBroken(designFileUrl(item.id, item.cover, item.updatedAt))
                        ? <img src={designFileUrl(item.id, item.cover, item.updatedAt)} alt="" onError={() => markBroken(designFileUrl(item.id, item.cover!, item.updatedAt))} className="h-full w-full object-contain" />
                        : <span className="h-10 w-16 text-[var(--color-text-tertiary)]"><KindArt art={designKind(item.kind).art} /></span>}
                  </div>
                  <div className="px-3 py-2.5"><div className="truncate text-[13px] font-medium text-[var(--color-text-primary)]">{item.title}</div><div className="text-[11px] text-[var(--color-text-tertiary)]">{designKind(item.kind).label} · {item.boardCount} 个画板 · {formatDate(item.updatedAt)}</div></div>
                </button>
              ))}
            </div>
          )
        ) : null}

        {tab === 'inspire' ? (
          shownCases.length === 0 && !feedLoading && !plazaPending ? <EmptyHint title="暂时没有灵感案例" /> : (
            <>
              {/* Placeholder cards hold the place of the step on its way. */}
              <FeedWall
                testId="design-inspiration-feed"
                items={shownCases}
                keyOf={item => item.id}
                maxColumns={3}
                pending={feedLoading || plazaPending}
                render={item => (
                  <button type="button" onClick={() => setPreview(item)} className="group relative block w-full overflow-hidden rounded-[var(--radius-lg)] text-left">
                    <FeedCover url={item.image} alt={item.title} className="transition-transform duration-300 group-hover:scale-[1.02]" />
                    <span className="absolute left-2 top-2 flex h-6 w-6 items-center justify-center rounded-full bg-black/45 text-white"><ImageIcon size={12} aria-hidden="true" /></span>
                  </button>
                )}
              />
              <div ref={sentinel} data-testid="design-inspiration-more" className="h-12" />
            </>
          )
        ) : null}

        {tab === 'systems' ? (
          library.loading && !library.data ? <LoadingRow /> : (
            <>
              {added.length ? <div className="mb-2 text-[12px] text-[var(--color-text-tertiary)]">已添加</div> : null}
              <div className="mb-6 grid grid-cols-2 gap-4 md:grid-cols-3">
                {systems.filter(item => added.includes(item.id)).map(item => <SystemCard key={item.id} system={item} added onToggle={() => toggleAdded(item.id)} onUse={() => setSystemId(item.id)} active={systemId === item.id} />)}
              </div>
              <div className="mb-2 text-[12px] text-[var(--color-text-tertiary)]">推荐</div>
              <div className="grid grid-cols-2 gap-4 md:grid-cols-3">
                {systems.filter(item => !added.includes(item.id)).slice(0, 60).map(item => <SystemCard key={item.id} system={item} added={false} onToggle={() => toggleAdded(item.id)} onUse={() => setSystemId(item.id)} active={systemId === item.id} />)}
              </div>
              <p className="mt-6 text-[11px] text-[var(--color-text-tertiary)]">设计系统来自开源项目 open-design（Apache-2.0），仅作风格参考。</p>
            </>
          )
        ) : null}
      </div>

      <Modal open={Boolean(preview)} onClose={() => setPreview(null)} width={920} variant="media" title="案例预览">
        {preview ? (
          <div className="flex max-h-[76vh] gap-5">
            <img src={preview.image} alt={preview.title} className="max-h-[76vh] w-[56%] shrink-0 rounded-[var(--radius-lg)] object-contain" />
            <div className="flex min-w-0 flex-1 flex-col">
              <div className="text-[15px] font-semibold text-[var(--color-text-primary)]">{preview.title}</div>
              {preview.credit ? <div className="mt-0.5 text-[11px] text-[var(--color-text-tertiary)]">{preview.credit}</div> : null}
              <div className="mt-3 min-h-0 flex-1 overflow-y-auto whitespace-pre-wrap text-[13px] leading-6 text-[var(--color-text-secondary)]">{preview.prompt}</div>
              <button type="button" onClick={() => { editPrompt(preview.prompt); setPreview(null); requestAnimationFrame(() => inputRef.current?.focus()) }} className="mt-4 h-10 rounded-[var(--radius-md)] bg-[var(--color-btn-primary-bg)] text-[13px] font-medium text-[var(--color-btn-primary-fg)]">做同款</button>
            </div>
          </div>
        ) : null}
      </Modal>
    </div>
  )
}

function SystemCard({ system, added, active, onToggle, onUse }: { system: OpenDesignSystem; added: boolean; active: boolean; onToggle: () => void; onUse: () => void }) {
  return (
    <div className={`overflow-hidden rounded-[var(--radius-lg)] border ${active ? 'border-[var(--color-brand)]' : 'border-[var(--color-border)]'} bg-[var(--color-surface-container-lowest)]`}>
      <button type="button" onClick={onUse} className="block h-[118px] w-full"><SystemSwatch system={system} /></button>
      <div className="flex items-center gap-2 px-3 py-2.5">
        <div className="min-w-0 flex-1">
          <div className="truncate text-[13px] font-medium text-[var(--color-text-primary)]">{system.name}</div>
          <div className="truncate text-[11px] text-[var(--color-text-tertiary)]">{system.category || '来自 open-design'}</div>
        </div>
        <button type="button" onClick={onToggle} className="h-7 rounded-[var(--radius-md)] border border-[var(--color-border)] px-2 text-[12px] hover:bg-[var(--color-surface-hover)]">{added ? '移除' : '添加'}</button>
      </div>
    </div>
  )
}
