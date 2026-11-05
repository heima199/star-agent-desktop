import { useEffect, useMemo, useState } from 'react'
import { starApi, type StarCreditEstimate, type StarCreditEstimateRequest } from '../../api/star'
import { useDebouncedValue } from '../../hooks/useDebouncedValue'

/**
 * The console's price for the job as picked now (清晰度 / 张数 / 分辨率 / 时长),
 * asked again once the picks have settled for a moment. Until the answer for
 * the current picks arrives this is null, and the caller shows its own
 * estimate by the console's rule; an answer for older picks is not shown.
 */
export function useStarCreditEstimate(request: StarCreditEstimateRequest | null): StarCreditEstimate | null {
  const key = request ? JSON.stringify(request) : ''
  const settledKey = useDebouncedValue(key, 250)
  const [answer, setAnswer] = useState<{ key: string; estimate: StarCreditEstimate } | null>(null)
  useEffect(() => {
    if (!settledKey) return
    let cancelled = false
    starApi.estimateCredits(JSON.parse(settledKey) as StarCreditEstimateRequest)
      .then(({ estimate }) => { if (!cancelled) setAnswer({ key: settledKey, estimate }) })
      .catch(() => {})
    return () => { cancelled = true }
  }, [settledKey])
  return useMemo(() => (answer && answer.key === key ? answer.estimate : null), [answer, key])
}
