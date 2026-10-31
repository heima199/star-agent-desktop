import { useEffect, useState, type ComponentType, type ReactNode } from 'react'
import {
  Blocks,
  Briefcase,
  CalendarClock,
  CalendarDays,
  ChevronDown,
  ChevronUp,
  Code2,
  FolderOpen,
  Globe,
  Images,
  Kanban,
  KeyRound,
  Library,
  Lightbulb,
  Orbit,
  Plus,
  Puzzle,
  Share2,
  Wand2,
  type LucideIcon,
} from 'lucide-react'
import { MARKET_TAB_ID, SCHEDULED_TAB_ID, CONNECTORS_TAB_ID, useTabStore } from '../../stores/tabStore'
import { useStarBrand } from '../../stores/starBrandStore'
import { isStarTaskActive, useStarStore } from '../../stores/starStore'
import { STAR_LIBRARY_TAB_ID, STAR_STUDIO_TAB_ID, starStudioTabTitle } from './starTabs'
import { closeHiddenStarPageTabs, openExternal, openStarPage, starPageTabId, type StarPageId } from './starPages'

type NavItemProps = {
  active: boolean
  collapsed: boolean
  label: string
  onClick: () => void
  icon: ReactNode
  shortcut?: string
  children: ReactNode
}

type Entry = {
  key: string
  label: string
  icon: LucideIcon
  tabId?: string
  run: () => void
  badge?: ReactNode
  shortcut?: string
}

const ICON_STROKE = 1.75
const openTab = (id: string, title: string, type: 'star-studio' | 'star-library' | 'scheduled' | 'market') => () => useTabStore.getState().openTab(id, title, type)
const page = (id: StarPageId): Pick<Entry, 'tabId' | 'run'> => ({ tabId: starPageTabId(id), run: () => openStarPage(id) })
const AD_ICONS: Record<string, LucideIcon> = { code: Code2, briefcase: Briefcase, globe: Globe }

/**
 * The mode-specific part of the sidebar (Work / Code / Design), with
 * 更多 and the operator's 推荐 entries below it.
 */
