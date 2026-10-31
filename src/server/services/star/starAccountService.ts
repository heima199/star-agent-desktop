/**
 * STAR account: sign-in, profile / plan / credits, relay key and the managed
 * provider record that routes chat through the account.
 *
 * Chat stays on cc-haha's normal provider path: the account becomes one saved
 * provider (`presetId: star-saas`, OpenAI chat format) pointing at the relay
 * `{base}/api/v1` with the user's relay key. Session start, permissions, tool
 * rendering and reconnects are untouched.
 */

import { ProviderService } from '../providerService.js'
import type { ModelMapping, SavedProvider } from '../../types/provider.js'
import { StarApiError, starRequest } from './starClient.js'
import { currentStarBrandName } from './starBrand.js'
import {
  pickStarModel,
  readStarCatalog,
  refreshStarCatalog,
  STAR_PREFERRED_CHAT_MODELS,
  STAR_PREFERRED_FAST_MODELS,
  type StarCatalog,
} from './starCatalog.js'
import {
  loadStarSettings,
  STAR_PRESET_ID,
  STAR_PROVIDER_NAME,
  STAR_RELAY_KEY_NAME,
  starRelayBaseUrl,
} from './starConfig.js'
import {
  clearStarSession,
  findStarWorkTokens,
  normalizeStarUser,
  readStarSession,
  updateStarSession,
  writeStarSession,
  type StarSession,
  type StarUser,
} from './starSession.js'

export type StarQuota = {
  planName: string
  planTier: 'free' | 'paid'
  credits: number | null
  expiresAt: number | null
  normal?: { quota: number; used: number; period?: string; resetAt?: string }
  premium?: { quota: number; used: number; period?: string; resetAt?: string }
  checkin?: { checked: boolean; times: number; credits: number }
}

export type StarStatus = {
  configured: boolean
  baseUrl: string
  signedIn: boolean
  user: StarUser | null
  provider: {
    id: string | null
    active: boolean
    relayReady: boolean
    mainModel: string | null
  }
  catalog: {
    fetchedAt: number | null
    chatModels: number
    imageModels: number
    videoModels: number
  }
  starWorkSignInAvailable: boolean
  /** The console's product name (normalized, STAR by default); the UI shows "X Agent", "登录 X 账号". */
  brandName: string
}

const PHONE_RE = /^1\d{10}$/
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

const providers = new ProviderService()

export function classifyStarAccount(raw: string): { kind: 'phone' | 'email'; value: string } {
  const value = raw.trim()
  if (PHONE_RE.test(value)) return { kind: 'phone', value }
  if (EMAIL_RE.test(value)) return { kind: 'email', value: value.toLowerCase() }
  throw new StarApiError('请输入 11 位手机号或邮箱', 400, 'STAR_BAD_ACCOUNT')
}

function tokenFrom(payload: unknown): string {
  if (!payload || typeof payload !== 'object') return ''
  const record = payload as Record<string, unknown>
  const token = record.token ?? record.accessToken ?? record.access_token
  return typeof token === 'string' ? token.trim() : ''
}

function num(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim() && Number.isFinite(Number(value))) return Number(value)
  return null
}

export async function sendStarLoginCode(account: string): Promise<void> {
  const { kind, value } = classifyStarAccount(account)
  if (kind === 'email') {
    await starRequest('POST', '/desktop/auth/email/code', { body: { email: value } })
  } else {
    await starRequest('POST', '/auth/send-sms-code', { body: { phone: value } })
  }
}

