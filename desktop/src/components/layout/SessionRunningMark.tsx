import { cx } from '@/lib/cx'

/**
 * "This session is working", on a sidebar row: a short arc with round caps
 * sweeping round a faint track, in the running colour.
 *
 * Not the shared `Spinner`: that draws a filled wedge over a 25% disc, which at
 * 12px beside a row's title reads as a smudge rather than as motion. A 2px
 * stroke on a 16px grid stays crisp at row size and keeps the outline of a
 * ring, so it is never mistaken for `SessionAttentionMark`'s exclamation glyph.
 *
 * It rotates with the global `animate-spin` (0.9s, slowed to 2.4s under reduced
 * motion — a stopped ring reads as a hung session). Decorative: the row's
 * wrapper carries the name.
 */
export function SessionRunningMark({ size = 12, className }: { size?: number; className?: string }) {
  return (
    <svg
      viewBox="0 0 16 16"
      width={size}
      height={size}
      fill="none"
      aria-hidden="true"
      focusable="false"
      className={cx('shrink-0 animate-spin', className)}
    >
      <circle cx="8" cy="8" r="6" stroke="currentColor" strokeOpacity="0.22" strokeWidth="2" />
      <path d="M8 2a6 6 0 0 1 6 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  )
}
