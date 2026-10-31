import { renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const starMocks = vi.hoisted(() => ({ activate: vi.fn() }))
vi.mock('../api/star', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../api/star')>()
  return { ...actual, starApi: { ...actual.starApi, activate: starMocks.activate } }
})

import type { StarStatus } from '../api/star'
import { ModelPolicyProvider, type ModelPolicy } from '../lib/modelPolicy'
import { useProviderStore } from '../stores/providerStore'
import { useStarStore } from '../stores/starStore'
import { useStarOnlyDefaultProvider } from './useStarOnlyDefaultProvider'

function status(signedIn: boolean, starIsDefault: boolean): StarStatus {
  return {
    configured: true,
    baseUrl: 'https://star.example.test',
    signedIn,
    user: null,
    provider: { id: 'star', active: starIsDefault, relayReady: true, mainModel: 'star-main' },
    catalog: { fetchedAt: null, chatModels: 0, imageModels: 0, videoModels: 0 },
    starWorkSignInAvailable: false,
  }
}

function renderWith(policy: ModelPolicy) {
  const wrapper = ({ children }: { children: ReactNode }) => <ModelPolicyProvider value={policy}>{children}</ModelPolicyProvider>
  return renderHook(() => useStarOnlyDefaultProvider(), { wrapper })
}

describe('useStarOnlyDefaultProvider', () => {
  const fetchProviders = vi.fn(async () => {})

  beforeEach(() => {
    starMocks.activate.mockReset()
    starMocks.activate.mockResolvedValue(status(true, true))
    fetchProviders.mockClear()
    useProviderStore.setState({ fetchProviders })
  })

  afterEach(() => {
    useStarStore.setState({ status: null })
  })

  it('makes STAR the default again when a signed-in account points elsewhere', async () => {
    useStarStore.setState({ status: status(true, false) })
    renderWith('star-only')

    await waitFor(() => expect(starMocks.activate).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(useStarStore.getState().status?.provider.active).toBe(true))
    expect(fetchProviders).toHaveBeenCalled()
  })

  it('leaves the default alone when STAR already is it, or nobody is signed in', () => {
    useStarStore.setState({ status: status(true, true) })
    const { unmount } = renderWith('star-only')
    unmount()
    useStarStore.setState({ status: status(false, false) })
    renderWith('star-only')

    expect(starMocks.activate).not.toHaveBeenCalled()
  })

  it('never switches providers outside the star-only policy', () => {
    useStarStore.setState({ status: status(true, false) })
    renderWith('any')

    expect(starMocks.activate).not.toHaveBeenCalled()
  })

  it('tries once per sign-in instead of looping on a failure', async () => {
    starMocks.activate.mockRejectedValue(new Error('offline'))
    useStarStore.setState({ status: status(true, false) })
    const { rerender } = renderWith('star-only')
    await waitFor(() => expect(starMocks.activate).toHaveBeenCalledTimes(1))

    useStarStore.setState({ status: { ...status(true, false), baseUrl: 'https://star.example.test/' } })
    rerender()
    expect(starMocks.activate).toHaveBeenCalledTimes(1)
  })
})
