import { useCallback, useEffect, useId, useRef, useState, type FormEvent, type KeyboardEvent } from 'react'
import { createPortal } from 'react-dom'
import { Check, Loader2, MonitorSmartphone } from 'lucide-react'
import starGlassBlack from '@/assets/brand/star-glass-black.svg'
import starGlassWhite from '@/assets/brand/star-glass-white.svg'
import { starApi, starErrorText, type StarLegalDocument, type StarStatus } from '@/api/star'
import { BRAND_LOGO_SRC, BrandSeal } from '@/components/composite/BrandSeal'
import { WindowControls } from '@/components/layout/WindowControls'
import { Switch } from '@/components/ui/Switch'
import { useStarBrand } from '@/stores/starBrandStore'
import { StarLegalDialog, type StarLegalDialogState } from './StarLegalDialog'
import {
  STAR_LOGIN_CODE_COOLDOWN_SECONDS,
  canSubmitStarLogin,
  normalizeStarLoginCode,
  pickStarLegalDocs,
  readStarLoginAgreed,
  rememberStarLoginAgreed,
  starAccountKindOf,
  starCodeAccountProblemOf,
  starCodeSentNoticeOf,
  starLoginProblemOf,
  starLoginRequestOf,
  starSendCodeLabelOf,
  type StarLoginDraft,
  type StarLoginTab,
} from './starLoginForm'
import './starLogin.css'

/**
 * The full-window STAR sign-in (the IDE's login page is the reference).
 * Left: the logo card, the glass star over three slowly drifting blobs (still
 * under reduced motion or while the window is hidden). Right: 欢迎登录,
 * 验证码登录 | 密码登录, the agreement, 登录. Below 760px the card is hidden
 * and a small brand mark sits above the form. A 40px strip on top keeps the
 * frameless window draggable and its controls reachable.
 */

const TAB_LABEL: Record<StarLoginTab, string> = { code: '验证码登录', password: '密码登录' }

export const STAR_LOGIN_AGREEMENT_HINT = '请先阅读并勾选同意《用户协议》《隐私政策》'

type LegalKind = 'terms' | 'privacy'
const LEGAL_TITLE: Record<LegalKind, string> = { terms: '用户协议', privacy: '隐私政策' }
type LegalDocs = { state: StarLegalDialogState; terms: StarLegalDocument | null; privacy: StarLegalDocument | null }

/** False while the window is minimized or hidden: the card stops drifting. */
function usePageVisible(): boolean {
  const [visible, setVisible] = useState(() => document.visibilityState !== 'hidden')
  useEffect(() => {
    const onChange = () => setVisible(document.visibilityState !== 'hidden')
    document.addEventListener('visibilitychange', onChange)
    return () => document.removeEventListener('visibilitychange', onChange)
  }, [])
  return visible
}

/** Seconds left before 「发送验证码」 works again. */
function useCooldown() {
  const [left, setLeft] = useState(0)
  const timer = useRef<ReturnType<typeof setInterval> | undefined>(undefined)
  useEffect(() => () => clearInterval(timer.current), [])
  const start = useCallback(() => {
    clearInterval(timer.current)
    setLeft(STAR_LOGIN_CODE_COOLDOWN_SECONDS)
    timer.current = setInterval(() => {
      setLeft((value) => {
        if (value <= 1) {
          clearInterval(timer.current)
          return 0
        }
        return value - 1
      })
    }, 1000)
  }, [])
  return { left, start }
}

/** The published 用户协议 / 隐私政策, read once when the screen opens (public, no sign-in). */
function useLegalDocs(): LegalDocs {
  const [legal, setLegal] = useState<LegalDocs>({ state: 'loading', terms: null, privacy: null })
  useEffect(() => {
    let alive = true
    starApi.legalDocs().then(
      (result) => {
        if (alive) setLegal({ state: 'ready', ...pickStarLegalDocs(Array.isArray(result?.docs) ? result.docs : []) })
      },
      () => {
        if (alive) setLegal({ state: 'failed', terms: null, privacy: null })
      },
    )
    return () => {
      alive = false
    }
  }, [])
  return legal
}

