import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import '@testing-library/jest-dom'

vi.mock('../../api/websocket', () => ({
  wsManager: {
    connect: vi.fn(),
    disconnect: vi.fn(),
    onConnectionState: vi.fn((_sessionId: string, handler: (state: string) => void) => {
      handler('connecting')
      return () => {}
    }),
    onMessage: vi.fn(() => () => {}),
    clearHandlers: vi.fn(),
    send: vi.fn(),
  },
}))

vi.mock('../../api/sessions', () => ({
  sessionsApi: {
    getMessages: vi.fn(async () => ({ messages: [] })),
    getSlashCommands: vi.fn(async () => ({ commands: [] })),
  },
}))

import { StreamingIndicator } from './StreamingIndicator'
import { useChatStore, type PerSessionState } from '../../stores/chatStore'
import { useSettingsStore } from '../../stores/settingsStore'
import { useTabStore } from '../../stores/tabStore'

const copyText = vi.fn(async (_text: string) => true)
vi.mock('@/lib/clipboard', () => ({ copyTextToClipboard: (text: string) => copyText(text) }))

const ACTIVE_TAB = 'active-tab'

function makeSession(overrides: Partial<PerSessionState> = {}): PerSessionState {
  return {
    messages: [],
    chatState: 'streaming',
    connectionState: 'connected',
    historyStatus: 'idle',
    historyError: null,
    streamingText: '',
    streamingToolInput: '',
    activeToolUseId: null,
    activeToolName: null,
    activeThinkingId: null,
    pendingPermission: null,
    pendingComputerUsePermission: null,
    tokenUsage: { input_tokens: 0, output_tokens: 0 },
    streamingResponseChars: 0,
    elapsedSeconds: 0,
    statusVerb: '',
    apiRetry: null,
    slashCommands: [],
    agentTaskNotifications: {},
    backgroundAgentTasks: {},
    elapsedTimer: null,
    ...overrides,
  }
}