export function StarSidebarNav({ Item, collapsed, activeTabId, onNewSession, modKey, newSessionLabel, newTaskLabel, extensionsLabel, scheduledLabel }: {
  Item: ComponentType<NavItemProps>
  collapsed: boolean
  activeTabId: string | null
  onNewSession: () => void
  modKey: string
  /** Work mode names the item a task (Kimi Work style); the other modes keep the session wording. */
  newSessionLabel: string
  newTaskLabel: string
  extensionsLabel: string
  scheduledLabel: string
}) {
  const mode = useStarStore(s => s.mode)
  const running = useStarStore(s => s.tasks.filter(isStarTaskActive).length)
  const config = useStarStore(s => s.desktopConfig)
  const brand = useStarBrand()
  const [moreOpen, setMoreOpen] = useState(false)
  useEffect(() => {
    void useStarStore.getState().loadDesktopConfig()
    // The sidebar is where pages are offered, so it also retires hidden ones.
    closeHiddenStarPageTabs()
  }, [])

  const studioBadge = running > 0 ? <span className="rounded-full bg-[var(--color-brand)] px-1.5 text-[11px] font-semibold leading-4 text-[var(--color-on-primary)]">{running}</span> : undefined
  const entries: Record<string, Entry> = {
    newTask: { key: 'newTask', label: mode === 'work' ? newTaskLabel : newSessionLabel, icon: Plus, run: onNewSession, shortcut: `${modKey}N` },
    newDesign: { key: 'newDesign', label: '新建设计', icon: Plus, ...page('design') },
    board: { key: 'board', label: '看板', icon: Kanban, ...page('board') },
    // One 插件 page in every mode: STAR 首推, the connector catalog and skills.
    plugins: { key: 'plugins', label: extensionsLabel, icon: Puzzle, tabId: MARKET_TAB_ID, run: openTab(MARKET_TAB_ID, extensionsLabel, 'market') },
    scheduled: { key: 'scheduled', label: scheduledLabel, icon: CalendarClock, tabId: SCHEDULED_TAB_ID, run: openTab(SCHEDULED_TAB_ID, scheduledLabel, 'scheduled') },
    calendar: { key: 'calendar', label: '日历', icon: CalendarDays, ...page('calendar') },
    // 我的文件: what conversations produced (images, videos, pages, documents).
    files: { key: 'files', label: '我的文件', icon: FolderOpen, ...page('files') },
    studio: { key: 'studio', label: '图片与视频', icon: Wand2, tabId: STAR_STUDIO_TAB_ID, run: openTab(STAR_STUDIO_TAB_ID, starStudioTabTitle(brand.name), 'star-studio'), badge: studioBadge },
    library: { key: 'library', label: '资料库', icon: Images, tabId: STAR_LIBRARY_TAB_ID, run: openTab(STAR_LIBRARY_TAB_ID, '资料库', 'star-library') },
    inspiration: { key: 'inspiration', label: '灵感社区', icon: Lightbulb, ...page('inspiration') },
    kb: { key: 'kb', label: '知识库', icon: Library, ...page('kb') },
    distribution: { key: 'distribution', label: '分销中心', icon: Share2, ...page('distribution') },
    memory: { key: 'memory', label: '记忆图谱', icon: Orbit, ...page('memory') },
  }
  // 远程控制 lives in 设置 → 设备连接 now; 应用, AI 画布 (Design covers it) and
  // 意见反馈 are not sidebar entries. 运行时 is a view of the 记忆图谱 page and
  // 开一个自己的AI站 a section of 分销中心, so each pair has one entry.
  // 项目 is no entry: a task's folder is picked under the composer. PPT and
  // 3D Make are hidden pages (see isStarPageHidden).
  const MODE_ITEMS: Record<typeof mode, string[]> = {
    work: ['newTask', 'board', 'plugins', 'scheduled', 'calendar', 'files', 'memory'],
    code: ['newTask', 'plugins', 'scheduled', 'calendar', 'files', 'memory'],
    design: ['newDesign', 'inspiration', 'studio', 'library', 'plugins', 'memory'],
  }
  const primary = MODE_ITEMS[mode].map(key => entries[key]!)
  const moreKeys = ['calendar', 'files', 'studio', 'inspiration', 'kb', 'distribution'].filter(key => !MODE_ITEMS[mode].includes(key))
  const ads: Entry[] = (config?.ads.icons ?? []).map((ad, index) => ({
    key: `ad-${index}`,
    label: ad.name,
    icon: AD_ICONS[ad.icon] ?? Blocks,
    ...(/api/i.test(ad.name) ? page('api') : { run: () => openExternal(ad.url) }),
  }))

  const render = (entry: Entry) => (
    <Item key={entry.key} active={Boolean(entry.tabId && (activeTabId === entry.tabId || (entry.tabId === MARKET_TAB_ID && activeTabId === CONNECTORS_TAB_ID)))} collapsed={collapsed} label={entry.label} onClick={entry.run}
      icon={<entry.icon size={16} strokeWidth={ICON_STROKE} aria-hidden="true" />} shortcut={entry.shortcut}>
      <span className="flex items-center gap-1.5">{entry.label}{entry.badge ?? null}</span>
    </Item>
  )

  return (
    <div className={`px-2 pb-1 flex flex-col ${collapsed ? 'items-center gap-2' : 'gap-px'}`} data-testid="star-sidebar-nav">
      {primary.map(render)}
      {!collapsed ? (
        <>
          <button type="button" onClick={() => setMoreOpen(open => !open)} className="mt-1 flex h-[26px] items-center gap-1.5 rounded-[var(--radius-sm)] px-2 text-[12px] text-[var(--color-text-tertiary)] hover:text-[var(--color-text-secondary)]">
            {moreOpen ? <ChevronUp size={13} aria-hidden="true" /> : <ChevronDown size={13} aria-hidden="true" />}{moreOpen ? '收起' : '更多'}
          </button>
          {moreOpen ? (
            <>
              {moreKeys.map(key => render(entries[key]!))}
              {ads.length ? <div className="mt-1.5 px-2 pb-0.5 text-[11px] text-[var(--color-text-tertiary)]">推荐</div> : null}
              {ads.map(render)}
              {!ads.length ? render({ key: 'api', label: 'API 接入', icon: KeyRound, ...page('api') }) : null}
            </>
          ) : null}
        </>
      ) : null}
    </div>
  )
}
