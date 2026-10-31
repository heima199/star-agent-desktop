import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { starApi, starErrorText, type StarPlazaItem, type StarPlazaPage } from '@/api/star'

/** Image feeds (灵感, 灵感社区) load this many items per step; scrolling down loads the next step. */
export const FEED_PAGE_SIZE = 12

/** Pictures checked in the background ahead of the ones on screen: the next step's. */
const PREFLIGHT_AHEAD = FEED_PAGE_SIZE

const SCROLL_KEYS = new Set(['PageDown', 'End', 'ArrowDown', ' '])

/**
 * Calls `onLoadMore` when the user scrolls down to the returned sentinel,
 * while `enabled` (more to load, nothing loading). Attach the ref to an
 * element after the last item.
 *
 * The sentinel being on screen is not enough: lazy pictures have no height
 * until they load, so a masonry wall keeps sliding its end back into view on
 * its own and would fetch the whole feed. A load needs the user to scroll
 * down (wheel, touch, or a scrolling key) while the end is in view, one page
 * per gesture. A wheel turned down counts even when the list is too short to
 * scroll, so a short list needs no button.
 */
export function useInfiniteScroll(enabled: boolean, onLoadMore: () => void): (node: HTMLElement | null) => void {
  const [node, setNode] = useState<HTMLElement | null>(null)
  const load = useRef(onLoadMore)
  load.current = onLoadMore
  const armed = useRef(enabled)
  armed.current = enabled
  useEffect(() => {
    if (!node || typeof IntersectionObserver === 'undefined') return
    let visible = false
    let intent = false
    const fire = () => {
      if (!visible || !intent || !armed.current) return
      intent = false
      load.current()
    }
    const observer = new IntersectionObserver((entries) => {
      visible = entries.some(entry => entry.isIntersecting)
      fire()
    }, { rootMargin: '0px 0px 240px 0px' })
    observer.observe(node)
    const scrolled = () => {
      intent = true
      fire()
    }
    const onWheel = (event: WheelEvent) => { if (event.deltaY > 0) scrolled() }
    const onKey = (event: KeyboardEvent) => { if (SCROLL_KEYS.has(event.key)) scrolled() }
    window.addEventListener('wheel', onWheel, { capture: true, passive: true })
    window.addEventListener('touchmove', scrolled, { capture: true, passive: true })
    window.addEventListener('keydown', onKey, true)
    return () => {
      observer.disconnect()
      window.removeEventListener('wheel', onWheel, true)
      window.removeEventListener('touchmove', scrolled, true)
      window.removeEventListener('keydown', onKey, true)
    }
  }, [node])
  return setNode
}

// Image URLs that failed to load (expired signed links, deleted files). Kept for
// the session, so a broken picture never comes back after a re-render.
const broken = new Set<string>()
const listeners = new Set<() => void>()
let version = 0

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/** A picture URL the wall can ask for at all: an empty or relative one shows nothing. */
export function isUsableImageUrl(url: string | null | undefined): url is string {
  return typeof url === 'string' && /^(https?:\/\/[^\s/]+|data:image\/|blob:)/i.test(url.trim())
}

export function markImageBroken(url: string): void {
  if (!url || broken.has(url)) return
  broken.add(url)
  version++
  for (const listener of listeners) listener()
}

export function isImageBroken(url: string): boolean {
  return broken.has(url)
}

/** Re-renders when an image breaks; filter feed items with `isBroken`. `version` changes with each break. */
export function useBrokenImages(): { isBroken: (url: string) => boolean; markBroken: (url: string) => void; version: number } {
  const current = useSyncExternalStore(subscribe, () => version, () => version)
  return { isBroken: isImageBroken, markBroken: markImageBroken, version: current }
}

/** `onError` / `onLoad` handlers that report a picture which did not load (or decoded to nothing). */
export function brokenImageHandlers(url: string) {
  return {
    onError: () => markImageBroken(url),
    onLoad: (event: { currentTarget: HTMLImageElement }) => {
      if (!event.currentTarget.naturalWidth) markImageBroken(url)
    },
  }
}

const preflighted = new Set<string>()

/**
 * Asks for a picture before it is shown. One that fails leaves the feed before
 * anyone sees the gap; one that loads is in the cache by the time it is shown.
 */
function preflight(url: string): void {
  if (preflighted.has(url) || broken.has(url) || typeof Image === 'undefined') return
  preflighted.add(url)
  const probe = new Image()
  probe.decoding = 'async'
  probe.onload = () => { if (!probe.naturalWidth) markImageBroken(url) }
  probe.onerror = () => markImageBroken(url)
  probe.src = url
}

