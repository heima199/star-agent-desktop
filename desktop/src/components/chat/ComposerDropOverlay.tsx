import { createPortal } from 'react-dom'
import { FileCode2, FileText, Image } from 'lucide-react'

type ComposerDropOverlayProps = {
  title: string
  description: string
  testId: string
  /**
   * The page drop zone (see useComposerFileDrop). When set, the overlay
   * covers that whole area, larger, instead of just the composer card.
   */
  container?: HTMLElement | null
}

/**
 * Drop target over the composer: the card blurs out behind a stack of three
 * file tiles (code, document, image) with the title and hint under it.
 *
 * Every fill is an opaque token: `--color-brand/45`-style alpha compiles to a
 * color function the Safari 15 WebView drops, which once left this overlay with
 * no edge and a fully transparent scrim there.
 */
export function ComposerDropOverlay({ title, description, testId, container }: ComposerDropOverlayProps) {
  const page = Boolean(container)
  const tile = page ? 'h-14 w-14 rounded-[var(--radius-lg)]' : 'h-8 w-8 rounded-[var(--radius-md)]'
  const icon = page ? 26 : 16
  const overlay = (
    <div
      data-testid={testId}
      data-drop-zone={page ? 'page' : 'panel'}
      className={page
        ? 'composer-drop-overlay pointer-events-none absolute inset-0 z-[var(--z-scrim)] flex flex-col items-center justify-center gap-3 bg-[var(--color-surface-glass)] p-6 text-center backdrop-blur-xl'
        : 'composer-drop-overlay pointer-events-none absolute inset-0 z-[var(--z-scrim)] flex flex-col items-center justify-center gap-2 rounded-[inherit] border border-dashed border-[var(--color-outline)] bg-[var(--color-surface-glass)] p-3 text-center backdrop-blur-md'}
      aria-hidden="true"
    >
      <span data-testid={`${testId}-tiles`} className={`relative block shrink-0 ${page ? 'h-[76px] w-[124px]' : 'h-10 w-[68px]'}`}>
        <span className={`absolute left-0 top-1 flex -rotate-12 items-center justify-center bg-[var(--color-success-container)] text-[var(--color-on-success-container)] shadow-[var(--shadow-dropdown)] ${tile}`}>
          <FileCode2 size={icon} strokeWidth={1.75} />
        </span>
        <span className={`absolute right-0 top-0 flex rotate-12 items-center justify-center bg-[var(--color-info-container)] text-[var(--color-on-info-container)] shadow-[var(--shadow-dropdown)] ${tile}`}>
          <FileText size={icon} strokeWidth={1.75} />
        </span>
        <span className={`absolute bottom-0 left-1/2 flex -translate-x-1/2 items-center justify-center bg-[var(--color-brand)] text-[var(--color-on-primary)] shadow-[var(--shadow-dropdown)] ${tile}`}>
          <Image size={icon} strokeWidth={1.75} />
        </span>
      </span>
      <span className={`block font-semibold text-[var(--color-text-primary)] ${page ? 'mt-2 text-[18px] leading-7' : 'text-[15px] leading-6'}`}>{title}</span>
      <span className={`block text-[var(--color-text-tertiary)] ${page ? 'text-[13px] leading-5' : 'text-xs leading-5'}`}>{description}</span>
    </div>
  )
  return container ? createPortal(overlay, container) : overlay
}
