import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { starApi, type StarCreditEstimateRequest } from '../../api/star'
import { useStarCreditEstimate } from './useStarCreditEstimate'

describe('useStarCreditEstimate', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('shows the console price for the current picks, and nothing stale after a pick changes', async () => {
    const estimate = vi.spyOn(starApi, 'estimateCredits').mockImplementation(async (input) => ({
      estimate: { credits: input.kind === 'image' && input.resolution === '4k' ? 12 : 3, exact: true, tier: input.kind === 'image' ? input.resolution as '1k' : undefined },
    }))
    const { result, rerender } = renderHook(({ request }: { request: StarCreditEstimateRequest | null }) => useStarCreditEstimate(request), {
      initialProps: { request: { kind: 'image', model: 'gpt-image-2.5', resolution: '1k', count: 1 } as StarCreditEstimateRequest },
    })
    await act(async () => { await vi.runAllTimersAsync() })
    expect(result.current?.credits).toBe(3)

    // Picking 4K hides the 1K price at once, then shows the 4K price.
    rerender({ request: { kind: 'image', model: 'gpt-image-2.5', resolution: '4k', count: 1 } })
    expect(result.current).toBeNull()
    await act(async () => { await vi.runAllTimersAsync() })
    expect(result.current?.credits).toBe(12)
    expect(estimate).toHaveBeenCalledTimes(2)
  })

  it('asks nothing without a request', async () => {
    const estimate = vi.spyOn(starApi, 'estimateCredits')
    const { result } = renderHook(() => useStarCreditEstimate(null))
    await act(async () => { await vi.runAllTimersAsync() })
    expect(result.current).toBeNull()
    expect(estimate).not.toHaveBeenCalled()
  })
})