const FOCUS_RING = 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-border-focus)]'
const PILL_INPUT = 'h-12 w-full min-w-0 rounded-full border border-transparent bg-[var(--color-surface-container)] px-5 text-[14px] text-[var(--color-text-primary)] outline-none transition-colors placeholder:text-[var(--color-text-tertiary)] hover:bg-[var(--color-surface-container-high)] focus:border-[var(--color-border-focus)] focus:bg-[var(--color-surface-container)]'
const PILL_PRIMARY = 'bg-[var(--color-btn-primary-bg)] text-[var(--color-btn-primary-fg)] hover:bg-[var(--color-btn-primary-hover)]'
const PILL_MUTED = 'cursor-default bg-[var(--color-surface-container-high)] text-[var(--color-text-tertiary)]'
const DOC_BUTTON = `whitespace-nowrap rounded-[var(--radius-xs)] text-[var(--color-text-primary)] hover:underline hover:underline-offset-[3px] ${FOCUS_RING}`

/**
 * The left half: the rotating glass star over drifting blobs; `animate` false
 * (window hidden) = the still star, paused blobs. Under reduced motion the
 * blobs stop (starLogin.css) but the star keeps turning, as BrandSeal's does:
 * Windows reports reduced motion whenever its animation effects are off.
 * Black on the paper themes, white on the dark one, like BrandSeal.
 */
function StarLogoCard({ animate }: { animate: boolean }) {
  const brand = useStarBrand()
  return (
    <section className={`star-login-card${animate ? '' : ' is-still'}`} aria-hidden="true" data-testid="star-login-card" data-animate={animate ? 'true' : 'false'}>
      <div className="star-login-flow">
        <span className="star-login-blob" />
        <span className="star-login-blob star-login-blob--b" />
        <span className="star-login-blob star-login-blob--c" />
      </div>
      <div className="star-login-art">
        <img className="star-login-logo dark:hidden" src={animate ? starGlassBlack : BRAND_LOGO_SRC.light} alt="" draggable={false} />
        <img className="star-login-logo hidden dark:block" src={animate ? starGlassWhite : BRAND_LOGO_SRC.dark} alt="" draggable={false} />
      </div>
      <div className="flex flex-col gap-2">
        <div className="text-[26px] font-semibold leading-tight text-[var(--color-text-primary)]">{brand.agent}</div>
        <div className="text-[15px] leading-6 text-[var(--color-text-secondary)]">与 {brand.name} 一起，把想法变成成果</div>
      </div>
    </section>
  )
}

export type StarLoginScreenProps = {
  status: StarStatus | null
  onClose: () => void
  /** A sign-in went through; `activate` is the 「设为默认对话模型」 choice. */
  onSignedIn: (status: StarStatus, activate: boolean) => void
}

type FormMessage = { kind: 'error' | 'notice'; text: string }

