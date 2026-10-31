import { lazy, Suspense, type ComponentType, type LazyExoticComponent } from 'react'
import { isStarPageId, type StarPageId } from '../../components/star/starPages'
import { LoadingRow } from './pages/StarPageShell'

const PAGES: Record<StarPageId, LazyExoticComponent<ComponentType>> = {
  design: lazy(() => import('./design/DesignPage').then(m => ({ default: m.DesignPage }))),
  // openStarPage sends 插件 to the market tab; this only covers a stray page tab.
  plugins: lazy(() => import('../ExtensionMarket').then(m => ({ default: m.ExtensionMarket }))),
  ppt: lazy(() => import('./pages/PptPage').then(m => ({ default: m.PptPage }))),
  '3d': lazy(() => import('./pages/Make3DPage').then(m => ({ default: m.Make3DPage }))),
  calendar: lazy(() => import('./calendar/CalendarPage').then(m => ({ default: m.CalendarPage }))),
  inspiration: lazy(() => import('./pages/CommunityPages').then(m => ({ default: m.InspirationPage }))),
  kb: lazy(() => import('./pages/CommunityPages').then(m => ({ default: m.KnowledgePage }))),
  distribution: lazy(() => import('./pages/AccountPages').then(m => ({ default: m.DistributionPage }))),
  partner: lazy(() => import('./pages/AccountPages').then(m => ({ default: m.PartnerPage }))),
  api: lazy(() => import('./pages/AccountPages').then(m => ({ default: m.ApiAccessPage }))),
  apps: lazy(() => import('./pages/WorkspacePages').then(m => ({ default: m.AppsPage }))),
  board: lazy(() => import('./pages/WorkspacePages').then(m => ({ default: m.BoardPage }))),
  runtime: lazy(() => import('./pages/RuntimePage').then(m => ({ default: m.RuntimePage }))),
  memory: lazy(() => import('./pages/MemoryGraphPage').then(m => ({ default: m.MemoryGraphPage }))),
  files: lazy(() => import('./files/MyFilesPage').then(m => ({ default: m.MyFilesPage }))),
}

/** The 'star-page' tab: one of the STAR pages by id. */
export function StarPageHost({ pageId }: { pageId: string }) {
  if (!isStarPageId(pageId)) return null
  const Page = PAGES[pageId]
  return (
    <Suspense fallback={<LoadingRow />}>
      <Page />
    </Suspense>
  )
}
