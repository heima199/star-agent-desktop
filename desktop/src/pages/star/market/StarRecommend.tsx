import { useId, useMemo, useState } from 'react'
import { Plus } from 'lucide-react'
import { cx } from '@/lib/cx'
import { formatStarBrand } from '@/lib/starBrand'
import { getStarBrandName, useStarBrand } from '@/stores/starBrandStore'
import { starStudioTabTitle } from '../../../components/star/starTabs'
import { StarCapabilityTest, StarPluginsPanel, matchStarPlugins } from '../StarPluginsPanel'
import { MarketIcon, PillTabs } from '../pages/StarPageShell'
import { MARKET_PLUGINS, PLUGIN_CATEGORIES, type MarketPlugin, type PluginCategoryId } from './pluginCatalog'
import { runPluginAction } from './marketActions'
import codeCardImage from '../../../assets/agent-teams/server-engineer.png'
import contentCardImage from '../../../assets/agent-teams/ui-designer.png'
import dataCardImage from '../../../assets/agent-teams/data-analyst.png'

/** The three cards at the top: a picture each (placeholder art for now), not drawn shapes. */
export const FEATURED: { title: string; image: string; items: { name: string; icon: string; key: string }[] }[] = [
  { title: '研发工具', image: codeCardImage, items: [
    { key: 'code-review', name: '代码审查报告', icon: 'code' },
    { key: 'miniprogram', name: '小程序开发', icon: 'smartphone' },
    { key: 'prototype', name: '快速产品原型开发', icon: 'layout' },
  ] },
  { title: '内容创作', image: contentCardImage, items: [
    { key: 'image-gen', name: '图像生成', icon: 'image' },
    { key: 'video-gen', name: '视频生成', icon: 'clapperboard' },
    { key: 'canva', name: 'Canva 可画', icon: 'connector:canva' },
  ] },
  { title: '数据分析', image: dataCardImage, items: [
    { key: 'excel', name: 'Excel', icon: 'sheet' },
    { key: 'research-data', name: '科研数据助手', icon: 'flask' },
    { key: 'fin-charts', name: '金融动态图表', icon: 'bar-chart' },
  ] },
]

type PluginState = { label: string; disabled?: boolean }

/**
 * STAR's picks other than connectors: the connector catalog under this part
 * lists those with their live status, so a pick here would repeat its card.
 */
const PICKS = MARKET_PLUGINS.filter(plugin => plugin.action.type !== 'connector')
/** Picks shown per category before 查看全部: three rows of the widest grid. */
const COLLAPSED_PICKS = 9
const PICK_CATEGORIES = PLUGIN_CATEGORIES.filter(category =>
  category.id === 'all' || PICKS.some(plugin => plugin.categories.includes(category.id as PluginCategoryId)))

const matchesPick = (plugin: MarketPlugin, q: string) => plugin.name.toLowerCase().includes(q) || formatStarBrand(plugin.desc, getStarBrandName()).toLowerCase().includes(q)

/** Whether a search on the 插件 page finds anything in the STAR part (its scene cards are not searched). */
export function starRecommendMatches(query: string): boolean {
  const q = query.trim().toLowerCase()
  return !q || matchStarPlugins(q).length > 0 || PICKS.some(plugin => matchesPick(plugin, q))
}

function stateOf(plugin: MarketPlugin): PluginState {
  switch (plugin.action.type) {
    case 'star': return { label: '使用' }
    case 'page': return { label: '打开' }
    case 'settings': return { label: '设置' }
    case 'skill':
    case 'connector': return { label: '安装' }
    case 'soon': return { label: '即将上线', disabled: true }
  }
}

/**
 * STAR 首推, the one STAR section at the top of the 插件 page, above the
 * connector catalog: scene cards, STAR's built-in plugins, STAR's other picks
 * with their categories, and the capability test. The built-in plugins and the
 * picks used to sit under two headings; they are one list of STAR's choices.
 * `query` is the page's search text; the scene cards, the categories and the
 * test are for browsing and step aside while it is set.
 */