export async function loginStar(input: {
  account: string
  code?: string
  password?: string
  inviteCode?: string
  /** Make STAR the active model provider after sign-in (the dialog asks the user). */
  activate?: boolean
}): Promise<StarStatus> {
  const { kind, value } = classifyStarAccount(input.account)
  const code = input.code?.trim() ?? ''
  const password = input.password ?? ''
  if (!code && !password) throw new StarApiError('请输入验证码或密码', 400, 'STAR_BAD_CREDENTIALS')
  if (kind === 'phone' && !code) throw new StarApiError('手机号请使用验证码登录', 400, 'STAR_BAD_CREDENTIALS')
  const attribution = input.inviteCode?.trim() ? { inviteCode: input.inviteCode.trim() } : {}
  const payload = kind === 'email'
    ? await starRequest('POST', '/desktop/auth/login', {
        body: { email: value, ...(code ? { code } : { password }), ...attribution },
      })
    : await starRequest('POST', '/auth/login-by-phone', {
        body: { phone: value, code, ...attribution },
      })
  const token = tokenFrom(payload)
  if (!token) throw new StarApiError('登录没有返回凭证', 502, 'STAR_NO_TOKEN')
  const user = normalizeStarUser((payload as Record<string, unknown>).user)
  return adoptStarToken(token, user, code ? (kind === 'email' ? 'email-code' : 'phone-code') : 'password', input.activate === true)
}

/** Sign in with a token the STAR Work desktop already holds on this machine. */
export async function loginStarWithStarWork(options: { activate?: boolean } = {}): Promise<StarStatus> {
  const tokens = findStarWorkTokens()
  if (!tokens.length) throw new StarApiError('这台电脑上没有找到 STAR Work 的登录信息', 404, 'STAR_WORK_NOT_FOUND')
  let lastError: unknown = null
  for (const token of tokens.slice(0, 4)) {
    try {
      const profile = await starRequest('GET', '/auth/profile', { token, timeoutMs: 15_000 })
      return await adoptStarToken(token, normalizeStarUser(profile), 'starwork-import', options.activate === true)
    } catch (error) {
      lastError = error
    }
  }
  throw lastError instanceof StarApiError && lastError.status !== 401
    ? lastError
    : new StarApiError('STAR Work 的登录已失效，请用验证码登录', 401, 'STAR_WORK_EXPIRED')
}

async function adoptStarToken(token: string, user: StarUser, method: StarSession['method'], activate: boolean): Promise<StarStatus> {
  const previous = readStarSession()
  const sameUser = previous && previous.user.id && previous.user.id === user.id
  writeStarSession({
    token,
    user,
    signedInAt: Date.now(),
    method,
    ...(sameUser && previous?.relayKey ? { relayKey: previous.relayKey, relayKeyId: previous.relayKeyId } : {}),
    ...(previous?.providerId ? { providerId: previous.providerId } : {}),
  })
  // Never switch the default provider behind the user's back: sessions keep
  // their current model unless the sign-in dialog's "use STAR" box is ticked.
  await connectStarAccount({ activate: activate ? 'always' : 'never' })
  return getStarStatus()
}

/** Make sure this account has a relay key; created once and kept in the session file. */
export async function ensureStarRelayKey(options: { force?: boolean } = {}): Promise<string> {
  const session = readStarSession()
  if (!session) throw new StarApiError('请先登录 STAR 账号', 401, 'STAR_SIGNED_OUT')
  if (session.relayKey && !options.force) return session.relayKey
  const payload = await starRequest<Record<string, unknown>>('POST', '/user-api-keys/ensure', {
    token: session.token,
    body: { name: STAR_RELAY_KEY_NAME, remark: 'cc-haha desktop chat' },
    timeoutMs: 20_000,
  })
  const key = String(payload?.token ?? payload?.key ?? '').trim()
  if (!key.startsWith('sk-')) throw new StarApiError('没有拿到对话中转密钥，请稍后重试', 502, 'STAR_NO_RELAY_KEY')
  updateStarSession({ relayKey: key, ...(typeof payload?.id === 'string' ? { relayKeyId: payload.id } : {}) })
  return key
}

function contextWindows(catalog: StarCatalog | null): Record<string, number> {
  const result: Record<string, number> = {}
  for (const model of catalog?.chat ?? []) {
    if (model.contextWindow && model.contextWindow >= 16_000 && model.contextWindow <= 10_000_000) {
      result[model.id] = model.contextWindow
    }
  }
  return result
}

