import { useMemo, useState } from 'react'
import { Check, Star } from 'lucide-react'
import type { StarCatalog, StarChatModel } from '../../api/star'
import type { ModelInfo } from '../../types/settings'
import type { ModelProviderChoice } from './ModelSelector'
import { modelBrandLogo } from './modelBrandLogos'

const FAVORITES_KEY = 'cc-haha.star.favoriteModels'

type Tag = { label: string; gold?: boolean }
type Row = { choice: ModelProviderChoice; model: ModelInfo; star?: StarChatModel }
type Group = { key: string; label: string; count: number; logo?: string; color?: string }

function readFavorites(): string[] {
  try {
    const raw = window.localStorage.getItem(FAVORITES_KEY)
    const parsed: unknown = raw ? JSON.parse(raw) : []
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : []
  } catch {
    return []
  }
}

/** Same rules as the STAR web app's model picker, so both show the same tags. */
export function starModelTags(model: { id: string; name: string; capability?: string }, recommendedId?: string | null): Tag[] {
  const id = `${model.id} ${model.name}`.toLowerCase()
  const cap = (model.capability ?? '').toLowerCase()
  const tokens = new Set(id.split(/[^a-z0-9]+/).filter(Boolean))
  const has = (...words: string[]) => words.some(word => tokens.has(word))
  const tags: Tag[] = []
  if (has('flash', 'lite', 'mini', 'haiku', 'turbo', 'fast')) tags.push({ label: '快线路', gold: true })
  if (recommendedId && model.id === recommendedId) tags.push({ label: '推荐', gold: true })
  if (/reason|think|thinking|-r1|\bo1\b|\bo3\b|opus/.test(id)) tags.push({ label: '思考' })
  if (cap.includes('image') || cap.includes('vision') || /vision|image|vl-|omni/.test(id)) tags.push({ label: '识图' })
  if (cap.includes('tool') || cap.includes('function')) tags.push({ label: '工具' })
  if (cap.includes('search') || cap.includes('web') || /search|browse/.test(id)) tags.push({ label: '联网' })
  const seen = new Set<string>()
  return tags.filter(tag => (seen.has(tag.label) ? false : (seen.add(tag.label), true))).slice(0, 4)
}

/**
 * A brand's official logo: the shipped one for a known brand first, then the
 * console's own icon, and only for an unknown brand without one the letter.
 */
export function BrandMark({ name, brandId, logo, color, size = 18 }: { name: string; brandId?: string; logo?: string; color?: string; size?: number }) {
  const [failed, setFailed] = useState(false)
  const official = modelBrandLogo(name, brandId)
  if (official?.mono) {
    // Single-color marks take the text color through a mask, so they show on both grounds.
    const mask = `url("${official.src}") center / contain no-repeat`
    return <span aria-hidden="true" data-brand-logo={official.src} className="shrink-0 bg-[var(--color-text-primary)]" style={{ width: size, height: size, mask, WebkitMask: mask }} />
  }
  if (official) {
    return <img src={official.src} alt="" data-brand-logo={official.src} width={size} height={size} className="shrink-0 object-contain" />
  }
  if (logo && !failed) {
    return <img src={logo} alt="" width={size} height={size} className="shrink-0 rounded-[var(--radius-xs)] object-contain" onError={() => setFailed(true)} />
  }
  return (
    <span
      aria-hidden="true"
      className="flex shrink-0 items-center justify-center rounded-[var(--radius-xs)] text-[11px] font-semibold text-white"
      style={{ width: size, height: size, background: color || 'var(--color-text-tertiary)' }}
    >
      {name.trim().charAt(0).toUpperCase() || '?'}
    </span>
  )
}

/**
 * The STAR layout of the model picker (as on the STAR web app): brands on the
 * left with counts, the models of the chosen brand on the right with tags and
 * favorites. Other providers keep their own group below the STAR brands, and
 * picking any row goes through the selector's normal selection path.
 */
