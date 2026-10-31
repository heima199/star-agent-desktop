import { getDesktopHost } from '../../lib/desktopHost'
import { MARKET_TAB_ID, STAR_PAGE_TAB_PREFIX, useTabStore } from '../../stores/tabStore'

/** STAR pages opened as memory-only tabs (see StarPageHost). */
export type StarPageId =
  | 'design'
  | 'plugins'
  | 'ppt'
  | '3d'
  | 'calendar'
  | 'inspiration'
  | 'kb'
  | 'distribution'
  | 'partner'
  | 'api'
  | 'apps'
  | 'board'
  | 'runtime'
  | 'memory'
  | 'files'

export const STAR_PAGE_TITLES: Record<StarPageId, string> = {
  design: 'Design',
  plugins: '插件',
  ppt: 'PPT',
  '3d': '3D Make',
  calendar: '日历',
  inspiration: '灵感社区',
  kb: '知识库',
  distribution: '分销中心',
  // Sections of the merged pages keep their ids (and links to them) but share
  // the merged page's name in the tab bar.
  partner: '分销中心',
  api: 'API 接入',
  apps: '应用',
  board: '看板',
  runtime: '记忆图谱',
  memory: '记忆图谱',
  files: '我的文件',
}

export function isStarPageId(value: string): value is StarPageId {
  return value in STAR_PAGE_TITLES
}

/**
 * Pages kept in the code but offered nowhere: no sidebar entry, starter chip,
 * app or plugin card leads to them, they do not open, and a tab of one still
 * open from before is closed.
 */
const HIDDEN_STAR_PAGES: ReadonlySet<StarPageId> = new Set<StarPageId>(['ppt', '3d'])

export function isStarPageHidden(id: StarPageId): boolean {
  return HIDDEN_STAR_PAGES.has(id)
}

/** Closes the tabs of hidden pages, as left open by an earlier build. */
export function closeHiddenStarPageTabs(): void {
  const tabs = useTabStore.getState()
  for (const id of HIDDEN_STAR_PAGES) {
    const tabId = starPageTabId(id)
    if (tabs.tabs.some(tab => tab.sessionId === tabId)) tabs.closeTab(tabId)
  }
}

export function starPageTabId(id: StarPageId): string {
  return `${STAR_PAGE_TAB_PREFIX}${id}`
}

const pendingParams = new Map<StarPageId, Record<string, string>>()

/** Opens (or focuses) a STAR page; `params` are read once by the page on mount. */
export function openStarPage(id: StarPageId, params?: Record<string, string>): void {
  if (isStarPageHidden(id)) return
  // 插件 merged into the extension market (插件, headed by STAR 首推 / 技能): one tab.
  if (id === 'plugins') {
    useTabStore.getState().openTab(MARKET_TAB_ID, STAR_PAGE_TITLES.plugins, 'market')
    return
  }
  if (params) pendingParams.set(id, params)
  else pendingParams.delete(id)
  useTabStore.getState().openTab(starPageTabId(id), STAR_PAGE_TITLES[id], 'star-page')
  if (params && typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('star:page-params', { detail: { id } }))
  }
}

export function takeStarPageParams(id: StarPageId): Record<string, string> | null {
  const params = pendingParams.get(id) ?? null
  pendingParams.delete(id)
  return params
}

export function openExternal(url: string): void {
  if (!/^https?:\/\//i.test(url)) return
  getDesktopHost().shell.open(url).catch(() => {
    window.open(url, '_blank', 'noopener')
  })
}
