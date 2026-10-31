import { Fragment, useEffect, useState, type ReactNode } from 'react'
import { brokenImageHandlers, FEED_PAGE_SIZE } from './starFeed'

/** Heights the placeholders cycle through, so a wall still loading looks like the wall it becomes. */
const PLACEHOLDER_HEIGHTS = [228, 172, 264, 200, 244, 184]

/** Columns by window width: the md and xl steps the CSS columns used. */
function columnsFor(width: number): number {
  return width >= 1280 ? 4 : width >= 768 ? 3 : 2
}

function useColumnCount(maxColumns: number): number {
  const read = () => Math.min(maxColumns, columnsFor(typeof window === 'undefined' ? 0 : window.innerWidth))
  const [count, setCount] = useState(read)
  useEffect(() => {
    const onResize = () => setCount(Math.min(maxColumns, columnsFor(window.innerWidth)))
    onResize()
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [maxColumns])
  return count
}

/** Where a card goes while its page is on the way. */
export function FeedPlaceholder({ height }: { height: number }) {
  return (
    <div
      aria-hidden="true"
      data-feed-placeholder=""
      className="w-full animate-pulse rounded-[var(--radius-lg)] bg-[var(--color-surface-container)]"
      style={{ height }}
    />
  )
}

/**
 * A card's picture. Until it has loaded it keeps a placeholder's room, so the
 * wall does not jump as pictures arrive; one that fails is reported broken and
 * leaves the feed.
 */
export function FeedCover({ url, alt = '', className = '' }: { url: string; alt?: string; className?: string }) {
  const [loaded, setLoaded] = useState(false)
  const { onError, onLoad } = brokenImageHandlers(url)
  return (
    <div className={loaded ? undefined : 'min-h-[180px] animate-pulse bg-[var(--color-surface-container)]'}>
      <img
        src={url}
        alt={alt}
        loading="lazy"
        onError={onError}
        onLoad={(event) => {
          onLoad(event)
          setLoaded(true)
        }}
        className={`block w-full ${className}`}
      />
    </div>
  )
}

/**
 * A masonry wall whose cards stay in their column: they go round-robin into
 * the columns, so the next page lands below the last one instead of the whole
 * wall reflowing the way CSS columns do. While `pending`, a page of
 * placeholder cards holds the place of what is loading.
 */
export function FeedWall<T>({ items, keyOf, render, pending, maxColumns = 4, testId }: {
  items: readonly T[]
  keyOf: (item: T) => string
  render: (item: T) => ReactNode
  pending: boolean
  maxColumns?: number
  testId?: string
}) {
  const columns = useColumnCount(maxColumns)
  const cells = [
    ...items.map(item => ({ key: keyOf(item), node: render(item) })),
    ...(pending
      ? Array.from({ length: FEED_PAGE_SIZE }, (_, index) => ({
        key: `placeholder-${index}`,
        node: <FeedPlaceholder height={PLACEHOLDER_HEIGHTS[index % PLACEHOLDER_HEIGHTS.length]!} />,
      }))
      : []),
  ]
  return (
    <div data-testid={testId} aria-busy={pending} className="flex items-start gap-4">
      {Array.from({ length: columns }, (_, lane) => (
        <div key={lane} className="flex min-w-0 flex-1 flex-col gap-4">
          {cells.filter((_, index) => index % columns === lane).map(cell => <Fragment key={cell.key}>{cell.node}</Fragment>)}
        </div>
      ))}
    </div>
  )
}
