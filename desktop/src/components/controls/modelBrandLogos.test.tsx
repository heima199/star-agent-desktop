import { render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import '@testing-library/jest-dom'
import { modelBrandLogo } from './modelBrandLogos'
import { BrandMark } from './StarModelPanel'

// 所有的模型都需要官方的logo图标，不要这种假占位.
describe('modelBrandLogo', () => {
  it.each([
    ['Claude', 'claude-color', false],
    ['Gemini', 'gemini-color', false],
    ['ChatGPT', 'openai', true],
    ['Grok', 'grok', true],
    ['DeepSeek', 'deepseek-color', false],
    ['智谱GLM', 'zhipu-color', false],
    ['通义千问', 'qwen-color', false],
    ['MiniMax', 'minimax-color', false],
    ['Kimi', 'kimi', true],
    ['小米 MiMo', 'xiaomimimo', true],
    ['豆包', 'doubao-color', false],
  ])('gives the %s brand its official logo', (brand, file, mono) => {
    expect(modelBrandLogo(brand)).toEqual({ src: `/model-brands/${file}.svg`, mono })
  })

  it('falls back to the brand id when the display name says nothing', () => {
    expect(modelBrandLogo('通用', 'deepseek')).toEqual({ src: '/model-brands/deepseek-color.svg', mono: false })
  })

  it('knows no logo for an unknown brand', () => {
    expect(modelBrandLogo('Acme AI', 'acme')).toBeNull()
    expect(modelBrandLogo('', null, undefined)).toBeNull()
  })
})

describe('BrandMark', () => {
  it('shows a colored official logo as an image', () => {
    const { container } = render(<BrandMark name="DeepSeek" />)
    const mark = container.firstElementChild!
    expect(mark.tagName).toBe('IMG')
    expect(mark).toHaveAttribute('src', '/model-brands/deepseek-color.svg')
    expect(container).not.toHaveTextContent('D')
  })

  it('draws a single-color logo in the text color so it shows on both themes', () => {
    const { container } = render(<BrandMark name="ChatGPT" size={16} />)
    const mark = container.firstElementChild as HTMLElement
    expect(mark.tagName).toBe('SPAN')
    expect(mark).toHaveAttribute('data-brand-logo', '/model-brands/openai.svg')
    expect(mark).toHaveClass('bg-[var(--color-text-primary)]')
    expect(mark.textContent).toBe('')
  })

  it('prefers the shipped logo over a console icon and keeps the console icon for unknown brands', () => {
    const known = render(<BrandMark name="Claude" logo="https://console.example.test/claude.png" />)
    expect(known.container.firstElementChild).toHaveAttribute('src', '/model-brands/claude-color.svg')
    known.unmount()

    const unknown = render(<BrandMark name="Acme AI" logo="https://console.example.test/acme.png" />)
    expect(unknown.container.firstElementChild).toHaveAttribute('src', 'https://console.example.test/acme.png')
  })
})
