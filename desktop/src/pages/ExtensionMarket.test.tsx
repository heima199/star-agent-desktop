import { act, fireEvent, render, screen, within } from '@testing-library/react'
import '@testing-library/jest-dom'
import { beforeEach, it, expect, vi } from 'vitest'
import { ExtensionMarket } from './ExtensionMarket'
import { FEATURED, StarRecommend, starRecommendMatches } from '@/pages/star/market/StarRecommend'
import { useStarStore } from '@/stores/starStore'
import { useUIStore } from '@/stores/uiStore'
const apis = vi.hoisted(() => ({ connectorsList: vi.fn(), installedSkills: vi.fn(), catalogMounts: 0 }))
vi.mock('@/api/connectors', () => ({ connectorsApi: { list: apis.connectorsList } }))
vi.mock('@/api/star', () => ({ starApi: { installedSkills: apis.installedSkills }, starErrorText: (error: unknown) => String(error) }))
// The real search matcher, stand-in panels: they load plugin state and test runs from the desktop server.
vi.mock('@/pages/star/StarPluginsPanel', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/pages/star/StarPluginsPanel')>(),
  StarPluginsPanel: ({ query }: { query?: string }) => <div data-testid="star-plugins-panel" data-query={query} />,
  StarCapabilityTest: () => <div data-testid="star-capability-test" />,
}))
vi.mock('@/i18n', () => ({ useTranslation: () => (key: string) => key }))
beforeEach(() => {
  apis.connectorsList.mockResolvedValue({ items: [] })
  apis.installedSkills.mockResolvedValue({ skills: [] })
})
vi.mock('@/pages/Connectors', async () => {
  const { useState } = await import('react')
  return {
    Connectors: ({ mode, embedded, externalQuery, installedFilter, management, focusConnectorId, featured }: { mode?: string, management?: boolean, embedded?: boolean, externalQuery?: string, installedFilter?: string, focusConnectorId?: string, featured?: (query: string) => React.ReactNode }) => {
      // Numbered per mount, so a test can tell a fresh catalog from a re-render.
      const [mount] = useState(() => ++apis.catalogMounts)
      return <div data-testid={`catalog-${mode || "plugins"}`} data-mount={mount} data-management={management} data-embedded={embedded} data-query={externalQuery} data-filter={installedFilter} data-focus={focusConnectorId}>{featured?.(externalQuery ?? '')}</div>
    },
  }
})
vi.mock('@/pages/InstalledSkills', () => ({ InstalledSkills: () => <div data-testid="installed-skills" /> }))
vi.mock('@/pages/Market', () => ({ Market: ({ featured }: { featured: React.ReactNode }) => <div data-testid="existing-skill-market">{featured}</div> }))
it('defaults to plugins and shows only the skill market on the skills tab', () => {
  render(<ExtensionMarket />)
  expect(screen.getByRole('heading', { name: 'sidebar.extensions' })).toBeInTheDocument()
  expect(screen.getByTestId('catalog-plugins')).toBeInTheDocument()
  expect(screen.queryByTestId('existing-skill-market')).not.toBeInTheDocument()
  fireEvent.click(screen.getByRole('radio', { name: 'extensions.skills' }))
  expect(screen.getByTestId('existing-skill-market')).toBeInTheDocument()
  // Curated skill packages are withdrawn from the market for now: the skills
  // tab must not mount the connector catalog again.
  expect(screen.queryByTestId('catalog-skills')).not.toBeInTheDocument()
  expect(screen.queryByTestId('catalog-plugins')).not.toBeInTheDocument()
  fireEvent.click(screen.getByRole('radio', { name: 'extensions.plugins' }))
  expect(screen.getByTestId('catalog-plugins')).toBeInTheDocument()
})

it('opens installed management from the current section without adding another navigation row', () => {
  render(<ExtensionMarket />)
  fireEvent.click(screen.getByRole('button', { name: 'extensions.myPlugins' }))
  expect(screen.getByRole('heading', { name: 'extensions.myPlugins' })).toBeInTheDocument()
  expect(screen.getByTestId('catalog-plugins')).toHaveAttribute('data-management', 'true')
  expect(screen.getAllByRole('radiogroup')).toHaveLength(1)
  fireEvent.click(screen.getByRole('radio', { name: 'extensions.skills' }))
  expect(screen.getByTestId('installed-skills')).toBeInTheDocument()
  expect(screen.queryByTestId('existing-skill-market')).not.toBeInTheDocument()
  expect(screen.getByRole('heading', { name: 'extensions.mySkills' })).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'extensions.browse' }))
  expect(screen.getByTestId('existing-skill-market')).toBeInTheDocument()
  expect(screen.queryByTestId('installed-skills')).not.toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'extensions.mySkills' }))
  expect(screen.getByTestId('installed-skills')).toBeInTheDocument()
})

it('opens at the section and connector the composer menu asked for, once', () => {
  useUIStore.setState({ pendingMarketTarget: null })
  render(<ExtensionMarket />)
  fireEvent.click(screen.getByRole('radio', { name: 'extensions.skills' }))
  fireEvent.click(screen.getByRole('button', { name: 'extensions.mySkills' }))
  expect(screen.getByTestId('installed-skills')).toBeInTheDocument()

  // Already open in a tab: the request still lands, in the catalog view.
  act(() => useUIStore.getState().setPendingMarketTarget({ section: 'plugins', connectorId: 'github' }))
  expect(screen.getByTestId('catalog-plugins')).toHaveAttribute('data-focus', 'github')
  expect(screen.getByTestId('catalog-plugins')).not.toHaveAttribute('data-management', 'true')
  expect(useUIStore.getState().pendingMarketTarget).toBeNull()

  act(() => useUIStore.getState().setPendingMarketTarget({ section: 'skills' }))
  expect(screen.getByTestId('existing-skill-market')).toBeInTheDocument()
})

