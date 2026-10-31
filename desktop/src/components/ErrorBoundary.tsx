import React from 'react'
import { AlertCircle, LoaderCircle } from 'lucide-react'
import { t } from '../i18n'
import { reportReactError } from '../lib/diagnosticsCapture'
import { Button } from '@/components/ui/Button'
import { DoctorPanel } from './doctor/DoctorPanel'

type Props = {
  children: React.ReactNode
  /**
   * `app` guards the whole window and is the last resort. `region` guards one
   * part of it (the sidebar, the page in the content card): a failure there
   * leaves the rest of the window working and is reported in place.
   */
  scope?: 'app' | 'region'
  /** A new value clears a caught failure: moving to another tab starts afresh. */
  resetKey?: unknown
}

type State = {
  failed: boolean
  /** Quiet re-renders already spent on the current failure. */
  retries: number
}

/** Most failures clear on the next render: a module mid-update, a race on mount. */
export const AUTO_RETRIES = 2
export const RETRY_DELAY_MS = 1200
/** Rendering this long without failing earns the retries back. */
const STABLE_MS = 15_000
const CHUNK_RELOAD_KEY = 'cc-haha.error-boundary.chunk-reload'
const CHUNK_RELOAD_GAP_MS = 60_000

/** A lazy page whose file is gone: the build changed under the window, and only a reload fetches the new one. */
export function isStaleChunkError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error)
  return /Failed to fetch dynamically imported module|Importing a module script failed|error loading dynamically imported module/i.test(message)
}

/** Reloads the window, at most once a minute so a missing file cannot loop it. */
function reloadOnce(): boolean {
  try {
    const last = Number(sessionStorage.getItem(CHUNK_RELOAD_KEY) || 0)
    if (Date.now() - last < CHUNK_RELOAD_GAP_MS) return false
    sessionStorage.setItem(CHUNK_RELOAD_KEY, String(Date.now()))
  } catch {
    return false
  }
  window.location.reload()
  return true
}

export class ErrorBoundary extends React.Component<Props, State> {
  state: State = { failed: false, retries: 0 }
  private retryTimer: ReturnType<typeof setTimeout> | null = null
  private stableTimer: ReturnType<typeof setTimeout> | null = null

  static getDerivedStateFromError(): Partial<State> {
    return { failed: true }
  }

  componentDidMount() {
    // In development the next hot update is usually the fix: render again then.
    import.meta.hot?.on('vite:afterUpdate', this.handleHotUpdate)
  }

  componentDidUpdate(previous: Props) {
    if (this.state.failed && previous.resetKey !== this.props.resetKey) {
      this.recover(true)
      return
    }
    if (!this.state.failed && this.state.retries > 0 && !this.stableTimer) {
      this.stableTimer = setTimeout(() => {
        this.stableTimer = null
        if (!this.state.failed) this.setState({ retries: 0 })
      }, STABLE_MS)
    }
  }

  componentWillUnmount() {
    this.clearTimers()
    import.meta.hot?.off?.('vite:afterUpdate', this.handleHotUpdate)
  }

  componentDidCatch(error: unknown, errorInfo: React.ErrorInfo) {
    void reportReactError(error, errorInfo)
    if (isStaleChunkError(error) && reloadOnce()) return
    if (this.state.retries < AUTO_RETRIES) {
      this.clearTimers()
      this.retryTimer = setTimeout(() => this.recover(false), RETRY_DELAY_MS)
    }
  }

  private handleHotUpdate = () => {
    if (this.state.failed) this.recover(true)
  }

  private recover(fresh: boolean) {
    this.clearTimers()
    this.setState(state => ({ failed: false, retries: fresh ? 0 : state.retries + 1 }))
  }

  private clearTimers() {
    if (this.retryTimer) clearTimeout(this.retryTimer)
    if (this.stableTimer) clearTimeout(this.stableTimer)
    this.retryTimer = null
    this.stableTimer = null
  }

  render() {
    if (!this.state.failed) return this.props.children
    const region = this.props.scope === 'region'
    // While the quiet retries last, the user sees a short wait, not a failure.
    if (this.state.retries < AUTO_RETRIES) return <RecoveringNotice region={region} />
    return region
      ? <RegionFallback onRetry={() => this.recover(true)} />
      : <ErrorBoundaryFallback />
  }
}

function RecoveringNotice({ region }: { region: boolean }) {
  return (
    <div
      role="status"
      data-testid="error-boundary-recovering"
      className={`${region ? 'h-full w-full' : 'h-screen w-screen bg-[var(--color-background)]'} flex items-center justify-center gap-2 p-6 text-[13px] text-[var(--color-text-tertiary)]`}
    >
      <LoaderCircle size={15} strokeWidth={1.75} aria-hidden="true" className="shrink-0 motion-safe:animate-spin" />
      {t('errorBoundary.recovering')}
    </div>
  )
}

/** In place of the one part that failed; the rest of the window keeps working. */
function RegionFallback({ onRetry }: { onRetry: () => void }) {
  return (
    <div data-testid="error-boundary-region" className="flex h-full w-full items-center justify-center p-6">
      <div className="flex max-w-sm flex-col items-center gap-3 text-center">
        <AlertCircle size={18} strokeWidth={1.75} aria-hidden="true" className="text-[var(--color-text-tertiary)]" />
        <p className="text-[13px] leading-5 text-[var(--color-text-secondary)]">{t('errorBoundary.region')}</p>
        <Button type="button" variant="secondary" size="sm" onClick={onRetry}>
          {t('common.retry')}
        </Button>
      </div>
    </div>
  )
}

function ErrorBoundaryFallback() {
  return (
    <div className="h-screen w-screen bg-[var(--color-background)] text-[var(--color-text-primary)] flex items-center justify-center p-6">
      <div className="max-w-md w-full text-center">
        <div className="text-[15px] font-semibold">{t('errorBoundary.title')}</div>
        <div className="mt-2 text-sm text-[var(--color-text-tertiary)]">
          {t('errorBoundary.description')}
        </div>
        <div className="mt-4 flex justify-center">
          <Button type="button" variant="secondary" size="sm" onClick={() => window.location.reload()}>
            {t('common.retry')}
          </Button>
        </div>
        {/* The Doctor stays at hand, folded away: it is for when retrying is not enough. */}
        <details className="mt-4 text-left">
          <summary className="cursor-pointer text-center text-[12px] text-[var(--color-text-tertiary)] hover:text-[var(--color-text-secondary)]">
            {t('errorBoundary.details')}
          </summary>
          <div className="mt-3">
            <DoctorPanel compact />
          </div>
        </details>
      </div>
    </div>
  )
}
