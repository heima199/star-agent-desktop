/**
 * What each IM adapter needs before it can start: its credentials, or a
 * linked account.
 *
 * Two readers, one table. The desktop sidecar's adapters mode gates every
 * platform on it before importing that platform's module
 * (desktop/sidecars/claude-sidecar.ts). The desktop host reads it before it
 * spawns anything (desktop/electron/services/sidecarManager.ts
 * `configuredAdapterFlags`): a platform nobody set up gets no adapter process
 * at all. Each such process used to load the whole runtime — about a second of
 * CPU and ~130 MB — only to report its missing credentials and exit, eight of
 * them on every start.
 *
 * Light on purpose (node:fs and node:path, the config only as a type), so the
 * Electron host can bundle it.
 */
import * as fs from 'node:fs'
import * as path from 'node:path'
import type { AdapterConfig } from './config.js'

export type AdapterRequirementFlag =
  | '--feishu'
  | '--telegram'
  | '--wechat'
  | '--dingtalk'
  | '--whatsapp'
  | '--wecom'
  | '--qq'
  | '--slack'

export type AdapterRequirement = {
  flag: AdapterRequirementFlag
  label: string
  /** Said when the platform is asked for but cannot start. */
  missingCredentials: string
  isConfigured: (config: AdapterConfig) => boolean
}

/**
 * Whether a phone is linked: Baileys' multi-file auth state writes
 * `creds.json` into the auth directory. The same file test as
 * whatsapp/session.ts `hasWhatsAppAuth`, without importing Baileys for it.
 */
export function hasWhatsAppCredentials(authDir: string): boolean {
  return fs.existsSync(path.join(path.resolve(authDir), 'creds.json'))
}

export const ADAPTER_REQUIREMENTS: readonly AdapterRequirement[] = [
  {
    flag: '--feishu',
    label: 'Feishu',
    missingCredentials: 'FEISHU_APP_ID / FEISHU_APP_SECRET missing',
    isConfigured: (config) => Boolean(config.feishu.appId && config.feishu.appSecret),
  },
  {
    flag: '--telegram',
    label: 'Telegram',
    missingCredentials: 'TELEGRAM_BOT_TOKEN missing',
    isConfigured: (config) => Boolean(config.telegram.botToken),
  },
  {
    flag: '--wechat',
    label: 'WeChat',
    missingCredentials: 'no QR-bound WeChat account found',
    isConfigured: (config) => Boolean(config.wechat.accountId && config.wechat.botToken),
  },
  {
    flag: '--dingtalk',
    label: 'DingTalk',
    missingCredentials: 'DINGTALK_CLIENT_ID / DINGTALK_CLIENT_SECRET missing',
    isConfigured: (config) => Boolean(config.dingtalk.clientId && config.dingtalk.clientSecret),
  },
  {
    flag: '--whatsapp',
    label: 'WhatsApp',
    missingCredentials: 'no QR-linked WhatsApp account found',
    isConfigured: (config) => hasWhatsAppCredentials(config.whatsapp.authDir),
  },
  {
    flag: '--wecom',
    label: 'WeCom',
    missingCredentials: 'WECOM_BOT_ID / WECOM_BOT_SECRET missing',
    isConfigured: (config) => Boolean(config.wecom.botId && config.wecom.secret),
  },
  {
    flag: '--qq',
    label: 'QQ',
    missingCredentials: 'QQ_APP_ID / QQ_APP_SECRET missing',
    isConfigured: (config) => Boolean(config.qq.appId && config.qq.appSecret),
  },
  {
    flag: '--slack',
    label: 'Slack',
    missingCredentials: 'SLACK_BOT_TOKEN / SLACK_APP_TOKEN missing',
    isConfigured: (config) => Boolean(config.slack.botToken && config.slack.appToken),
  },
]
