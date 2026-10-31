import { fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import '@testing-library/jest-dom'

vi.mock('@/pages/settings/ChatAppearanceSettings', () => ({ ChatAppearanceSettings: () => null }))

import type { StarCatalog, StarStatus } from '@/api/star'
import { useStarStore } from '@/stores/starStore'
import { StarModelsSection } from './StarSettingsSections'

const signedIn: StarStatus = {
  configured: true,
  baseUrl: 'https://star.example.test',
  signedIn: true,
  user: null,
  provider: { id: 'star', active: true, relayReady: true, mainModel: 'claude-sonnet-5-5' },
  catalog: { fetchedAt: 1, chatModels: 3, imageModels: 0, videoModels: 0 },
  starWorkSignInAvailable: false,
}

const catalog: StarCatalog = {
  fetchedAt: 1,
  brands: [{ id: 'claude', name: 'Claude' }, { id: 'deepseek', name: 'DeepSeek' }],
  chat: [
    { id: 'claude-sonnet-5-5', name: 'Claude Sonnet 5.5', brandId: 'claude', brandName: 'Claude', credits: 3, contextWindow: 200_000 },
    { id: 'claude-opus-5', name: 'Claude Opus 5', brandId: 'claude', brandName: 'Claude', credits: 9 },
    { id: 'deepseek-v4', name: 'DeepSeek V4', brandId: 'deepseek', brandName: 'DeepSeek', contextWindow: 1_000_000 },
  ],
  image: [],
  video: [],
  videoLimits: { maxReferenceImages: 0, maxReferenceVideos: 0, mediaTypes: [] },
}

// 设置 → 模型 is STAR's catalog only: no provider editor, no API key field.
describe('StarModelsSection', () => {
  afterEach(() => {
    useStarStore.setState({ status: null, catalog: null, loginOpen: false })
  })

  it('offers the STAR sign-in when signed out', () => {
    useStarStore.setState({ status: null, catalog, loginOpen: false })
    render(<StarModelsSection />)

    fireEvent.click(within(screen.getByTestId('star-models-signed-out')).getByRole('button', { name: '登录' }))
    expect(useStarStore.getState().loginOpen).toBe(true)
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
  })

  it('lists the catalog by brand with official logos, read-only', () => {
    useStarStore.setState({ status: signedIn, catalog })
    render(<StarModelsSection />)

    expect(screen.getByText('共 3 个模型，2 个品牌')).toBeInTheDocument()
    // The default is shown by name, not by id.
    expect(screen.getAllByText('Claude Sonnet 5.5').length).toBeGreaterThan(0)
    const tabs = screen.getByRole('tablist', { name: '模型品牌' })
    expect(within(tabs).getByRole('tab', { name: /Claude/ })).toHaveAttribute('aria-selected', 'true')
    expect(within(tabs).getByRole('tab', { name: /Claude/ }).querySelector('img')).toHaveAttribute('src', '/model-brands/claude-color.svg')
    expect(screen.getByText('3 积分/次 · 200K 上下文')).toBeInTheDocument()

    fireEvent.click(within(tabs).getByRole('tab', { name: /DeepSeek/ }))
    expect(screen.getByText('DeepSeek V4')).toBeInTheDocument()
    expect(screen.getByText('1M 上下文')).toBeInTheDocument()
    expect(screen.queryByText('Claude Opus 5')).not.toBeInTheDocument()

    // Nothing to type: no API key or base URL fields anywhere in the section.
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
  })
})
