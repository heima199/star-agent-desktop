import type { ReactNode } from 'react'
import { LogIn } from 'lucide-react'
import { useModelPolicy } from '@/lib/modelPolicy'
import { useStarStore } from '@/stores/starStore'
import { useStarBrand } from '@/stores/starBrandStore'

/**
 * What the CLI answers when its model request has no valid key: "Not logged
 * in · Please run /login" and its variants (src/services/api/errors.ts). In
 * STAR the key comes with the STAR account and there is no /login to run.
 */
const CLI_LOGIN_REQUIRED: readonly RegExp[] = [
  /^Not logged in · (?:Please run|Run) \/login\.?$/i,
  /^OAuth token revoked · Please run \/login\.?$/i,
  /^Invalid API key · Fix external API key\.?$/i,
  /^Please run \/login · API Error\b/i,
  /^Failed to authenticate\. API Error\b/i,
]

/** Whether `text` is one of the CLI's "sign in first" answers. */
export function isCliLoginRequiredText(text: string | null | undefined): boolean {
  const value = text?.trim() ?? ''
  return value.length > 0 && value.length < 600 && CLI_LOGIN_REQUIRED.some(pattern => pattern.test(value))
}

/**
 * Shown in the chat instead of such an answer: sign in to STAR, then send
 * again. A build that is not STAR-only keeps the CLI's own text (`fallback`).
 */
export function StarLoginRequiredNotice({ fallback }: { fallback: ReactNode }) {
  const policy = useModelPolicy()
  const signedIn = useStarStore(s => Boolean(s.status?.signedIn))
  const brand = useStarBrand()
  if (policy !== 'star-only') return <>{fallback}</>
  return (
    <div role="alert" data-testid="star-login-required" className="mb-3 flex items-center gap-3 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface-container-low)] px-3.5 py-2.5 text-[13px] leading-5 text-[var(--color-text-secondary)]">
      <span className="min-w-0 flex-1">
        {signedIn ? `${brand.name} 账号的登录已失效，这次没有得到回复。重新登录后再发送一次。` : `还没有登录 ${brand.name} 账号，暂时用不了模型。登录后再发送一次。`}
      </span>
      <button type="button" onClick={() => useStarStore.getState().openLogin()} className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-[var(--radius-md)] bg-[var(--color-btn-primary-bg)] px-3 text-[13px] font-medium text-[var(--color-btn-primary-fg)] hover:opacity-90">
        <LogIn size={14} strokeWidth={1.75} aria-hidden="true" />
        {signedIn ? '重新登录' : `登录 ${brand.name} 账号`}
      </button>
    </div>
  )
}