function defaultMapping(catalog: StarCatalog | null): ModelMapping {
  const main = pickStarModel(catalog, STAR_PREFERRED_CHAT_MODELS) ?? 'claude-sonnet-5.5'
  const fast = pickStarModel(catalog, STAR_PREFERRED_FAST_MODELS) ?? main
  const opus = pickStarModel(catalog, ['claude-opus-5', 'claude-opus-4.8', 'gpt-5.5', main]) ?? main
  return { main, fable: main, sonnet: main, opus, haiku: fast }
}

/** Keep slot mappings the user picked when those models still exist. */
function mergeMapping(current: ModelMapping | undefined, catalog: StarCatalog | null): ModelMapping {
  const fallback = defaultMapping(catalog)
  if (!current) return fallback
  const ids = new Set(catalog?.chat.map(model => model.id) ?? [])
  const keep = (value: string | undefined, alt: string) => (value && (!ids.size || ids.has(value)) ? value : alt)
  return {
    main: keep(current.main, fallback.main),
    fable: keep(current.fable, fallback.fable ?? fallback.main),
    sonnet: keep(current.sonnet, fallback.sonnet),
    opus: keep(current.opus, fallback.opus),
    haiku: keep(current.haiku, fallback.haiku),
  }
}

export async function findStarProvider(): Promise<SavedProvider | null> {
  const index = await providers.listProviders()
  const session = readStarSession()
  return index.providers.find(provider => provider.id === session?.providerId)
    ?? index.providers.find(provider => provider.presetId === STAR_PRESET_ID)
    ?? null
}

/**
 * After sign-in (and on refresh): sync the catalog, ensure the relay key and
 * upsert the STAR provider. `activate: 'if-new'` switches the desktop to STAR
 * only when the provider record was just created.
 */
export async function connectStarAccount(options: { activate?: 'if-new' | 'always' | 'never'; forceCatalog?: boolean } = {}): Promise<{ providerId: string; created: boolean }> {
  const session = readStarSession()
  if (!session) throw new StarApiError('请先登录 STAR 账号', 401, 'STAR_SIGNED_OUT')
  const catalog = await refreshStarCatalog({ force: options.forceCatalog }).catch(() => readStarCatalog())
  const relayKey = await ensureStarRelayKey()
  const existing = await findStarProvider()
  const fields = {
    name: STAR_PROVIDER_NAME,
    apiKey: relayKey,
    authStrategy: 'api_key' as const,
    baseUrl: starRelayBaseUrl(loadStarSettings()),
    apiFormat: 'openai_chat' as const,
    models: mergeMapping(existing?.models, catalog),
    modelContextWindows: contextWindows(catalog),
    notes: 'STAR 账号模型：对话经账号中转计费，登录后自动同步模型列表。',
  }
  let providerId: string
  let created = false
  if (existing) {
    const updated = await providers.updateProvider(existing.id, fields)
    providerId = updated.id
  } else {
    const added = await providers.addProvider({ presetId: STAR_PRESET_ID, runtimeKind: 'anthropic_compatible', ...fields })
    providerId = added.id
    created = true
  }
  if (session.providerId !== providerId) updateStarSession({ providerId })
  const activate = options.activate ?? 'never'
  if (activate === 'always' || (activate === 'if-new' && created)) {
    await providers.activateProvider(providerId)
  }
  return { providerId, created }
}

export async function activateStarProvider(): Promise<StarStatus> {
  const { providerId } = await connectStarAccount({ activate: 'never' })
  await providers.activateProvider(providerId)
  return getStarStatus()
}

export async function logoutStar(): Promise<StarStatus> {
  clearStarSession()
  // The provider record stays (it holds the user's slot choices) but its key
  // is cleared so a signed-out desktop never bills the previous account.
  const provider = await findStarProvider()
  if (provider) await providers.updateProvider(provider.id, { apiKey: '' }).catch(() => undefined)
  return getStarStatus()
}

