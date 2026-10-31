import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import '@testing-library/jest-dom'
import { ComposerDropOverlay } from './ComposerDropOverlay'

describe('ComposerDropOverlay', () => {
  it('shows the title and hint over the file tiles', () => {
    render(<ComposerDropOverlay testId="drop" title="Drop files and images here" description="Attached as file paths." />)

    const overlay = screen.getByTestId('drop')
    expect(overlay).toHaveTextContent('Drop files and images here')
    expect(overlay).toHaveTextContent('Attached as file paths.')
    // Code, document and image: one tile each.
    expect(screen.getByTestId('drop-tiles').querySelectorAll('svg')).toHaveLength(3)
  })

  it('stays out of the way of the drop it is announcing', () => {
    // The composer underneath receives the drop; an overlay that took pointer
    // events would swallow it, and one that was announced would read the
    // decoration out on every drag.
    render(<ComposerDropOverlay testId="drop" title="t" description="d" />)

    const overlay = screen.getByTestId('drop')
    expect(overlay).toHaveClass('pointer-events-none')
    expect(overlay).toHaveAttribute('aria-hidden', 'true')
  })
})
