import starGlassBlackRotating from '@/assets/brand/star-glass-black.svg'
import starGlassBlack from '@/assets/brand/star-glass-black-still.svg'
import starGlassWhiteRotating from '@/assets/brand/star-glass-white.svg'
import starGlassWhite from '@/assets/brand/star-glass-white-still.svg'
import { cx } from '@/lib/cx'

/**
 * The STAR mark: the glass four-point star, in two inks so it reads on every
 * ground: black on the four paper themes, white on the dark one (the `dark:`
 * variant, see globals.css). CSS picks the ink, so a theme switch needs no
 * re-render. `animated` shows the rotating star (one turn in 12 s, animated
 * inside the SVG itself) and its still first frame under reduced motion.
 */
export type BrandSealSize = 'xs' | 'sm' | 'md' | 'lg' | 'xl' | '2xl'

const SIZES: Record<BrandSealSize, string> = {
  // The live turn line in the transcript (StreamingIndicator).
  xs: 'h-5 w-5',
  sm: 'h-6 w-6',
  md: 'h-8 w-8',
  lg: 'h-[38px] w-[38px]',
  xl: 'h-14 w-14',
  // The home page's mark. Its column clips at the top when the window is
  // short, so below 680px of height it drops to 56px and still fits.
  '2xl': 'h-20 w-20 [@media(max-height:680px)]:h-14 [@media(max-height:680px)]:w-14',
}

/** The still mark for light grounds and for dark ones. */
export const BRAND_LOGO_SRC = { light: starGlassBlack, dark: starGlassWhite } as const
/** The rotating mark, in the same two inks. */
export const BRAND_LOGO_ROTATING_SRC = { light: starGlassBlackRotating, dark: starGlassWhiteRotating } as const

const REDUCED_MOTION = '(prefers-reduced-motion: reduce)'

export type BrandSealProps = {
  size?: BrandSealSize
  /** The rotating star; the still one when the system asks for reduced motion. */
  animated?: boolean
  className?: string
}

function BrandSealInk({ ink, animated, className }: { ink: 'light' | 'dark'; animated: boolean; className: string }) {
  const image = (
    <img
      src={(animated ? BRAND_LOGO_ROTATING_SRC : BRAND_LOGO_SRC)[ink]}
      alt=""
      draggable={false}
      className={cx('h-full w-full object-contain', className)}
    />
  )
  if (!animated) return image
  // The browser picks the source, and picks again when the motion setting changes.
  return (
    <picture className="contents">
      <source media={REDUCED_MOTION} srcSet={BRAND_LOGO_SRC[ink]} />
      {image}
    </picture>
  )
}

export function BrandSeal({ size = 'md', animated = false, className }: BrandSealProps) {
  return (
    // Decorative: the product name sits next to the mark in the sidebar and
    // under it on the empty state, so announcing the brand twice is noise.
    <span
      aria-hidden="true"
      data-testid="brand-seal"
      className={cx('inline-flex flex-shrink-0 select-none', SIZES[size], className)}
    >
      <BrandSealInk ink="light" animated={animated} className="dark:hidden" />
      <BrandSealInk ink="dark" animated={animated} className="hidden dark:block" />
    </span>
  )
}
