import { useEffect, useState } from 'react'
import { RefreshCw } from 'lucide-react'
import { BrandSeal } from '@/components/composite/BrandSeal'
import { CopyButton } from '@/components/ui/CopyButton'
import { Badge } from '@/components/ui/Badge'
import { useShallow } from 'zustand/react/shallow'
import { useChatStore } from '../../stores/chatStore'
import { useTabStore } from '../../stores/tabStore'
import { useTranslation, type TranslationKey } from '../../i18n'
import { formatDurationSeconds } from '../../lib/backgroundTasks'
import { StarReplyTip } from '../star/StarReplyTip'

function translateServerVerb(
  t: (key: TranslationKey) => string,
  verb: string,
): string {
  const key = `serverVerb.${verb}` as TranslationKey
  const translated = t(key)
  return translated === key ? verb : translated
}

/**
 * What the turn is currently doing, in the user's language.
 *
 * This is the only place in the UI that reports the verb and the elapsed time —
 * the composer keeps just a Stop button. Do not delete this
 * component on the assumption the composer covers it, and do not fold it into
 * the turn rail either: during `isPreparingTurn` the session is still being
 * created, so the transcript holds no render items and there is no rail to hang
 * it on. That gap is exactly what regressed once before.
 */
export function resolveTurnStatusVerb(
  t: (key: TranslationKey) => string,
  chatState: string,
  statusVerb: string,
): string {
  if (statusVerb) return translateServerVerb(t, statusVerb)
  if (chatState === 'thinking') return t('serverVerb.Thinking')
  if (chatState === 'compacting') return t('serverVerb.Compacting conversation')
  if (chatState === 'tool_executing') return t('serverVerb.Running')
  return t('serverVerb.Working')
}

function formatRetrySeconds(ms: number): number {
  return Math.max(0, Math.ceil(ms / 1000))
}

const HUMAN_READABLE_RETRY_THRESHOLD_MS = 60_000

