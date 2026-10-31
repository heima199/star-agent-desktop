import { useEffect, useRef } from 'react'
import { starApi } from '../api/star'
import { useModelPolicy } from '../lib/modelPolicy'
import { useProviderStore } from '../stores/providerStore'
import { useStarStore } from '../stores/starStore'

/**
 * Under the `star-only` policy a signed-in STAR account is the default model
 * service. When the default points anywhere else (a provider saved before the
 * policy, an official login), STAR is made the default again, once per sign-in,
 * so sessions that pick no model explicitly run on the STAR catalog too.
 */
export function useStarOnlyDefaultProvider(): void {
  const policy = useModelPolicy()
  const signedIn = useStarStore(s => Boolean(s.status?.signedIn))
  const starIsDefault = useStarStore(s => s.status?.provider.active ?? null)
  const attempted = useRef(false)

  useEffect(() => {
    if (!signedIn) {
      attempted.current = false
      return
    }
    if (policy !== 'star-only' || starIsDefault !== false || attempted.current) return
    attempted.current = true
    void starApi.activate()
      .then((status) => {
        useStarStore.setState({ status })
        void useProviderStore.getState().fetchProviders()
      })
      .catch(() => undefined)
  }, [policy, signedIn, starIsDefault])
}