export async function getStarProfile(): Promise<StarUser> {
  const session = readStarSession()
  if (!session) throw new StarApiError('请先登录 STAR 账号', 401, 'STAR_SIGNED_OUT')
  const profile = normalizeStarUser(await starRequest('GET', '/auth/profile', { token: session.token, timeoutMs: 15_000 }))
  if (profile.id) updateStarSession({ user: profile })
  return profile
}

function parseExpire(plan: Record<string, unknown>): number | null {
  const raw = plan.expiresAt ?? plan.expireAt ?? plan.endAt ?? plan.endDate ?? plan.expiredAt
  if (raw === null || raw === undefined || raw === '') return null
  const ts = typeof raw === 'number' ? (raw < 1e12 ? raw * 1000 : raw) : Date.parse(String(raw))
  return Number.isFinite(ts) ? ts : null
}

function usage(raw: unknown): StarQuota['normal'] {
  if (!raw || typeof raw !== 'object') return undefined
  const record = raw as Record<string, unknown>
  const quota = num(record.quota)
  const used = num(record.used)
  if (quota === null || used === null) return undefined
  return {
    quota,
    used,
    ...(typeof record.period === 'string' ? { period: record.period } : {}),
    ...(typeof record.resetAt === 'string' ? { resetAt: record.resetAt } : {}),
  }
}

export async function getStarQuota(): Promise<StarQuota> {
  const session = readStarSession()
  if (!session) throw new StarApiError('请先登录 STAR 账号', 401, 'STAR_SIGNED_OUT')
  const raw = await starRequest<Record<string, unknown>>('GET', '/subscription/quota', { token: session.token, timeoutMs: 15_000 })
  const plan = raw?.plan && typeof raw.plan === 'object' ? raw.plan as Record<string, unknown> : {}
  const credits = raw?.credits && typeof raw.credits === 'object' ? raw.credits as Record<string, unknown> : { remaining: raw?.credits }
  const name = String(plan.name ?? plan.planName ?? plan.title ?? '').trim()
  // An active subscription means a paid plan; without one, only the name can tell.
  const subscribed = Boolean(raw?.subscription && typeof raw.subscription === 'object')
  const free = !subscribed && (!name || /体验|免费|free|trial/i.test(name))
  const checkin = raw?.checkin && typeof raw.checkin === 'object' ? raw.checkin as Record<string, unknown> : null
  return {
    planName: name || '体验版',
    planTier: free ? 'free' : 'paid',
    credits: num(credits.remaining ?? credits.balance ?? credits.total),
    expiresAt: parseExpire(subscribed ? raw.subscription as Record<string, unknown> : plan),
    ...(usage(raw?.normalModel) ? { normal: usage(raw?.normalModel) } : {}),
    ...(usage(raw?.premiumModel) ? { premium: usage(raw?.premiumModel) } : {}),
    ...(checkin
      ? { checkin: { checked: Boolean(checkin.checked), times: num(checkin.times) ?? 0, credits: num(checkin.credits) ?? 0 } }
      : {}),
  }
}

export async function getStarStatus(): Promise<StarStatus> {
  const settings = loadStarSettings()
  const session = readStarSession()
  const catalog = readStarCatalog()
  const provider = await findStarProvider().catch(() => null)
  const index = await providers.listProviders().catch(() => null)
  const brandName = await currentStarBrandName()
  return {
    configured: settings.configured,
    baseUrl: settings.baseUrl,
    signedIn: Boolean(session),
    user: session?.user ?? null,
    provider: {
      id: provider?.id ?? null,
      active: Boolean(provider && index?.activeId === provider.id),
      relayReady: Boolean(session?.relayKey && provider?.apiKey),
      mainModel: provider?.models.main ?? null,
    },
    catalog: {
      fetchedAt: catalog?.fetchedAt ?? null,
      chatModels: catalog?.chat.length ?? 0,
      imageModels: catalog?.image.length ?? 0,
      videoModels: catalog?.video.length ?? 0,
    },
    starWorkSignInAvailable: findStarWorkTokens().length > 0,
    brandName,
  }
}

