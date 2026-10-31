import { act, fireEvent, render, screen } from '@testing-library/react'
import '@testing-library/jest-dom'
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'

import { useSettingsStore } from '../stores/settingsStore'
import { AUTO_RETRIES, ErrorBoundary, RETRY_DELAY_MS, isStaleChunkError } from './ErrorBoundary'
import { reportReactError } from '../lib/diagnosticsCapture'

vi.mock('../lib/diagnosticsCapture', () => ({
  reportReactError: vi.fn(),
}))

vi.mock('./doctor/DoctorPanel', () => ({
  DoctorPanel: ({ compact }: { compact?: boolean }) => (
    <div data-testid="doctor-panel">{compact ? 'compact doctor' : 'doctor'}</div>
  ),
}))

function CrashingChild(): never {
  throw new Error('boom')
}

/**
 * Throws while `failing.current` is set. A flag rather than a render count:
 * React renders a throwing tree once more on its own before the boundary hears
 * of it, so counting renders says nothing about the boundary's own retries.
 */
function makeFlaky() {
  const failing = { current: true }
  function FlakyChild() {
    if (failing.current) throw new Error('mid-update')
    return <div>recovered content</div>
  }
  return { FlakyChild, failing }
}

/** Lets the quiet retries run out. */
function exhaustRetries() {
  for (let attempt = 0; attempt < AUTO_RETRIES; attempt++) {
    act(() => {
      vi.advanceTimersByTime(RETRY_DELAY_MS)
    })
  }
}

describe('ErrorBoundary', () => {
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    vi.useFakeTimers()
    useSettingsStore.setState({ locale: 'en' })
    vi.clearAllMocks()
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.useRealTimers()
    consoleErrorSpy.mockRestore()
  })

  it('shows retry and compact Doctor fallback when a child keeps crashing', () => {
    render(
      <ErrorBoundary>
        <CrashingChild />
      </ErrorBoundary>,
    )

    // The first failures get quiet retries: a short wait, not the error page.
    expect(screen.getByTestId('error-boundary-recovering')).toBeInTheDocument()
    expect(screen.queryByText('Something went wrong.')).not.toBeInTheDocument()

    exhaustRetries()

    expect(screen.getByText('Something went wrong.')).toBeInTheDocument()
    expect(screen.getByText('The error was recorded in Diagnostics.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument()
    expect(screen.getByTestId('doctor-panel')).toHaveTextContent('compact doctor')
    expect(reportReactError).toHaveBeenCalled()
  })

  // A module caught mid-update, or a race on mount, clears on the next render.
  it('recovers from a passing failure without showing the error page', () => {
    const { FlakyChild, failing } = makeFlaky()
    render(
      <ErrorBoundary>
        <FlakyChild />
      </ErrorBoundary>,
    )
    expect(screen.getByTestId('error-boundary-recovering')).toBeInTheDocument()

    failing.current = false
    act(() => {
      vi.advanceTimersByTime(RETRY_DELAY_MS)
    })

    expect(screen.getByText('recovered content')).toBeInTheDocument()
    expect(screen.queryByText('Something went wrong.')).not.toBeInTheDocument()
    expect(reportReactError).toHaveBeenCalledTimes(1)
  })

  it('keeps a failed region in place, without the Doctor, and retries it on demand', () => {
    const { FlakyChild, failing } = makeFlaky()
    render(
      <div>
        <nav>still here</nav>
        <ErrorBoundary scope="region">
          <FlakyChild />
        </ErrorBoundary>
      </div>,
    )
    exhaustRetries()

    expect(screen.getByTestId('error-boundary-region')).toHaveTextContent("This part couldn't be shown.")
    expect(screen.getByText('still here')).toBeInTheDocument()
    expect(screen.queryByTestId('doctor-panel')).not.toBeInTheDocument()

    failing.current = false
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    expect(screen.getByText('recovered content')).toBeInTheDocument()
  })

  it('starts a failed region afresh when its reset key changes', () => {
    const { FlakyChild, failing } = makeFlaky()
    const { rerender } = render(
      <ErrorBoundary scope="region" resetKey="tab-a">
        <FlakyChild />
      </ErrorBoundary>,
    )
    exhaustRetries()
    expect(screen.getByTestId('error-boundary-region')).toBeInTheDocument()

    failing.current = false
    rerender(
      <ErrorBoundary scope="region" resetKey="tab-b">
        <FlakyChild />
      </ErrorBoundary>,
    )
    expect(screen.getByText('recovered content')).toBeInTheDocument()
  })

  it('tells a lazy page whose file is gone from other failures', () => {
    expect(isStaleChunkError(new TypeError('Failed to fetch dynamically imported module: http://localhost:1420/src/pages/x.tsx'))).toBe(true)
    expect(isStaleChunkError(new ReferenceError('Folder is not defined'))).toBe(false)
  })
})
