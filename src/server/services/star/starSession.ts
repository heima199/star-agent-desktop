/**
 * The signed-in STAR account, stored at `<config>/cc-haha/star/session.json`.
 *
 * Sync file access on purpose: the file is tiny, and the MCP tool handlers and
 * the session model catalog read it on hot paths without awaiting the server.
 */

import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'

import { starConfigDir, writePrivateJson } from './starConfig.js'

export type StarUser = {
  id: string
  email: string | null
  phone: string | null
  nickname: string | null
  avatar: string | null
  inviteCode: string | null
}

export type StarSession = {
  token: string
  user: StarUser
  /** OpenAI-compatible relay key (`sk-…`) that bills chat turns to this account. */
  relayKey?: string
  relayKeyId?: string
  /** Saved provider id of the managed STAR provider. */
  providerId?: string
  signedInAt: number
  method?: 'email-code' | 'phone-code' | 'password' | 'starwork-import'
}

export function starSessionPath(): string {
  return path.join(starConfigDir(), 'session.json')
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

export function normalizeStarUser(raw: unknown): StarUser {
  const record = raw && typeof raw === 'object' ? raw as Record<string, unknown> : {}
  return {
    id: text(record.id) ?? (typeof record.id === 'number' ? String(record.id) : ''),
    email: text(record.email),
    phone: text(record.phone),
    nickname: text(record.nickname) ?? text(record.displayName) ?? text(record.name),
    avatar: text(record.avatar) ?? text(record.avatarUrl),
    inviteCode: text(record.inviteCode),
  }
}

export function readStarSession(): StarSession | null {
  try {
    const parsed = JSON.parse(fs.readFileSync(starSessionPath(), 'utf-8')) as Partial<StarSession>
    if (!parsed || typeof parsed !== 'object' || typeof parsed.token !== 'string' || !parsed.token.trim()) return null
    return {
      token: parsed.token.trim(),
      user: normalizeStarUser(parsed.user),
      ...(typeof parsed.relayKey === 'string' && parsed.relayKey ? { relayKey: parsed.relayKey } : {}),
      ...(typeof parsed.relayKeyId === 'string' && parsed.relayKeyId ? { relayKeyId: parsed.relayKeyId } : {}),
      ...(typeof parsed.providerId === 'string' && parsed.providerId ? { providerId: parsed.providerId } : {}),
      signedInAt: typeof parsed.signedInAt === 'number' ? parsed.signedInAt : Date.now(),
      ...(parsed.method ? { method: parsed.method } : {}),
    }
  } catch {
    return null
  }
}

export function writeStarSession(session: StarSession): void {
  writePrivateJson(starSessionPath(), session)
}

export function updateStarSession(patch: Partial<StarSession>): StarSession | null {
  const current = readStarSession()
  if (!current) return null
  const next = { ...current, ...patch }
  writeStarSession(next)
  return next
}

export function clearStarSession(): void {
  try {
    fs.rmSync(starSessionPath(), { force: true })
  } catch {
    // Already gone.
  }
}

export function requireStarToken(): string {
  const session = readStarSession()
  if (!session) throw Object.assign(new Error('请先登录 STAR 账号（左下角头像 → 登录）'), { status: 401, code: 'STAR_SIGNED_OUT' })
  return session.token
}

/** Display label: nickname, then phone, then email. */
export function starUserLabel(user: StarUser): string {
  return user.nickname || user.phone || user.email || 'STAR 用户'
}

/**
 * Tokens the STAR Work desktop saved on this machine, newest first. Used only
 * when the user explicitly picks "use the STAR Work sign-in on this computer".
 */
export function findStarWorkTokens(): string[] {
  const home = os.homedir()
  const roots = [path.join(home, '.starwork')]
  const found: { token: string; at: number }[] = []
  for (const root of roots) {
    const multi = path.join(root, 'saas-user-sessions.json')
    try {
      const at = fs.statSync(multi).mtimeMs
      const rows = JSON.parse(fs.readFileSync(multi, 'utf-8')) as Record<string, { token?: unknown }>
      for (const row of Object.values(rows ?? {})) {
        const token = text(row?.token)
        if (token) found.push({ token, at })
      }
    } catch {
      // Not present.
    }
    const single = path.join(root, 'saas-session.json')
    try {
      const at = fs.statSync(single).mtimeMs
      const row = JSON.parse(fs.readFileSync(single, 'utf-8')) as { token?: unknown }
      const token = text(row?.token)
      if (token) found.push({ token, at })
    } catch {
      // Not present.
    }
  }
  const unique = new Map<string, number>()
  for (const item of found.sort((a, b) => b.at - a.at)) {
    if (!unique.has(item.token)) unique.set(item.token, item.at)
  }
  return [...unique.keys()]
}
