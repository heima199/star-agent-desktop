import type { StarLegalDocument } from '../../api/star'

/**
 * Rules of the STAR sign-in form (StarLoginScreen):
 *  - 验证码登录 takes one 「手机号或邮箱」 field: an 11-digit phone gets an SMS
 *    code, anything else an email code. An account that does not exist yet is
 *    created by the service on the first code sign-in.
 *  - 密码登录 is email only: the service signs phones in by code.
 *  - 「登录」 needs the form complete and 用户协议 / 隐私政策 accepted.
 */

export type StarLoginTab = 'code' | 'password'
export type StarAccountKind = 'phone' | 'email'

/** The service sends 6-digit codes, by SMS and by email. */
export const STAR_LOGIN_CODE_LENGTH = 6
/** Seconds before another code can be sent; the service limits sends per minute. */
export const STAR_LOGIN_CODE_COOLDOWN_SECONDS = 60

const PHONE_RE = /^1\d{10}$/
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const CODE_RE = /^\d{6}$/

export function starAccountKindOf(account: string): StarAccountKind | null {
  const value = account.trim()
  if (PHONE_RE.test(value)) return 'phone'
  return EMAIL_RE.test(value) ? 'email' : null
}

/** Digits only, at most six: pasting 「验证码：123456」 still works. */
export function normalizeStarLoginCode(value: string): string {
  return value.replace(/\D/g, '').slice(0, STAR_LOGIN_CODE_LENGTH)
}

export type StarLoginDraft = {
  tab: StarLoginTab
  account: string
  code: string
  password: string
  /** Only counts for an account the code sign-in creates. */
  inviteCode: string
}

/** Why a code cannot be sent to this account yet; null when it can. */
export function starCodeAccountProblemOf(account: string): string | null {
  if (starAccountKindOf(account)) return null
  return account.trim() ? '请输入 11 位手机号或邮箱' : '请输入手机号或邮箱'
}

/** What the form still lacks (shown when 登录 is pressed early); null when complete. */
export function starLoginProblemOf(draft: StarLoginDraft): string | null {
  if (draft.tab === 'code') {
    return starCodeAccountProblemOf(draft.account) ?? (CODE_RE.test(draft.code.trim()) ? null : '请输入 6 位验证码')
  }
  const kind = starAccountKindOf(draft.account)
  if (kind === 'phone') return '手机号请使用验证码登录'
  if (!kind) return draft.account.trim() ? '请输入正确的邮箱' : '请输入邮箱'
  return draft.password ? null : '请输入密码'
}

/** 「登录」 is live once the form is complete and the agreement is ticked. */
export function canSubmitStarLogin(draft: StarLoginDraft, agreed: boolean): boolean {
  return agreed && starLoginProblemOf(draft) === null
}

export type StarLoginRequest = { account: string; code?: string; password?: string; inviteCode?: string; activate: boolean }

/** The sign-in request of a complete form; null while something is missing. */
export function starLoginRequestOf(draft: StarLoginDraft, activate: boolean): StarLoginRequest | null {
  if (starLoginProblemOf(draft) !== null) return null
  const inviteCode = draft.tab === 'code' ? draft.inviteCode.trim() : ''
  return {
    account: draft.account.trim(),
    ...(draft.tab === 'code' ? { code: draft.code.trim() } : { password: draft.password }),
    ...(inviteCode ? { inviteCode } : {}),
    activate,
  }
}

/** 「发送验证码」 while idle, 「发送中…」 while sending, 「59 秒后重发」 while cooling down. */
export function starSendCodeLabelOf(secondsLeft: number, sending: boolean): string {
  if (sending) return '发送中…'
  return secondsLeft > 0 ? `${secondsLeft} 秒后重发` : '发送验证码'
}

export function starCodeSentNoticeOf(kind: StarAccountKind): string {
  return kind === 'phone' ? '验证码已发送，请查收短信' : '验证码已发送，请查收邮件'
}

// ─── 用户协议 / 隐私政策 ─────────────────────────────────────

const TERMS_TITLE_RE = /用户协议|服务协议|服务条款|使用条款/
const PRIVACY_TITLE_RE = /隐私/
const TERMS_IDS = new Set(['terms', 'tos', 'agreement', 'user-agreement', 'service'])
const PRIVACY_IDS = new Set(['privacy', 'privacy-policy'])

/** The user agreement and the privacy policy among the published documents (by title, then id); null when not published. */
export function pickStarLegalDocs(docs: readonly StarLegalDocument[]): { terms: StarLegalDocument | null; privacy: StarLegalDocument | null } {
  const privacy = docs.find(doc => PRIVACY_TITLE_RE.test(doc.title))
    ?? docs.find(doc => PRIVACY_IDS.has(doc.id.toLowerCase()))
    ?? null
  const terms = docs.find(doc => doc !== privacy && TERMS_TITLE_RE.test(doc.title) && !PRIVACY_TITLE_RE.test(doc.title))
    ?? docs.find(doc => doc !== privacy && TERMS_IDS.has(doc.id.toLowerCase()))
    ?? null
  return { terms, privacy }
}

/** 「2026 年 10 月 30 日更新」 under a document's title; empty without a date. */
export function starLegalDocDateOf(updatedAt: number): string {
  if (!Number.isFinite(updatedAt) || updatedAt <= 0) return ''
  const date = new Date(updatedAt)
  return `${date.getFullYear()} 年 ${date.getMonth() + 1} 月 ${date.getDate()} 日更新`
}

// ─── 已同意协议 (remembered per machine after a successful sign-in) ───

export const STAR_LOGIN_AGREED_STORAGE_KEY = 'cc-haha.star.loginAgreed'

export function readStarLoginAgreed(): boolean {
  try {
    return window.localStorage.getItem(STAR_LOGIN_AGREED_STORAGE_KEY) === '1'
  } catch {
    return false
  }
}

export function rememberStarLoginAgreed(): void {
  try {
    window.localStorage.setItem(STAR_LOGIN_AGREED_STORAGE_KEY, '1')
  } catch {
    // Private storage unavailable: the box starts unticked next time.
  }
}