// STAR 首推 and 插件 are one section: STAR's part heads the connector catalog.
it('heads the 插件 catalog with STAR 首推: scene pictures, built-in plugins and monochrome icons', () => {
  render(<ExtensionMarket />)
  expect(screen.getAllByRole('radio').map(radio => radio.textContent)).toEqual(['extensions.plugins', 'extensions.skills'])
  const catalog = screen.getByTestId('catalog-plugins')
  expect(within(catalog).getByRole('heading', { name: 'STAR 首推' })).toBeInTheDocument()
  expect(within(catalog).getByTestId('star-plugins-panel')).toBeInTheDocument()

  // 三个大卡片都需要图片占位，不要这种绘制的.
  const images = within(catalog).getAllByTestId('featured-card-image')
  expect(images).toHaveLength(3)
  images.forEach((image, index) => {
    expect(image.tagName).toBe('IMG')
    expect(image).toHaveAttribute('src', FEATURED[index]!.image)
    // The picture box holds the image only, no drawn svg art.
    expect(image.parentElement?.querySelector('svg')).toBeNull()
  })

  // 插件的所有图标都需要白色图标.
  const icons = within(catalog).getAllByTestId('market-line-icon')
  expect(icons.length).toBeGreaterThan(10)
  for (const icon of icons) {
    expect(icon).toHaveClass('text-[var(--color-text-primary)]')
    expect(icon).not.toHaveClass('text-[var(--color-text-accent)]')
  }

  // 「STAR 首推」和「精选插件」需合并: one section, one heading, the picks
  // and the capability test inside it.
  const star = within(catalog).getByRole('region', { name: 'STAR 首推' })
  expect(within(star).getAllByRole('heading', { level: 2 })).toHaveLength(1)
  expect(within(catalog).queryByRole('heading', { name: '精选插件' })).not.toBeInTheDocument()
  const picks = within(star).getByTestId('star-picks')
  expect(star).toContainElement(within(star).getByTestId('star-capability-test'))

  // The connector cards follow below; STAR's picks do not repeat them.
  expect(within(picks).getByText('PDF')).toBeInTheDocument()
  expect(within(picks).queryByText('飞书')).not.toBeInTheDocument()
  expect(within(picks).queryByText('GitHub')).not.toBeInTheDocument()
})

it('narrows the STAR part to the search, dropping the scene cards and the category pills', () => {
  render(<StarRecommend query="视频" />)
  expect(screen.queryByTestId('featured-card-image')).not.toBeInTheDocument()
  expect(screen.getByRole('heading', { name: 'STAR 首推' })).toBeInTheDocument()
  expect(screen.getByTestId('star-plugins-panel')).toHaveAttribute('data-query', '视频')
  const picks = screen.getByTestId('star-picks')
  expect(within(picks).getByText('视频生成')).toBeInTheDocument()
  expect(within(picks).queryByText('PDF')).not.toBeInTheDocument()
  expect(screen.queryByRole('tablist')).not.toBeInTheDocument()
  // The test is for browsing: it steps aside during a search.
  expect(screen.queryByTestId('star-capability-test')).not.toBeInTheDocument()

  // Nothing of STAR's matches: the catalog shows the connectors alone.
  expect(starRecommendMatches('视频')).toBe(true)
  expect(starRecommendMatches('zz-no-such-plugin')).toBe(false)
})

it('returns to STAR 首推 with a fresh catalog when the STAR menu asks while the page is open', () => {
  useStarStore.setState({ pendingStarSection: false })
  render(<ExtensionMarket />)
  const firstMount = screen.getByTestId('catalog-plugins').getAttribute('data-mount')
  // On the catalog already: it opens afresh, so a search or a scroll left in it cannot hide STAR 首推.
  act(() => useStarStore.getState().openStarPlugins())
  expect(screen.getByTestId('catalog-plugins').getAttribute('data-mount')).not.toBe(firstMount)
  expect(useStarStore.getState().pendingStarSection).toBe(false)

  // From 我的技能 it comes back to the browsing catalog.
  fireEvent.click(screen.getByRole('radio', { name: 'extensions.skills' }))
  fireEvent.click(screen.getByRole('button', { name: 'extensions.mySkills' }))
  expect(screen.getByTestId('installed-skills')).toBeInTheDocument()
  act(() => useStarStore.getState().openStarPlugins())
  const catalog = screen.getByTestId('catalog-plugins')
  expect(catalog).not.toHaveAttribute('data-management', 'true')
  expect(within(catalog).getByRole('heading', { name: 'STAR 首推' })).toBeInTheDocument()
})

it('leads the skills section with STAR curated skills in the same untinted tiles', async () => {
  render(<ExtensionMarket />)
  fireEvent.click(screen.getByRole('radio', { name: 'extensions.skills' }))
  const shelf = screen.getByTestId('star-skills-shelf')
  expect(screen.getByTestId('existing-skill-market')).toContainElement(shelf)

  const icons = within(shelf).getAllByTestId('skill-icon')
  expect(icons.length).toBeGreaterThan(0)
  for (const icon of icons) {
    expect(icon).toHaveClass('text-[var(--color-text-primary)]')
    expect(icon.style.color).toBe('')
    expect(icon.style.background).toBe('')
  }
  await act(async () => {})
})