export async function starCheckin(): Promise<unknown> {
  const session = readStarSession()
  if (!session) throw new StarApiError('请先登录 STAR 账号', 401, 'STAR_SIGNED_OUT')
  return starRequest('POST', '/desktop/checkin', { token: session.token, body: {} })
}

export async function starRedeem(code: string): Promise<unknown> {
  const session = readStarSession()
  if (!session) throw new StarApiError('请先登录 STAR 账号', 401, 'STAR_SIGNED_OUT')
  if (!code.trim()) throw new StarApiError('请输入兑换码', 400, 'STAR_BAD_CODE')
  return starRequest('POST', '/desktop/device/redeem', {
    token: session.token,
    body: { code: code.trim(), deviceId: 'cc-haha-local', deviceName: 'cc-haha 桌面端' },
  })
}

export async function starFeedback(input: { category?: string; message: string; contact?: string; appVersion?: string }): Promise<unknown> {
  const session = readStarSession()
  const message = input.message.trim()
  if (!message) throw new StarApiError('请填写反馈内容', 400, 'STAR_BAD_FEEDBACK')
  const category = ['bug', 'feature', 'other'].includes(String(input.category)) ? input.category : 'other'
  return starRequest('POST', '/desktop/feedback', {
    token: session?.token,
    body: { category, message, contact: input.contact?.trim() ?? '', appVersion: input.appVersion?.trim() || 'cc-haha' },
  })
}

/** Plans, credit packs and payment methods for the upgrade dialog. */
export async function getStarPlans(): Promise<{ plans: unknown[]; creditPacks: unknown[]; paymentMethods: unknown }> {
  const optional = async (path: string) => starRequest('GET', path, { timeoutMs: 15_000 }).catch(() => null)
  const [plans, creditPacks, paymentMethods] = await Promise.all([
    optional('/subscription/plans'),
    optional('/subscription/credit-packs'),
    optional('/payment/methods'),
  ])
  return {
    plans: Array.isArray(plans) ? plans : [],
    creditPacks: Array.isArray(creditPacks) ? creditPacks : [],
    paymentMethods: paymentMethods ?? {},
  }
}

function payUrl(payload: unknown): string | null {
  if (!payload || typeof payload !== 'object') return null
  const record = payload as Record<string, unknown>
  for (const key of ['payUrl', 'url', 'paymentUrl', 'cashierUrl', 'codeUrl']) {
    const value = record[key]
    if (typeof value === 'string' && /^https?:\/\//i.test(value.trim())) return value.trim()
  }
  return null
}

export async function createStarOrder(input: {
  kind: 'plan' | 'credits'
  id: string
  billingCycle?: string
  payType?: string
  /** Seats of a team plan (个人版 is always 1). */
  quantity?: number
}): Promise<{ payUrl: string | null; raw: unknown }> {
  const session = readStarSession()
  if (!session) throw new StarApiError('请先登录 STAR 账号', 401, 'STAR_SIGNED_OUT')
  const payType = input.payType === 'wxpay' ? 'wxpay' : 'alipay'
  const raw = input.kind === 'plan'
    ? await starRequest('POST', '/payment/create', {
        token: session.token,
        body: {
          planId: input.id,
          billingCycle: input.billingCycle || 'monthly',
          payType,
          ...(input.quantity && input.quantity > 1 ? { quantity: Math.min(500, Math.round(input.quantity)) } : {}),
        },
      })
    : await starRequest('POST', '/payment/create-credit-pack-order', {
        token: session.token,
        body: { creditPackId: input.id, payType, quantity: 1, frontendOrigin: loadStarSettings().baseUrl },
      })
  return { payUrl: payUrl(raw), raw }
}
