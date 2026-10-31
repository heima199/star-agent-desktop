import { afterEach, describe, expect, it } from 'vitest'
import type { StarLegalDocument } from '../../api/star'
import {
  STAR_LOGIN_AGREED_STORAGE_KEY,
  canSubmitStarLogin,
  normalizeStarLoginCode,
  pickStarLegalDocs,
  readStarLoginAgreed,
  rememberStarLoginAgreed,
  starAccountKindOf,
  starCodeAccountProblemOf,
  starCodeSentNoticeOf,
  starLegalDocDateOf,
  starLoginProblemOf,
  starLoginRequestOf,
  starSendCodeLabelOf,
  type StarLoginDraft,
} from './starLoginForm'

const CODE_DRAFT: StarLoginDraft = { tab: 'code', account: ' 13800138000 ', code: '123456', password: '', inviteCode: '' }
const PASSWORD_DRAFT: StarLoginDraft = { tab: 'password', account: 'me@example.test', code: '', password: 'secret', inviteCode: '' }

function doc(id: string, title: string): StarLegalDocument {
  return { id, title, bodyHtml: '', body: `${title} 正文`, updatedAt: 0 }
}

describe('starLoginForm', () => {
  afterEach(() => window.localStorage.removeItem(STAR_LOGIN_AGREED_STORAGE_KEY))

  it('tells an 11-digit phone from an email, and neither from anything else', () => {
    expect(starAccountKindOf(' 13800138000 ')).toBe('phone')
    expect(starAccountKindOf('me@example.test')).toBe('email')
    expect(starAccountKindOf('1380013800')).toBeNull()
    expect(starAccountKindOf('me@example')).toBeNull()
    expect(starCodeAccountProblemOf('')).toBe('请输入手机号或邮箱')
    expect(starCodeAccountProblemOf('12345')).toBe('请输入 11 位手机号或邮箱')
    expect(starCodeAccountProblemOf('me@example.test')).toBeNull()
  })

  it('keeps six digits of a pasted code', () => {
    expect(normalizeStarLoginCode('验证码：123456')).toBe('123456')
    expect(normalizeStarLoginCode('12 34 56 78')).toBe('123456')
  })

  it('names what 验证码登录 still lacks', () => {
    expect(starLoginProblemOf({ ...CODE_DRAFT, account: '' })).toBe('请输入手机号或邮箱')
    expect(starLoginProblemOf({ ...CODE_DRAFT, code: '12345' })).toBe('请输入 6 位验证码')
    expect(starLoginProblemOf(CODE_DRAFT)).toBeNull()
  })

  it('keeps 密码登录 to email accounts, the only kind the service signs in by password', () => {
    expect(starLoginProblemOf({ ...PASSWORD_DRAFT, account: '13800138000' })).toBe('手机号请使用验证码登录')
    expect(starLoginProblemOf({ ...PASSWORD_DRAFT, account: 'me@' })).toBe('请输入正确的邮箱')
    expect(starLoginProblemOf({ ...PASSWORD_DRAFT, account: '' })).toBe('请输入邮箱')
    expect(starLoginProblemOf({ ...PASSWORD_DRAFT, password: '' })).toBe('请输入密码')
    expect(starLoginProblemOf(PASSWORD_DRAFT)).toBeNull()
  })

  it('needs the agreement before 登录 is live', () => {
    expect(canSubmitStarLogin(CODE_DRAFT, false)).toBe(false)
    expect(canSubmitStarLogin(CODE_DRAFT, true)).toBe(true)
    expect(canSubmitStarLogin({ ...CODE_DRAFT, code: '' }, true)).toBe(false)
  })

  it('builds the sign-in request of a complete form; the invite code only counts for code sign-in', () => {
    expect(starLoginRequestOf({ ...CODE_DRAFT, inviteCode: ' FRIEND ' }, true))
      .toEqual({ account: '13800138000', code: '123456', inviteCode: 'FRIEND', activate: true })
    expect(starLoginRequestOf({ ...PASSWORD_DRAFT, inviteCode: 'FRIEND' }, false))
      .toEqual({ account: 'me@example.test', password: 'secret', activate: false })
    expect(starLoginRequestOf({ ...CODE_DRAFT, code: '' }, true)).toBeNull()
  })

  it('labels 发送验证码 while idle, sending and cooling down', () => {
    expect(starSendCodeLabelOf(0, false)).toBe('发送验证码')
    expect(starSendCodeLabelOf(0, true)).toBe('发送中…')
    expect(starSendCodeLabelOf(59, false)).toBe('59 秒后重发')
    expect(starCodeSentNoticeOf('phone')).toBe('验证码已发送，请查收短信')
    expect(starCodeSentNoticeOf('email')).toBe('验证码已发送，请查收邮件')
  })

  it('picks 用户协议 and 隐私政策 by title, then by id, and never the same document twice', () => {
    const terms = doc('a1', '用户服务协议')
    const privacy = doc('b2', '隐私政策')
    expect(pickStarLegalDocs([privacy, terms])).toEqual({ terms, privacy })
    const byId = pickStarLegalDocs([doc('terms', 'Terms'), doc('privacy', 'Privacy')])
    expect(byId.terms?.id).toBe('terms')
    expect(byId.privacy?.id).toBe('privacy')
    const combined = doc('c3', '用户协议与隐私政策')
    expect(pickStarLegalDocs([combined])).toEqual({ terms: null, privacy: combined })
    expect(pickStarLegalDocs([])).toEqual({ terms: null, privacy: null })
  })

  it('dates a document only when it carries a date', () => {
    expect(starLegalDocDateOf(0)).toBe('')
    expect(starLegalDocDateOf(Number.NaN)).toBe('')
    expect(starLegalDocDateOf(new Date(2026, 9, 30, 12).getTime())).toBe('2026 年 10 月 30 日更新')
  })

  it('remembers the accepted agreement on this machine', () => {
    expect(readStarLoginAgreed()).toBe(false)
    rememberStarLoginAgreed()
    expect(window.localStorage.getItem(STAR_LOGIN_AGREED_STORAGE_KEY)).toBe('1')
    expect(readStarLoginAgreed()).toBe(true)
  })
})
