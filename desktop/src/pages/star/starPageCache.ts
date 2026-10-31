import { useStarStore } from '@/stores/starStore'
import type { StarStatus } from '@/api/star'

/**
 * What each STAR page loader (`useLoad`) last returned, by key. A page whose tab
 * is opened again shows it at once and refreshes behind it, instead of starting
 * from a spinner every time: STAR pages unmount when their tab is left.
 *
 * Bounded, and dropped whenever the signed-in account changes, because some
 * keys hold account data (distribution, API keys). A load that started under
 * the previous account cannot write into the new one's cache: writes carry the
 * generation they began in.
 */
const entries = new Map<string, unknown>()
const LIMIT = 40
let generation = 0

function accountIdentity(status: StarStatus | null): string {
  if (!status) return 'unknown'
  if (!status.signedIn) return 'signed-out'
  const user = status.user
  return `signed-in:${user?.id ?? user?.phone ?? user?.email ?? ''}`
}

let identity = accountIdentity(useStarStore.getState().status)
useStarStore.subscribe((state) => {
  const next = accountIdentity(state.status)
  if (next === identity) return
  identity = next
  clearPageCache()
})

export function pageCacheGeneration(): number {
  return generation
}

export function readPageCache<T>(key: string): T | undefined {
  return entries.get(key) as T | undefined
}

export function writePageCache(key: string, data: unknown, startedIn: number = generation): void {
  if (startedIn !== generation) return
  entries.delete(key)
  entries.set(key, data)
  while (entries.size > LIMIT) entries.delete(entries.keys().next().value as string)
}

export function clearPageCache(): void {
  entries.clear()
  generation += 1
}
