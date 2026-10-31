import { useEffect, useRef, useState } from 'react'
import { ArrowLeft, PackageCheck, Server } from 'lucide-react'
import { useTranslation } from '@/i18n'
import { useUIStore } from '@/stores/uiStore'
import { cx } from '@/lib/cx'
import { Button } from '@/components/ui/Button'
import { SegmentedControl } from '@/components/ui/SegmentedControl'
import { EXTENSION_PAGE_COLUMN } from '@/components/market/pageLayout'
import { Connectors } from '@/pages/Connectors'
import { Market } from '@/pages/Market'
import { InstalledSkills } from '@/pages/InstalledSkills'
import { StarRecommend, starRecommendMatches } from '@/pages/star/market/StarRecommend'
import { StarSkillsShelf } from '@/pages/star/market/StarSkillsShelf'
import { openSettings } from '@/pages/star/market/marketActions'
import { useStarStore } from '@/stores/starStore'

/** STAR 首推 heads the 插件 catalog and answers its search box; nothing is shown for a search it has no match for. */
const starPart = (query: string) => (starRecommendMatches(query) ? <StarRecommend query={query} /> : null)

export function ExtensionMarket() {
  const t = useTranslation()
  const [section, setSection] = useState<'plugins' | 'skills'>('plugins')
  const [managing, setManaging] = useState(false)
  const [focusConnectorId, setFocusConnectorId] = useState<string>()
  // A new catalog key opens the catalog afresh: scrolled to the top, no search, no filter.
  const [catalogEpoch, setCatalogEpoch] = useState(0)
  const firstRun = useRef(true)
  const pendingTarget = useUIStore(state => state.pendingMarketTarget)
  const pendingStar = useStarStore(state => state.pendingStarSection)
  // The STAR account menu and the composer's 管理插件 open this page at STAR
  // 首推, the top of the 插件 section. A page opened for it is there already;
  // one that was open gets a fresh catalog, so a search or a scroll position
  // left in it cannot hide that part.
  useEffect(() => {
    const opening = firstRun.current
    firstRun.current = false
    if (!pendingStar || !useStarStore.getState().consumeStarSection()) return
    setSection('plugins')
    setManaging(false)
    if (!opening) setCatalogEpoch(value => value + 1)
  }, [pendingStar])
  // The composer's + menu opens the market at a section, or straight at one
  // connector's detail. Consumed once, so reopening the tab later starts fresh.
  useEffect(() => {
    if (!pendingTarget) return
    setSection(pendingTarget.section)
    setManaging(false)
    setFocusConnectorId(pendingTarget.connectorId)
    useUIStore.getState().setPendingMarketTarget(null)
  }, [pendingTarget])
  const myLabel = t(section === 'plugins' ? 'extensions.myPlugins' : 'extensions.mySkills')
  const description = section === 'plugins'
    ? t('extensions.pluginsSubtitle')
    : t(managing ? 'settings.skills.description' : 'market.subtitle')
  return <section className="flex h-full min-h-0 flex-col bg-[var(--color-surface)]">
    {/* The only page head on this surface: the market and the installed lists
        below render straight into the column, without a title of their own. */}
    <header className="shrink-0 border-b border-[var(--color-border)]">
      <div className={cx(EXTENSION_PAGE_COLUMN, 'flex flex-wrap items-end gap-x-6 gap-y-3 pb-4 pt-7')}>
        <div className="min-w-0 flex-1">
          <h1 className="text-[22px] font-semibold leading-[30px] text-[var(--color-text-primary)]">{managing ? myLabel : t('sidebar.extensions')}</h1>
          <p className="mt-1.5 text-[13px] leading-5 text-[var(--color-text-tertiary)]">{description}</p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <SegmentedControl label={t('extensions.sections')} value={section} onChange={setSection} items={[{ value: 'plugins', label: t('extensions.plugins') }, { value: 'skills', label: t('extensions.skills') }]} />
          {/* MCP servers are managed in Settings; the 插件 section links there
              rather than keeping a second editor for the same config. */}
          {section === 'plugins' ? (
            <Button size="base" variant="ghost" icon={<Server size={14} strokeWidth={1.75} aria-hidden="true" />} onClick={() => openSettings('mcp')}>
              {t('settings.tab.mcp')}
            </Button>
          ) : null}
          <Button size="base" variant="secondary" icon={managing ? <ArrowLeft size={14} strokeWidth={1.75} aria-hidden="true" /> : <PackageCheck size={14} strokeWidth={1.75} aria-hidden="true" />} onClick={() => setManaging(value => !value)}>
            {managing ? t('extensions.browse') : myLabel}
          </Button>
        </div>
      </div>
    </header>
    <div className="flex min-h-0 flex-1 flex-col">
      {/* The connectors' own curated skill packages stay withdrawn (their
          catalog, lock file and installer remain in src/services/connectors);
          the skills section leads with STAR's curated skills instead. */}
      {managing
        ? section === 'plugins' ? <Connectors key="installed" management /> : <InstalledSkills />
        : section === 'plugins'
          ? <Connectors key={`catalog-${catalogEpoch}`} mode="plugins" featured={starPart} focusConnectorId={focusConnectorId} onFocusHandled={() => setFocusConnectorId(undefined)} />
          : <Market featured={<StarSkillsShelf />} />}
    </div>
  </section>
}
