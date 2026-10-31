import { render } from '@testing-library/react'
import '@testing-library/jest-dom'
import { describe, expect, it } from 'vitest'
import { BRAND_LOGO_ROTATING_SRC, BRAND_LOGO_SRC, BrandSeal } from './BrandSeal'

const SIZES = { xs: 'h-5', sm: 'h-6', md: 'h-8', lg: 'h-[38px]', xl: 'h-14', '2xl': 'h-20' } as const

describe('BrandSeal', () => {
  it('is decorative and hidden from assistive tech', () => {
    // The product name always sits beside the mark (sidebar) or under it
    // (empty state); announcing the brand again reads it twice.
    const { container } = render(<BrandSeal />)
    const mark = container.firstElementChild!
    expect(mark).toHaveAttribute('aria-hidden', 'true')
    const images = Array.from(mark.querySelectorAll('img'))
    expect(images).toHaveLength(2)
    for (const image of images) expect(image).toHaveAttribute('alt', '')
  })

  // logo需替换掉，用桌面的白色.svg和黑色.svg适配做我们的logo: the glass star,
  // black on the paper themes and white on the dark one.
  it('shows the glass star in the ink of the theme at every size', () => {
    expect(BRAND_LOGO_SRC.light).toMatch(/star-glass-black-still\.svg$/)
    expect(BRAND_LOGO_SRC.dark).toMatch(/star-glass-white-still\.svg$/)
    for (const [size, height] of Object.entries(SIZES)) {
      const { container, unmount } = render(<BrandSeal size={size as keyof typeof SIZES} />)
      const mark = container.firstElementChild!
      expect(mark, size).toHaveClass(height)
      const [black, white, ...rest] = Array.from(mark.querySelectorAll('img'))
      expect(rest, size).toHaveLength(0)
      expect(black, size).toHaveAttribute('src', BRAND_LOGO_SRC.light)
      expect(white, size).toHaveAttribute('src', BRAND_LOGO_SRC.dark)
      // `dark:` is bound to the dark grounds (globals.css), so exactly one ink
      // is displayed in any theme.
      expect(black, size).toHaveClass('object-contain', 'dark:hidden')
      expect(black, size).not.toHaveClass('hidden')
      expect(white, size).toHaveClass('object-contain', 'hidden', 'dark:block')
      expect(mark.querySelector('picture'), size).toBeNull()
      unmount()
    }
  })

  // 这里logo需放大，要那个动态svg: the sidebar and the home page show the
  // rotating star; under reduced motion the browser takes the still frame.
  it('rotates when animated, and stands still under reduced motion', () => {
    expect(BRAND_LOGO_ROTATING_SRC.light).toMatch(/star-glass-black\.svg$/)
    expect(BRAND_LOGO_ROTATING_SRC.dark).toMatch(/star-glass-white\.svg$/)
    const { container } = render(<BrandSeal size="2xl" animated />)
    const mark = container.firstElementChild!
    expect(mark).toHaveClass('h-20', 'w-20')
    // The home page clips its hero at the top in a short window (the desktop
    // window can be 640px tall): there the mark drops to 56px and still fits.
    expect(mark).toHaveClass('[@media(max-height:680px)]:h-14', '[@media(max-height:680px)]:w-14')
    const pictures = Array.from(mark.querySelectorAll('picture'))
    expect(pictures).toHaveLength(2)
    const inks = [
      { rotating: BRAND_LOGO_ROTATING_SRC.light, still: BRAND_LOGO_SRC.light, shown: 'dark:hidden' },
      { rotating: BRAND_LOGO_ROTATING_SRC.dark, still: BRAND_LOGO_SRC.dark, shown: 'dark:block' },
    ]
    pictures.forEach((picture, index) => {
      const ink = inks[index]!
      // display: contents, so the image is still the flex item that fills the mark.
      expect(picture).toHaveClass('contents')
      const source = picture.querySelector('source')!
      expect(source).toHaveAttribute('media', '(prefers-reduced-motion: reduce)')
      expect(source).toHaveAttribute('srcset', ink.still)
      const image = picture.querySelector('img')!
      expect(image).toHaveAttribute('src', ink.rotating)
      expect(image).toHaveClass('h-full', 'w-full', 'object-contain', ink.shown)
    })
  })

  it('cannot be dragged out of the chrome', () => {
    const { container } = render(<BrandSeal size="sm" className="ml-1" />)
    const mark = container.firstElementChild!
    expect(mark).toHaveClass('ml-1')
    const images = Array.from(mark.querySelectorAll('img'))
    expect(images).toHaveLength(2)
    for (const image of images) expect(image).toHaveAttribute('draggable', 'false')
  })
})
