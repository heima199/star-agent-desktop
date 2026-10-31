import { useMemo } from 'react'
import { create } from 'zustand'
import { formatStarBrand, normalizeStarBrandName, STAR_BRAND_DEFAULT, starBrandParams } from '../lib/starBrand'

/**
 * The product name the STAR console sets, as the local server reports it in
 * `StarStatus.brandName` (starStore feeds it on every status answer). The
 * i18n `translate()` reads it for `{brand}`, `{brandAgent}` and `{brandCode}`;
 * STAR until the first status arrives. Memory only: the server keeps the cache.
 */
type StarBrandState = {
  name: string
  setName: (raw: unknown) => void
}

export const useStarBrandStore = create<StarBrandState>((set, get) => ({
  name: STAR_BRAND_DEFAULT,
  setName: (raw) => {
    const name = normalizeStarBrandName(raw)
    if (name !== get().name) set({ name })
  },
}))

export function getStarBrandName(): string {
  return useStarBrandStore.getState().name
}

export type StarBrand = {
  /** X */
  name: string
  /** X Agent */
  agent: string
  /** X Code */
  code: string
  /** Fill `{brand}`, `{brandAgent}`, `{brandCode}` in a text. */
  format: (text: string) => string
}

/** The console's product name for literal texts (components/star, pages/star); re-renders when it changes. */
export function useStarBrand(): StarBrand {
  const name = useStarBrandStore((s) => s.name)
  return useMemo(() => {
    const params = starBrandParams(name)
    return { name: params.brand, agent: params.brandAgent, code: params.brandCode, format: (text: string) => formatStarBrand(text, name) }
  }, [name])
}