function formatErrorType(errorType: string | undefined): string | null {
  if (!errorType || errorType === 'unknown') return null
  return errorType
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

export function StreamingIndicator() {
  const t = useTranslation()
  const [now, setNow] = useState(() => Date.now())
  const activeTabId = useTabStore((s) => s.activeTabId)
  // The line shows the verb and the elapsed time only. It used to count streamed
  // tokens too, which made it re-render on every chunk and read as a meter; now
  // it reads these few fields and updates once a second at most.
  const { chatState, statusVerb, apiRetry, streamingFallback, elapsedSeconds } = useChatStore(useShallow((s) => {
    const sessionState = activeTabId ? s.sessions[activeTabId] : undefined
    return {
      chatState: sessionState?.isPreparingTurn ? 'thinking' : sessionState?.chatState ?? 'idle',
      statusVerb: sessionState?.statusVerb ?? '',
      apiRetry: sessionState?.apiRetry ?? null,
      streamingFallback: sessionState?.streamingFallback ?? null,
      elapsedSeconds: sessionState?.elapsedSeconds ?? 0,
    }
  }))

  useEffect(() => {
    if (!apiRetry) return undefined
    setNow(Date.now())
    const timer = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [apiRetry?.receivedAt, apiRetry?.retryDelayMs])

  if (apiRetry) {
    const remainingMs = Math.max(0, apiRetry.retryDelayMs - (now - apiRetry.receivedAt))
    const httpStatusText = apiRetry.errorStatus !== null
      ? t('chat.retry.httpStatus', { status: apiRetry.errorStatus })
      : null
    const statusText = apiRetry.errorType === 'rate_limit'
      ? [t('chat.retry.rateLimit'), httpStatusText].filter(Boolean).join(' · ')
      : httpStatusText ?? (apiRetry.errorType === 'connection_error'
        ? t('chat.retry.networkError')
        : formatErrorType(apiRetry.errorType)) ?? t('chat.retry.interrupted')
    const detailText = apiRetry.errorMessage?.trim() || t('chat.retry.missingReason')
    const diagnostics = [
      `${t('chat.retry.session')}: ${activeTabId}`,
      `${t('chat.retry.time')}: ${new Date(apiRetry.receivedAt).toISOString()}`,
      t('chat.retry.attempt', { attempt: apiRetry.attempt, max: apiRetry.maxRetries }),
      statusText,
      apiRetry.errorType,
      apiRetry.requestId ? `${t('chat.retry.requestId')}: ${apiRetry.requestId}` : null,
      detailText,
    ].filter(Boolean).join('\n')
    const waitText = remainingMs <= 0
      ? t('chat.retry.retrying')
      : remainingMs >= HUMAN_READABLE_RETRY_THRESHOLD_MS
        ? t('chat.retry.waitingLong', {
            duration: formatDurationSeconds(remainingMs / 1000, t, 1),
          })
        : t('chat.retry.waiting', { seconds: formatRetrySeconds(remainingMs) })

    return (
      <div
        data-testid="api-retry-indicator"
        role="status"
        aria-live="polite"
        className="mb-2 flex w-full flex-wrap items-center gap-2 rounded-[var(--radius-md)] bg-[var(--color-warning-container)] px-3 py-2 text-xs text-[var(--color-on-warning-container)]"
      >
        <RefreshCw size={14} strokeWidth={1.75} className="shrink-0 animate-spin" aria-hidden="true" />
        <span className="font-medium">{t('chat.retry.title')}</span>
        {/*
          Neutral rather than `tone="warning"`: these chips sit on the warning
          container itself, so a warning-tinted chip would disappear into it,
          and the warning accent as foreground on that fill measures 2.66:1 in
          the light theme (see components/AGENTS.md §3.2).
        */}
        <Badge mono pill={false} bordered className="leading-none">
          {t('chat.retry.attempt', { attempt: apiRetry.attempt, max: apiRetry.maxRetries })}
        </Badge>
        <Badge mono pill={false} bordered className="leading-none">
          {statusText}
        </Badge>
        <span>{waitText}</span>
        <details className="w-full min-w-0">
          <summary className="cursor-pointer rounded-[var(--radius-sm)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-border-focus)]">
            {t('chat.retry.details')}
          </summary>
          <pre className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap break-words font-mono text-[11px]">{diagnostics}</pre>
          <p className="mt-2">{t('chat.retry.historyHint')}</p>
          <CopyButton
            text={diagnostics}
            label={t('chat.retry.copyDiagnostics')}
            copiedLabel={t('common.copied')}
            className="mt-2 rounded-[var(--radius-sm)] border border-current px-2 py-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-border-focus)]"
          />
        </details>
      </div>
    )
  }

  if (streamingFallback) {
    // 预期内的降级等待（非错误）：非流式响应一次性返回，期间无增量输出。
    // 用中性样式的轻提示 + 回合计时，与 api_retry 的警示横幅区分开。
    return (
      <div
        data-testid="streaming-fallback-indicator"
        role="status"
        aria-live="polite"
        className="flex min-h-7 w-fit max-w-full flex-wrap items-center gap-x-2 text-[13px] text-[var(--color-text-secondary)]"
      >
        <RefreshCw size={14} strokeWidth={1.75} className="shrink-0 animate-spin text-[var(--color-text-tertiary)]" aria-hidden="true" />
        <span className="font-medium text-[var(--color-text-primary)]">
          {t('chat.fallback.title')}
        </span>
        <span className="text-xs text-[var(--color-text-tertiary)]">
          {t('chat.fallback.detail')}
        </span>
        {elapsedSeconds > 0 && (
          <span className={STATUS_META_CLASS}>
            {formatDurationSeconds(elapsedSeconds, t)}
          </span>
        )}
      </div>
    )
  }

  const verb = resolveTurnStatusVerb(t, chatState, statusVerb)

  return (
    <>
      <style>{TURN_STATUS_STYLES}</style>
      <div
        data-testid="turn-status-indicator"
        role="status"
        aria-live="polite"
        // Bare line, not a pill: it sits at the end of the live turn, and a
        // bordered chip here would read as a second, competing status object.
        className="flex h-7 w-fit max-w-full items-center gap-2 text-[13px] text-[var(--color-text-secondary)]"
      >
        {/* 思考时这里也要一个logo: the STAR logo heads the line. When the turn
            starts it darts to the right and springs back, then turns for as
            long as the turn runs (TURN_STATUS_STYLES; slower under reduced
            motion, never still). The star's ink follows the theme, as
            everywhere else. */}
        <span className="turn-status-logo" aria-hidden="true">
          <BrandSeal size="xs" />
        </span>
        <span className="turn-status-shimmer min-w-0 truncate font-medium">{verb}...</span>
        {elapsedSeconds > 0 && (
          <span className={STATUS_META_CLASS}>{formatDurationSeconds(elapsedSeconds, t)}</span>
        )}
      </div>
      {/* Under the line, not in it: the status stays the one live object. */}
      <StarReplyTip elapsedSeconds={elapsedSeconds} />
    </>
  )
}

/** Elapsed time: small, monospaced, steady-width digits. */
const STATUS_META_CLASS = 'shrink-0 whitespace-nowrap font-mono text-[11px] tabular-nums text-[var(--color-text-tertiary)]'

/**
 * The verb reads as live through a light sweeping across it, and the logo
 * moves; neither moves the layout (transforms only). The logo darts 10px to
 * the right and snaps back past its place before settling (0.65 s, once per
 * turn line), and only then starts turning.
 *
 * Reduced motion drops the dart and slows the rest, but never stops it: this
 * line is the only sign the turn is alive, and a frozen one reads as a hung
 * app (the rule `.animate-spin` follows in globals.css). Windows reports
 * reduced motion whenever its animation effects are off, so that is what many
 * PCs see (思考中的时候那个加载特效也没有滚动).
 */
const TURN_STATUS_STYLES = `
@keyframes turn-status-sweep {
  from { background-position: 100% 0; }
  to { background-position: -100% 0; }
}
@keyframes turn-status-logo-dart {
  0% { transform: translateX(0); animation-timing-function: cubic-bezier(0.2, 0.7, 0.3, 1); }
  45% { transform: translateX(10px); animation-timing-function: cubic-bezier(0.6, 0, 0.9, 0.4); }
  72% { transform: translateX(-3px); animation-timing-function: cubic-bezier(0.3, 0, 0.3, 1); }
  100% { transform: translateX(0); }
}
@keyframes turn-status-logo-turn {
  to { transform: rotate(360deg); }
}
.turn-status-logo {
  display: inline-flex;
  flex-shrink: 0;
  animation: turn-status-logo-dart 0.65s both;
}
.turn-status-logo > [data-testid="brand-seal"] {
  animation: turn-status-logo-turn 1.8s cubic-bezier(0.45, 0.05, 0.55, 0.95) 0.65s infinite;
}
.turn-status-shimmer {
  background: linear-gradient(90deg, var(--color-text-tertiary) 0%, var(--color-text-tertiary) 40%, var(--color-text-primary) 50%, var(--color-text-tertiary) 60%, var(--color-text-tertiary) 100%);
  background-size: 200% 100%;
  -webkit-background-clip: text;
  background-clip: text;
  color: transparent;
  animation: turn-status-sweep 2.2s linear infinite;
}
@media (prefers-reduced-motion: reduce) {
  .turn-status-shimmer {
    animation-duration: 3.3s;
  }
  .turn-status-logo {
    animation: none;
  }
  .turn-status-logo > [data-testid="brand-seal"] {
    animation: turn-status-logo-turn 2.7s linear infinite;
  }
}
`