/** Checks the pictures of `urls` (the next ones in line) in the background. */
export function usePreflightImages(urls: readonly string[]): void {
  const key = urls.join('\n')
  useEffect(() => {
    for (const url of key ? key.split('\n') : []) if (isUsableImageUrl(url)) preflight(url)
  }, [key])
}

/** A list revealed `FEED_PAGE_SIZE` items at a time (for sources loaded in one go). */
export function useRevealed<T>(items: readonly T[], resetKey: string): { shown: T[]; hasMore: boolean; more: () => void } {
  const [count, setCount] = useState(FEED_PAGE_SIZE)
  useEffect(() => setCount(FEED_PAGE_SIZE), [resetKey])
  const more = useCallback(() => setCount(value => value + FEED_PAGE_SIZE), [])
  return { shown: items.slice(0, count), hasMore: count < items.length, more }
}

/**
 * 灵感社区 (plaza) as a feed: `FEED_PAGE_SIZE` works per step, the next step on
 * `more()`. Works whose picture fails leave the feed and the next ones move up,
 * fetching the next page when the ones received run out, so a broken stretch of
 * the list never shows as an empty wall: the STAR list once opened with 47 works
 * whose pictures were missing or answered 404. A page that comes back short
 * ends the feed, so a server that miscounts `total` cannot keep it loading.
 *
 * `requireCover` keeps only works with a picture (the 灵感 wall of Design);
 * `requirePrompt` only those that can be made again (做同款).
 */
export function usePlazaFeed(query: { category?: string; subcategory?: string; requireCover?: boolean; requirePrompt?: boolean }) {
  const category = query.category || undefined
  const subcategory = query.subcategory || undefined
  const { requireCover = false, requirePrompt = false } = query
  const { version: brokenVersion } = useBrokenImages()
  // Everything received so far; the first `wanted` usable works are on screen.
  // A service that ignores `pageSize` sends the whole list at once, and it
  // still comes out one step at a time.
  const [received, setReceived] = useState<StarPlazaItem[]>([])
  const [wanted, setWanted] = useState(FEED_PAGE_SIZE)
  const [categories, setCategories] = useState<StarPlazaPage['categories']>([])
  const [page, setPage] = useState(0)
  const [ended, setEnded] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const request = useRef(0)
  const loaded = useRef<StarPlazaItem[]>([])

  const load = useCallback((nextPage: number) => {
    const id = ++request.current
    setLoading(true)
    starApi.plaza({ category, subcategory, page: nextPage, pageSize: FEED_PAGE_SIZE })
      .then((result) => {
        if (id !== request.current) return
        const base = nextPage === 1 ? [] : loaded.current
        const seen = new Set(base.map(item => item.id))
        const next = [...base, ...result.items.filter(item => !seen.has(item.id))]
        loaded.current = next
        setReceived(next)
        setCategories(result.categories)
        setPage(nextPage)
        setEnded(result.items.length < FEED_PAGE_SIZE || next.length >= result.total)
        setError(null)
      })
      .catch((failure) => {
        if (id !== request.current) return
        setError(starErrorText(failure))
        setEnded(true)
      })
      .finally(() => { if (id === request.current) setLoading(false) })
  }, [category, subcategory])

  useEffect(() => {
    setEnded(false)
    setWanted(FEED_PAGE_SIZE)
    load(1)
  }, [load])

  const usable = useMemo(() => received.filter(item => {
    if (requirePrompt && !item.prompt) return false
    if (!item.coverUrl) return !requireCover
    return isUsableImageUrl(item.coverUrl) && !isImageBroken(item.coverUrl)
    // `brokenVersion` moves with each picture that breaks.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [received, requireCover, requirePrompt, brokenVersion])

  // Holes left by broken pictures are filled from the next page.
  useEffect(() => {
    if (page > 0 && !loading && !ended && usable.length < wanted) load(page + 1)
  }, [ended, load, loading, page, usable.length, wanted])

  // The works next in line are checked while the ones on screen are looked at.
  usePreflightImages(usable.slice(0, wanted + PREFLIGHT_AHEAD).flatMap(item => (item.coverUrl ? [item.coverUrl] : [])))

  const hasMore = page > 0 && (usable.length > wanted || !ended)
  const more = useCallback(() => {
    if (loading || !hasMore) return
    setWanted(value => value + FEED_PAGE_SIZE)
  }, [hasMore, loading])
  const items = useMemo(() => usable.slice(0, wanted), [usable, wanted])
  return { items, categories, loading, error, hasMore, loadedPages: page, more, retry: () => load(1) }
}