export function StarLoginScreen({ status, onClose, onSignedIn }: StarLoginScreenProps) {
  const brand = useStarBrand()
  const [tab, setTab] = useState<StarLoginTab>('code')
  const [account, setAccount] = useState('')
  const [code, setCode] = useState('')
  const [password, setPassword] = useState('')
  const [inviteOpen, setInviteOpen] = useState(false)
  const [inviteCode, setInviteCode] = useState('')
  const [activate, setActivate] = useState(true)
  const [agreed, setAgreed] = useState(readStarLoginAgreed)
  /** Pressed 登录 without the agreement: bumps to replay the nudge. */
  const [attention, setAttention] = useState(0)
  const [message, setMessage] = useState<FormMessage | null>(null)
  const [busy, setBusy] = useState<'code' | 'login' | 'starwork' | null>(null)
  const [openDoc, setOpenDoc] = useState<LegalKind | null>(null)
  const cooldown = useCooldown()
  const legal = useLegalDocs()
  const pageVisible = usePageVisible()
  const accountRef = useRef<HTMLInputElement>(null)
  const codeRef = useRef<HTMLInputElement>(null)
  const inviteRef = useRef<HTMLInputElement>(null)
  const agreeRef = useRef<HTMLInputElement>(null)
  const rootRef = useRef<HTMLDivElement>(null)
  const agreeId = useId()

  const draft: StarLoginDraft = { tab, account, code, password, inviteCode: inviteOpen ? inviteCode : '' }
  const problem = starLoginProblemOf(draft)
  const canSubmit = canSubmitStarLogin(draft, agreed) && busy === null
  const notConfigured = status !== null && !status.configured
  const accountPlaceholder = tab === 'code' ? '手机号或邮箱' : '邮箱'

  // Opens with the cursor in the first field; focus goes back where it was on close.
  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null
    accountRef.current?.focus()
    return () => {
      if (previous?.isConnected) previous.focus()
    }
  }, [])

  // Esc leaves the screen, unless it is closing the 用户协议 / 隐私政策 dialog on top.
  useEffect(() => {
    if (openDoc) return
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      // An Esc that cancels an IME composition (拼音输入) is not a request to leave.
      if (event.key === 'Escape' && !event.defaultPrevented && !event.isComposing) onClose()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [openDoc, onClose])

  /** Tab / Shift+Tab cycle inside the screen: the app behind it is covered. */
  const keepTabInside = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'Tab' || openDoc || !rootRef.current) return
    const focusable = Array.from(rootRef.current.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled])'))
      .filter(element => !element.closest('[aria-hidden="true"]'))
    if (focusable.length === 0) return
    const first = focusable[0]!
    const last = focusable[focusable.length - 1]!
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault()
      last.focus()
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault()
      first.focus()
    }
  }

  const edited = () => setMessage(null)

  const switchTab = (next: StarLoginTab) => {
    if (next === tab) return
    setTab(next)
    setMessage(null)
    accountRef.current?.focus()
  }

  const remindAgreement = () => {
    setMessage({ kind: 'error', text: STAR_LOGIN_AGREEMENT_HINT })
    setAttention(value => value + 1)
    agreeRef.current?.focus()
  }

  const finish = async (kind: 'login' | 'starwork', request: () => Promise<StarStatus>) => {
    setBusy(kind)
    setMessage(null)
    try {
      const next = await request()
      rememberStarLoginAgreed()
      onSignedIn(next, activate)
    } catch (error) {
      setMessage({ kind: 'error', text: starErrorText(error) })
    } finally {
      setBusy(null)
    }
  }

  const sendCode = async () => {
    if (busy !== null || cooldown.left > 0) return
    const accountProblem = starCodeAccountProblemOf(account)
    if (accountProblem) {
      setMessage({ kind: 'error', text: accountProblem })
      accountRef.current?.focus()
      return
    }
    setBusy('code')
    setMessage(null)
    try {
      await starApi.sendCode(account.trim())
      cooldown.start()
      setMessage({ kind: 'notice', text: starCodeSentNoticeOf(starAccountKindOf(account) ?? 'email') })
      codeRef.current?.focus()
    } catch (error) {
      setMessage({ kind: 'error', text: starErrorText(error) })
    } finally {
      setBusy(null)
    }
  }

  const submit = (event: FormEvent) => {
    event.preventDefault()
    if (busy !== null) return
    if (problem !== null) {
      setMessage({ kind: 'error', text: problem })
      return
    }
    if (!agreed) {
      remindAgreement()
      return
    }
    const request = starLoginRequestOf(draft, activate)
    if (request) void finish('login', () => starApi.login(request))
  }

  const signInWithStarWork = () => {
    if (busy !== null) return
    if (!agreed) {
      remindAgreement()
      return
    }
    void finish('starwork', () => starApi.loginWithStarWork(activate))
  }

  const openInvite = () => {
    setInviteOpen(true)
    setTimeout(() => inviteRef.current?.focus(), 0)
  }

  return createPortal(
    <div
      ref={rootRef}
      role="dialog"
      aria-modal="true"
      aria-label={`登录 ${brand.name}`}
      data-testid="star-login-dialog"
      className="star-login-screen"
      onKeyDown={keepTabInside}
    >
      <div className="star-login-titlebar" data-desktop-drag-region>
        <WindowControls />
      </div>
      <div className="star-login-body">
        <StarLogoCard animate={pageVisible} />
        <main className="star-login-main">
          <div className="star-login-column">
            <div className="star-login-brand">
              <BrandSeal size="md" />
              <span>{brand.agent}</span>
            </div>
            <h1 className="text-[26px] font-semibold leading-tight text-[var(--color-text-primary)]">欢迎登录</h1>

            {notConfigured ? (
              <div role="alert" className="mt-5 rounded-[var(--radius-lg)] border border-[var(--color-warning)] px-4 py-3 text-[13px] leading-5 text-[var(--color-text-secondary)]">
                未找到 {brand.name} 应用配置（star-product.json），暂时无法登录。请联系管理员。
              </div>
            ) : null}

            {status?.starWorkSignInAvailable ? (
              <>
                <button
                  type="button"
                  disabled={busy !== null}
                  onClick={signInWithStarWork}
                  className={`mt-8 flex h-12 w-full items-center justify-center gap-2 rounded-full text-[14px] font-semibold transition-colors disabled:opacity-60 ${PILL_PRIMARY} ${FOCUS_RING}`}
                >
                  {busy === 'starwork'
                    ? <Loader2 size={16} strokeWidth={1.75} className="animate-spin" aria-hidden="true" />
                    : <MonitorSmartphone size={16} strokeWidth={1.75} aria-hidden="true" />}
                  使用本机 STAR Work 的登录
                </button>
                <div className="my-5 flex items-center gap-3 whitespace-nowrap text-[12px] text-[var(--color-text-tertiary)]">
                  <span className="h-px flex-1 bg-[var(--color-border)]" />
                  或使用其他方式登录
                  <span className="h-px flex-1 bg-[var(--color-border)]" />
                </div>
              </>
            ) : null}

            <form noValidate onSubmit={submit} className={`flex flex-col gap-3.5 ${status?.starWorkSignInAvailable ? '' : 'mt-8'}`}>
              <div role="tablist" aria-label="登录方式" className="mb-1 flex gap-1 rounded-full bg-[var(--color-surface-container)] p-1">
                {(['code', 'password'] as const).map(item => (
                  <button
                    key={item}
                    type="button"
                    role="tab"
                    aria-selected={item === tab}
                    onClick={() => switchTab(item)}
                    className={`h-10 min-w-0 flex-1 truncate rounded-full px-3 text-[14px] transition-colors ${FOCUS_RING} ${item === tab
                      ? 'bg-[var(--color-surface)] font-semibold text-[var(--color-text-primary)] shadow-sm'
                      : 'text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]'}`}
                  >
                    {TAB_LABEL[item]}
                  </button>
                ))}
              </div>

              <input
                ref={accountRef}
                className={PILL_INPUT}
                type="text"
                autoComplete="username"
                autoCapitalize="off"
                spellCheck={false}
                aria-label={accountPlaceholder}
                placeholder={accountPlaceholder}
                value={account}
                onChange={(event) => { setAccount(event.target.value); edited() }}
              />

              {tab === 'code' ? (
                <div className="flex min-w-0 gap-2.5">
                  <input
                    ref={codeRef}
                    className={`${PILL_INPUT} flex-1`}
                    type="text"
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    aria-label="6位验证码"
                    placeholder="6位验证码"
                    value={code}
                    onChange={(event) => { setCode(normalizeStarLoginCode(event.target.value)); edited() }}
                  />
                  <button
                    type="button"
                    disabled={busy !== null || cooldown.left > 0}
                    onClick={() => void sendCode()}
                    className={`h-12 min-w-[7.5em] shrink-0 whitespace-nowrap rounded-full bg-[var(--color-surface-container-high)] px-4 text-[13px] tabular-nums text-[var(--color-text-primary)] transition-colors hover:bg-[var(--color-surface-hover)] disabled:cursor-default disabled:text-[var(--color-text-tertiary)] disabled:hover:bg-[var(--color-surface-container-high)] ${FOCUS_RING}`}
                  >
                    {starSendCodeLabelOf(cooldown.left, busy === 'code')}
                  </button>
                </div>
              ) : (
                <input
                  className={PILL_INPUT}
                  type="password"
                  autoComplete="current-password"
                  aria-label="密码"
                  placeholder="密码"
                  value={password}
                  onChange={(event) => { setPassword(event.target.value); edited() }}
                />
              )}

              {tab === 'code' && inviteOpen ? (
                <input
                  ref={inviteRef}
                  className={PILL_INPUT}
                  type="text"
                  autoComplete="off"
                  spellCheck={false}
                  aria-label="邀请码（选填）"
                  placeholder="邀请码（选填，新账号有效）"
                  value={inviteCode}
                  onChange={(event) => { setInviteCode(event.target.value); edited() }}
                />
              ) : null}

              {tab === 'code' ? (
                <div className="-mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[12px] leading-[18px] text-[var(--color-text-tertiary)]">
                  {inviteOpen ? null : (
                    <button type="button" onClick={openInvite} className={`rounded-[var(--radius-xs)] hover:text-[var(--color-text-primary)] hover:underline hover:underline-offset-[3px] ${FOCUS_RING}`}>有邀请码？</button>
                  )}
                  <span className="ml-auto text-right">未注册的手机号或邮箱将自动创建账号</span>
                </div>
              ) : null}

              <button
                type="submit"
                aria-disabled={!canSubmit}
                aria-busy={busy === 'login'}
                className={`mt-1.5 flex h-12 w-full items-center justify-center gap-2 rounded-full text-[15px] font-semibold transition-colors ${canSubmit ? PILL_PRIMARY : PILL_MUTED} ${FOCUS_RING}`}
              >
                {busy === 'login' ? <Loader2 size={16} strokeWidth={1.75} className="animate-spin" aria-hidden="true" /> : null}
                登录
              </button>
            </form>

            <div className="relative mt-5 flex items-start gap-2 text-[13px] leading-5 text-[var(--color-text-secondary)]">
              <input
                ref={agreeRef}
                id={agreeId}
                type="checkbox"
                className="peer absolute left-0 top-0.5 h-4 w-4 opacity-0"
                aria-label="我已阅读并同意《用户协议》《隐私政策》"
                checked={agreed}
                onChange={(event) => {
                  setAgreed(event.target.checked)
                  if (event.target.checked && message?.text === STAR_LOGIN_AGREEMENT_HINT) setMessage(null)
                }}
              />
              {/* The key replays the nudge on every early 登录. */}
              <label
                key={attention}
                htmlFor={agreeId}
                aria-hidden="true"
                className={`mt-0.5 flex h-4 w-4 shrink-0 cursor-pointer items-center justify-center rounded-full border-[1.5px] transition-colors peer-focus-visible:ring-2 peer-focus-visible:ring-[var(--color-border-focus)] ${agreed
                  ? 'border-[var(--color-text-primary)] bg-[var(--color-text-primary)] text-[var(--color-surface)]'
                  : 'border-[var(--color-text-tertiary)] hover:border-[var(--color-text-secondary)]'} ${attention > 0 ? 'star-login-nudge' : ''}`}
              >
                {agreed ? <Check size={11} strokeWidth={1.75} aria-hidden="true" /> : null}
              </label>
              <span className="min-w-0">
                <label htmlFor={agreeId} className="cursor-pointer">我已阅读并同意</label>
                <button type="button" className={DOC_BUTTON} onClick={() => setOpenDoc('terms')}>《用户协议》</button>
                <button type="button" className={DOC_BUTTON} onClick={() => setOpenDoc('privacy')}>《隐私政策》</button>
              </span>
            </div>

            {message ? (
              <div
                role={message.kind === 'error' ? 'alert' : 'status'}
                className={`mt-3 text-[13px] leading-5 [overflow-wrap:anywhere] ${message.kind === 'error' ? 'text-[var(--color-error)]' : 'text-[var(--color-text-secondary)]'}`}
              >
                {message.text}
              </div>
            ) : null}

            <div className="mt-4">
              <Switch size="sm" checked={activate} onChange={setActivate} label={`登录后把 ${brand.name} 设为默认对话模型`} />
            </div>

            <div className="mt-7 flex justify-center">
              <button type="button" onClick={onClose} className={`rounded-[var(--radius-xs)] text-[12px] text-[var(--color-text-tertiary)] hover:text-[var(--color-text-primary)] hover:underline hover:underline-offset-[3px] ${FOCUS_RING}`}>
                暂不登录
              </button>
            </div>
          </div>
        </main>
      </div>
      {openDoc ? (
        <StarLegalDialog title={LEGAL_TITLE[openDoc]} doc={legal[openDoc]} state={legal.state} onClose={() => setOpenDoc(null)} />
      ) : null}
    </div>,
    document.body,
  )
}