export function StarModelPanel({ choices, starProviderId, starModels, brands, recommendedId, query, isSelected, onPick, maxHeight }: {
  choices: ModelProviderChoice[]
  starProviderId: string
  starModels: readonly StarChatModel[]
  brands: StarCatalog['brands']
  recommendedId?: string | null
  query: string
  isSelected: (providerId: string | null, modelId: string) => boolean
  onPick: (choice: ModelProviderChoice, model: ModelInfo) => void
  maxHeight: number
}) {
  const [group, setGroup] = useState('all')
  const [favorites, setFavorites] = useState<string[]>(readFavorites)
  const favoriteSet = useMemo(() => new Set(favorites), [favorites])
  const starById = useMemo(() => new Map(starModels.map(model => [model.id, model])), [starModels])
  const brandById = useMemo(() => new Map(brands.map(brand => [brand.id, brand])), [brands])

  const starChoice = choices.find(choice => choice.providerId === starProviderId) ?? null
  const otherChoices = choices.filter(choice => choice.providerId !== starProviderId && choice.models.length > 0)
  const starRows: Row[] = useMemo(
    () => (starChoice?.models ?? []).map(model => ({ choice: starChoice!, model, star: starById.get(model.id) })),
    [starChoice, starById],
  )

  const groups = useMemo(() => {
    const byBrand = new Map<string, Group>()
    for (const row of starRows) {
      const brandId = row.star?.brandId ?? '__slots__'
      const brand = brandById.get(brandId)
      const current = byBrand.get(brandId)
      if (current) current.count += 1
      else byBrand.set(brandId, { key: `brand:${brandId}`, label: row.star?.brandName ?? '默认角色', count: 1, logo: brand?.logo, color: brand?.color })
    }
    return [...byBrand.values()]
  }, [starRows, brandById])

  const favoriteKey = (row: Row) => `${row.choice.providerId ?? 'official'}:${row.model.id}`
  const toggleFavorite = (row: Row) => {
    setFavorites(current => {
      const key = favoriteKey(row)
      const next = current.includes(key) ? current.filter(item => item !== key) : [...current, key]
      try {
        window.localStorage.setItem(FAVORITES_KEY, JSON.stringify(next))
      } catch {
        // Private storage unavailable: favorites last for this window only.
      }
      return next
    })
  }

  const otherRows: Row[] = otherChoices.flatMap(choice => choice.models.map(model => ({ choice, model })))
  const matches = (row: Row) => !query || [row.model.id, row.model.name, row.model.description, row.star?.brandName ?? '', row.choice.providerName]
    .some(value => value.toLocaleLowerCase().includes(query))
  const active = query ? 'all' : group
  const rows = (active === 'all'
    ? [...starRows, ...otherRows]
    : active === 'fav'
      ? [...starRows, ...otherRows].filter(row => favoriteSet.has(favoriteKey(row)))
      : active.startsWith('brand:')
        ? starRows.filter(row => `brand:${row.star?.brandId ?? '__slots__'}` === active)
        : otherRows.filter(row => `provider:${row.choice.providerId ?? 'official'}` === active)
  ).filter(matches)

  const side = (selected: boolean) => `flex w-full items-center gap-2 rounded-[var(--radius-sm)] px-2 py-[6px] text-left text-[12px] transition-colors ${selected ? 'bg-[var(--color-surface-container-high)] text-[var(--color-text-primary)]' : 'text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-hover)]'}`
  const count = (value: number) => <span className="shrink-0 text-[11px] tabular-nums text-[var(--color-text-tertiary)]">{value}</span>

  return (
    <div data-testid="star-model-panel" className="flex min-h-0 flex-1" style={{ height: maxHeight }}>
      <aside className="flex w-[188px] shrink-0 flex-col gap-px overflow-y-auto border-r border-[var(--color-border)] p-1.5">
        <button type="button" className={side(active === 'all')} onClick={() => setGroup('all')}>
          <span className="flex-1 truncate font-medium">全部模型</span>{count(starRows.length + otherRows.length)}
        </button>
        {favorites.length ? (
          <button type="button" className={side(active === 'fav')} onClick={() => setGroup('fav')}>
            <Star size={13} className="shrink-0 text-[var(--color-warning)]" fill="currentColor" aria-hidden="true" />
            <span className="flex-1 truncate">收藏</span>{count(favorites.length)}
          </button>
        ) : null}
        {groups.map(item => (
          <button key={item.key} type="button" className={side(active === item.key)} onClick={() => setGroup(item.key)}>
            <BrandMark name={item.label} brandId={item.key.slice('brand:'.length)} logo={item.logo} color={item.color} size={16} />
            <span className="min-w-0 flex-1 truncate">{item.label}</span>{count(item.count)}
          </button>
        ))}
        {otherChoices.length ? <div className="mx-2 mb-0.5 mt-2 text-[11px] text-[var(--color-text-tertiary)]">其他供应商</div> : null}
        {otherChoices.map(choice => {
          const key = `provider:${choice.providerId ?? 'official'}`
          return (
            <button key={key} type="button" className={side(active === key)} onClick={() => setGroup(key)}>
              <span className="min-w-0 flex-1 truncate">{choice.providerName}</span>{count(choice.models.length)}
            </button>
          )
        })}
      </aside>
      <div className="min-h-0 min-w-0 flex-1 overflow-y-auto p-1.5">
        {rows.length === 0 ? (
          <div role="status" className="py-10 text-center text-[12px] text-[var(--color-text-tertiary)]">{active === 'fav' ? '还没有收藏，悬停模型点星标即可收藏' : '没有匹配的模型'}</div>
        ) : rows.map(row => {
          const selected = isSelected(row.choice.providerId, row.model.id)
          const fav = favoriteSet.has(favoriteKey(row))
          const brand = row.star ? brandById.get(row.star.brandId) : undefined
          const tags = row.star ? starModelTags({ id: row.model.id, name: row.model.name, capability: row.star.capability }, recommendedId) : []
          const subtitle = row.star
            ? [row.star.credits ? `${row.star.credits} 积分/次` : '', row.star.contextWindow ? `${row.star.contextWindow >= 1_000_000 ? `${Math.round(row.star.contextWindow / 100_000) / 10}M` : `${Math.round(row.star.contextWindow / 1000)}K`} 上下文` : ''].filter(Boolean).join(' · ')
            : row.model.description
          return (
            <div
              key={favoriteKey(row)}
              role="button"
              tabIndex={0}
              aria-current={selected || undefined}
              onClick={() => onPick(row.choice, row.model)}
              onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); onPick(row.choice, row.model) } }}
              className={`group/row flex cursor-pointer items-center gap-2.5 rounded-[var(--radius-sm)] px-2 py-[7px] outline-none transition-colors focus-visible:shadow-[var(--shadow-focus-ring)] ${selected ? 'bg-[var(--color-model-option-selected-bg)]' : 'hover:bg-[var(--color-surface-hover)]'}`}
            >
              {row.star ? <BrandMark name={row.star.brandName} brandId={row.star.brandId} logo={brand?.logo} color={brand?.color} /> : null}
              <span className="grid min-w-0 flex-1 gap-px">
                <span className={`truncate text-[13px] ${selected ? 'font-medium text-[var(--color-text-primary)]' : 'text-[var(--color-text-primary)]'}`}>{row.model.name}</span>
                {subtitle ? <span className="truncate text-[11px] text-[var(--color-text-tertiary)]">{subtitle}</span> : null}
              </span>
              <span className="flex shrink-0 items-center gap-1">
                {tags.map(tag => (
                  <span key={tag.label} className={`rounded-[var(--radius-xs)] px-1.5 py-[2px] text-[11px] font-medium leading-none ${tag.gold ? 'bg-[var(--color-warning-container)] text-[var(--color-warning)]' : 'bg-[var(--color-surface-container-high)] text-[var(--color-text-secondary)]'}`}>{tag.label}</span>
                ))}
              </span>
              <button
                type="button"
                aria-label={fav ? '取消收藏' : '收藏'}
                onClick={event => { event.stopPropagation(); toggleFavorite(row) }}
                className={`shrink-0 rounded p-0.5 ${fav ? 'text-[var(--color-warning)]' : 'text-[var(--color-text-tertiary)] opacity-0 focus-visible:opacity-100 group-hover/row:opacity-100'}`}
              >
                <Star size={12} fill={fav ? 'currentColor' : 'none'} aria-hidden="true" />
              </button>
              {selected ? <Check size={14} strokeWidth={2} className="shrink-0 text-[var(--color-brand)]" aria-hidden="true" /> : null}
            </div>
          )
        })}
      </div>
    </div>
  )
}