describe('StreamingIndicator', () => {
  beforeEach(() => {
    useChatStore.setState({ sessions: {} })
    useSettingsStore.setState({ locale: 'en' })
    useTabStore.setState({
      activeTabId: ACTIVE_TAB,
      tabs: [{ sessionId: ACTIVE_TAB, title: 'Test', type: 'session', status: 'running' }],
    })
  })

  afterEach(() => {
    cleanup()
    useChatStore.getState().disconnectSession(ACTIVE_TAB)
  })

  // The live line says what the turn is doing and for how long. It no longer
  // counts streamed tokens: that number ticked on every chunk and read as a meter.
  it('does not count streamed tokens on the live line', () => {
    useChatStore.setState({
      sessions: {
        [ACTIVE_TAB]: makeSession({ streamingResponseChars: 8976 }),
      },
    })

    render(<StreamingIndicator />)

    expect(screen.getByTestId('turn-status-indicator')).toBeInTheDocument()
    expect(screen.queryByText(/tokens/)).toBeNull()
    expect(screen.queryByText(/↓/)).toBeNull()
  })

  it('explains unclassified failures and copies actionable diagnostics', async () => {
    useChatStore.setState({ sessions: {
      [ACTIVE_TAB]: makeSession({ apiRetry: {
        attempt: 2, maxRetries: 10, retryDelayMs: 1000, errorStatus: null,
        errorType: 'unknown', errorMessage: 'Connection closed: ECONNRESET',
        requestId: 'req-test-123', receivedAt: Date.now(),
      } }),
    } })
    render(<StreamingIndicator />)
    expect(screen.queryByText('unknown')).toBeNull()
    expect(screen.getByText('Request interrupted')).toBeInTheDocument()
    fireEvent.click(screen.getByText('Error details'))
    expect(screen.getByText(/Connection closed: ECONNRESET/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Copy diagnostics' }))
    await waitFor(() => expect(copyText).toHaveBeenCalled())
    const report = copyText.mock.calls.at(-1)?.[0]
    expect(report).toContain(ACTIVE_TAB)
    expect(report).toContain('req-test-123')
    expect(report).toContain('Connection closed: ECONNRESET')
    expect(report).toContain('2/10')
  })

  it('does not invent a network cause when the runtime supplied no reason', () => {
    useChatStore.setState({ sessions: {
      [ACTIVE_TAB]: makeSession({ apiRetry: {
        attempt: 1, maxRetries: 10, retryDelayMs: 1000, errorStatus: null,
        errorType: 'unknown', receivedAt: Date.now(),
      } }),
    } })
    render(<StreamingIndicator />)
    fireEvent.click(screen.getByText('Error details'))
    expect(screen.getByText(/The runtime did not provide a specific cause/)).toBeInTheDocument()
    expect(screen.queryByText('network error')).toBeNull()
  })

  // 思考时这里也要一个logo，那个logo要往右之后迅速往回弹，随后开始思考即可.
  it('draws the live line as the STAR logo, a sweeping verb and monospaced meta', () => {
    useChatStore.setState({
      sessions: {
        [ACTIVE_TAB]: makeSession({ chatState: 'thinking', elapsedSeconds: 12, streamingResponseChars: 8976 }),
      },
    })

    render(<StreamingIndicator />)

    const status = screen.getByTestId('turn-status-indicator')
    // The STAR logo heads the line, in place of the old running ring.
    const logo = status.querySelector('.turn-status-logo')
    expect(logo).toHaveAttribute('aria-hidden', 'true')
    expect(logo?.firstElementChild).toHaveAttribute('data-testid', 'brand-seal')
    expect(logo?.firstElementChild).toHaveClass('h-5', 'w-5')
    expect(status.querySelector('svg.lucide-loader-circle')).toBeNull()
    expect(status.textContent).not.toContain('✦')
    // It darts right and springs back once, and only after that starts turning.
    const styles = document.querySelector('style')?.textContent ?? ''
    expect(styles).toMatch(/\.turn-status-logo \{[^}]*animation: turn-status-logo-dart 0\.65s both;/)
    expect(styles).toMatch(/@keyframes turn-status-logo-dart \{[^@]*45% \{ transform: translateX\(10px\);[^@]*72% \{ transform: translateX\(-3px\);/)
    expect(styles).toMatch(/\.turn-status-logo > \[data-testid="brand-seal"\] \{[^}]*turn-status-logo-turn 1\.8s [^;]* 0\.65s infinite;/)
    expect(styles).toMatch(/prefers-reduced-motion: reduce\)[\s\S]*\.turn-status-logo,[\s\S]*animation: none;/)
    expect(screen.getByText('Thinking...')).toHaveClass('turn-status-shimmer')
    // Elapsed time is a number that ticks: mono, tabular, tertiary.
    const elapsed = screen.getByText('12s')
    expect(elapsed).toHaveClass('font-mono', 'tabular-nums', 'text-[11px]')
    // The keyframes ship beside the line, not inside the live region.
    expect(status.querySelector('style')).toBeNull()
  })

  it('hides the token estimate until this turn has streamed output', () => {
    useChatStore.setState({
      sessions: {
        // Previous-turn usage must not leak into the indicator (issue #757
        // follow-up report: the count showed a stale value from the last turn).
        [ACTIVE_TAB]: makeSession({
          tokenUsage: { input_tokens: 5000, output_tokens: 6240 },
        }),
      },
    })

    render(<StreamingIndicator />)

    expect(screen.queryByText(/tokens/)).toBeNull()
  })

  it('shows the non-streaming fallback notice while waiting for the one-shot response', () => {
    useChatStore.setState({
      sessions: {
        [ACTIVE_TAB]: makeSession({
          chatState: 'thinking',
          streamingFallback: { cause: 'watchdog', receivedAt: Date.now() },
          elapsedSeconds: 95,
        }),
      },
    })

    render(<StreamingIndicator />)

    const notice = screen.getByTestId('streaming-fallback-indicator')
    expect(notice.textContent).toContain('switched to non-streaming mode')
    // 回合计时保留，证明"还在跑"而不是卡死。
    expect(notice.textContent).toContain('1m 35s')
  })

  it('prefers the retry banner over the fallback notice when both are active', () => {
    useChatStore.setState({
      sessions: {
        [ACTIVE_TAB]: makeSession({
          chatState: 'thinking',
          apiRetry: {
            attempt: 2,
            maxRetries: 10,
            retryDelayMs: 60_000,
            errorStatus: 529,
            receivedAt: Date.now(),
          },
          streamingFallback: { cause: 'stream_error', receivedAt: Date.now() },
        }),
      },
    })

    render(<StreamingIndicator />)

    // api_retry 携带更具体的进度（第 N 次/倒计时），优先级高于泛化的降级提示。
    expect(screen.getByTestId('api-retry-indicator')).toBeTruthy()
    expect(screen.queryByTestId('streaming-fallback-indicator')).toBeNull()
  })

  it('explains a long rate-limit retry without reducing it to HTTP or raw seconds', () => {
    useChatStore.getState().connectToSession(ACTIVE_TAB, {
      minimalBootstrap: true,
      prewarm: false,
    })
    useChatStore.getState().handleServerMessage(ACTIVE_TAB, {
      type: 'api_retry',
      attempt: 1,
      maxRetries: 10,
      retryDelayMs: 13_570_000,
      errorStatus: 429,
      errorType: 'rate_limit',
    })

    render(<StreamingIndicator />)

    const banner = screen.getByTestId('api-retry-indicator')
    expect(banner.textContent).toContain('usage or rate limit reached')
    expect(banner.textContent).toContain('HTTP 429')
    expect(banner.textContent).toContain('retrying in about 3h 46m')
    expect(banner.textContent).not.toContain('13570s')
  })

  it('keeps an ordinary short retry compact and status-specific', () => {
    useChatStore.getState().connectToSession(ACTIVE_TAB, {
      minimalBootstrap: true,
      prewarm: false,
    })
    useChatStore.getState().handleServerMessage(ACTIVE_TAB, {
      type: 'api_retry',
      attempt: 1,
      maxRetries: 3,
      retryDelayMs: 5000,
      errorStatus: 503,
      errorType: 'server_error',
    })

    render(<StreamingIndicator />)

    const banner = screen.getByTestId('api-retry-indicator')
    expect(banner.textContent).toContain('HTTP 503')
    expect(banner.textContent).toContain('waiting 5s')
    expect(banner.textContent).not.toContain('usage or rate limit reached')
    expect(banner.textContent).not.toContain('about')
  })

  it('switches the retry banner from a countdown to "retrying now" once the delay elapses', () => {
    useChatStore.setState({
      sessions: {
        [ACTIVE_TAB]: makeSession({
          chatState: 'thinking',
          apiRetry: {
            attempt: 3,
            maxRetries: 10,
            retryDelayMs: 1000,
            errorStatus: null,
            // 倒计时早已结束：请求已在途，不该再显示"waiting 0s"。
            receivedAt: Date.now() - 10_000,
          },
        }),
      },
    })

    render(<StreamingIndicator />)

    const banner = screen.getByTestId('api-retry-indicator')
    expect(banner.textContent).toContain('retrying now')
    expect(banner.textContent).not.toContain('waiting')
  })
})