export function StarRecommend({ query = '' }: { query?: string } = {}) {
  const headingId = useId()
  const brand = useStarBrand()
  const [category, setCategory] = useState<PluginCategoryId | 'all'>('all')
  const [expanded, setExpanded] = useState(false)
  const q = query.trim().toLowerCase()
  const picks = useMemo(() => q
    ? PICKS.filter(plugin => matchesPick(plugin, q))
    : category === 'all' ? PICKS : PICKS.filter(plugin => plugin.categories.includes(category)), [category, q])
  const shownPicks = q || expanded ? picks : picks.slice(0, COLLAPSED_PICKS)

  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-4" data-testid="star-recommend">
      <div>
        <h2 id={headingId} className="text-[15px] font-semibold text-[var(--color-text-primary)]">{brand.name} 首推</h2>
        <p className="mt-1 text-[12px] text-[var(--color-text-tertiary)]">{brand.name} 内置和挑选的插件与技能：在对话里直接说需求即可调用，也可以输入斜杠命令，或一键安装、打开。生成类任务的进度在「{starStudioTabTitle(brand.name)}」任务中心实时显示。</p>
      </div>
      {!q ? (
        // Columns follow the page column, not the window: with the sidebar
        // open, three viewport-sized columns left the text a few glyphs wide.
        <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,260px),1fr))] gap-4">
          {FEATURED.map(card => (
            <div key={card.title} className="flex gap-3 overflow-hidden rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-surface-container-lowest)] p-4">
              <div className="min-w-0 flex-1">
                <div className="mb-3 truncate text-[18px] font-semibold text-[var(--color-text-primary)]">{card.title}</div>
                <ul className="space-y-2">
                  {card.items.map(item => {
                    const plugin = MARKET_PLUGINS.find(entry => entry.key === item.key)
                    return (
                      <li key={item.key} className="min-w-0">
                        <button type="button" title={item.name} onClick={() => plugin && void runPluginAction(plugin.action, plugin.name)}
                          className="flex max-w-full items-center gap-2 text-[13px] text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]">
                          <MarketIcon icon={item.icon} size={22} /><span className="truncate">{item.name}</span>
                        </button>
                      </li>
                    )
                  })}
                </ul>
              </div>
              <div className="flex h-[110px] w-[clamp(84px,34%,150px)] shrink-0 items-end justify-center overflow-hidden rounded-[var(--radius-md)] bg-[var(--color-surface-container-low)]">
                <img src={card.image} alt="" loading="lazy" decoding="async" data-testid="featured-card-image" className="h-full w-auto object-contain" />
              </div>
            </div>
          ))}
        </div>
      ) : null}
      <StarPluginsPanel query={query} />
      {picks.length > 0 ? (
        <div data-testid="star-picks">
          {!q ? <PillTabs items={PICK_CATEGORIES} value={category} onChange={value => { setCategory(value); setExpanded(false) }} size="sm" /> : null}
          <div className={cx('grid grid-cols-[repeat(auto-fill,minmax(min(100%,300px),1fr))] gap-x-6 gap-y-1', !q && 'mt-3')}>
            {shownPicks.map(plugin => {
              const state = stateOf(plugin)
              return (
                <div key={plugin.key} className="flex items-center gap-3 rounded-[var(--radius-md)] px-2 py-3 hover:bg-[var(--color-surface-hover)]">
                  <MarketIcon icon={plugin.icon} size={44} />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5 text-[14px] font-medium text-[var(--color-text-primary)]">
                      <span className="truncate">{plugin.name}</span>
                      {plugin.member ? <span className="shrink-0 rounded-[var(--radius-xs)] px-1 text-[11px] leading-4 text-[var(--color-text-accent)] ring-1 ring-[var(--color-border)]">会员</span> : null}
                    </div>
                    <div className="mt-0.5 line-clamp-2 text-[12px] leading-[18px] text-[var(--color-text-tertiary)]">{brand.format(plugin.desc)}</div>
                  </div>
                  <button type="button" disabled={state.disabled}
                    onClick={() => void runPluginAction(plugin.action, plugin.name)}
                    className={cx('inline-flex h-7 shrink-0 items-center gap-1 whitespace-nowrap rounded-[var(--radius-md)] border px-2.5 text-[12px] transition-colors',
                      state.disabled
                        ? 'cursor-default border-[var(--color-border)] text-[var(--color-text-tertiary)] opacity-70'
                        : 'border-[var(--color-border)] text-[var(--color-text-primary)] hover:bg-[var(--color-surface-container)]')}>
                    {!state.disabled && state.label === '安装' ? <Plus size={12} aria-hidden="true" /> : null}
                    {state.label}
                  </button>
                </div>
              )
            })}
          </div>
          {!q && picks.length > COLLAPSED_PICKS ? (
            <button type="button" onClick={() => setExpanded(value => !value)} className="mt-2 px-2 text-[12px] text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]">
              {expanded ? '收起' : `查看全部 ${picks.length} 个`}
            </button>
          ) : null}
        </div>
      ) : null}
      {/* A search is for finding a plugin; the test comes back with the full list. */}
      {!q ? <StarCapabilityTest /> : null}
    </section>
  )
}
