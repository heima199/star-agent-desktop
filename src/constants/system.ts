// Critical system constants extracted to break circular dependencies

import { getFeatureValue_CACHED_MAY_BE_STALE } from '../services/analytics/growthbook.js'
import { logForDebugging } from '../utils/debug.js'
import { isEnvDefinedFalsy } from '../utils/envUtils.js'
import { getAPIProvider, isFirstPartyAnthropicBaseUrl } from '../utils/model/providers.js'
import { getStarAgentName } from '../utils/starBrand.js'
import { getWorkload } from '../utils/workloadContext.js'
import { formatClaudeCodeBillingHeader } from './claudeCodeCompatibility.js'

const DEFAULT_PREFIX = `You are Claude Code, Anthropic's official CLI for Claude.`
const AGENT_SDK_CLAUDE_CODE_PRESET_PREFIX = `You are Claude Code, Anthropic's official CLI for Claude, running within the Claude Agent SDK.`
const AGENT_SDK_PREFIX = `You are a Claude agent, built on Anthropic's Claude Agent SDK.`

/** The product name the agent introduces itself with by default (no console name cached yet). */
export const STAR_AGENT_NAME = 'STAR Agent'
/** Any product name (the console's, ≤ 24 characters, + " Agent"), so a line from before a rename still counts. */
const STAR_AGENT_PREFIX_PATTERN = /^You are [^\n]{1,40}?, an AI assistant(?: powered by [^\n]+)?\.$/

/**
 * The identity line for every request that does not go to Anthropic's own
 * service. The STAR gateway, saved providers and local proxies serve any model
 * (gpt-5.6, deepseek, gemini, kimi…); a model told "You are Claude Code" would
 * answer "who are you" untruthfully. The model is named when it is known. The
 * product is "X Agent" with X the name set in the STAR console (brand.json,
 * see utils/starBrand.ts), STAR Agent by default.
 */
export function getStarAgentSyspromptPrefix(model?: string | null): string {
  const name = model?.trim().replace(/\s+/g, ' ')
  const agent = getStarAgentName()
  return name ? `You are ${agent}, an AI assistant powered by ${name}.` : `You are ${agent}, an AI assistant.`
}

function looksLikeClaudeModel(model: string): boolean {
  return /claude|opus|sonnet|haiku|fable/i.test(model)
}

/**
 * Anthropic's own API (no custom base URL) and the Claude-only clouds keep the
 * Claude Code identity: Anthropic checks this prefix on subscription (OAuth)
 * requests, and the model there is Claude. A known non-Claude model never does.
 */
export function usesClaudeCodeIdentity(model?: string | null): boolean {
  if (model?.trim() && !looksLikeClaudeModel(model)) return false
  const provider = getAPIProvider()
  if (provider === 'bedrock' || provider === 'vertex' || provider === 'foundry') {
    return true
  }
  return provider === 'firstParty' && isFirstPartyAnthropicBaseUrl()
}

const CLI_SYSPROMPT_PREFIX_VALUES = [
  DEFAULT_PREFIX,
  AGENT_SDK_CLAUDE_CODE_PRESET_PREFIX,
  AGENT_SDK_PREFIX,
] as const

export type CLISyspromptPrefix = (typeof CLI_SYSPROMPT_PREFIX_VALUES)[number]

/**
 * All possible CLI sysprompt prefix values, used by splitSysPromptPrefix
 * to identify prefix blocks by content rather than position.
 */
export const CLI_SYSPROMPT_PREFIXES: ReadonlySet<string> = new Set(
  CLI_SYSPROMPT_PREFIX_VALUES,
)

/** Whether a system prompt block is one of the identity prefixes above or STAR Agent's. */
export function isCLISyspromptPrefix(block: string): boolean {
  return CLI_SYSPROMPT_PREFIXES.has(block) || STAR_AGENT_PREFIX_PATTERN.test(block)
}

export function getCLISyspromptPrefix(options?: {
  isNonInteractive: boolean
  hasAppendSystemPrompt: boolean
  /** The API model of this request; named in STAR Agent's identity line. */
  model?: string
}): CLISyspromptPrefix | string {
  if (!usesClaudeCodeIdentity(options?.model)) {
    return getStarAgentSyspromptPrefix(options?.model)
  }
  const apiProvider = getAPIProvider()
  if (apiProvider === 'vertex') {
    return DEFAULT_PREFIX
  }

  if (options?.isNonInteractive) {
    if (options.hasAppendSystemPrompt) {
      return AGENT_SDK_CLAUDE_CODE_PRESET_PREFIX
    }
    return AGENT_SDK_PREFIX
  }
  return DEFAULT_PREFIX
}

/**
 * Check if attribution header is enabled.
 * Enabled by default, can be disabled via env var or GrowthBook killswitch.
 */
function isAttributionHeaderEnabled(): boolean {
  if (isEnvDefinedFalsy(process.env.CLAUDE_CODE_ATTRIBUTION_HEADER)) {
    return false
  }
  return getFeatureValue_CACHED_MAY_BE_STALE('tengu_attribution_header', true)
}

/**
 * Get attribution header for API requests.
 * Returns a header string with cc_version (including fingerprint) and cc_entrypoint.
 * Enabled by default, can be disabled via env var or GrowthBook killswitch.
 *
 * Includes a `cch=00000` placeholder. Before the request is sent,
 * signClaudeCodeCCHBody overwrites the zeros with a computed hash.
 * The server verifies this token to confirm the request came from a real
 * Claude Code client.
 */
export function getAttributionHeader(fingerprint: string): string {
  if (!isAttributionHeaderEnabled()) {
    return ''
  }

  // cc_workload: turn-scoped hint so the API can route e.g. cron-initiated
  // requests to a lower QoS pool. Absent = interactive default. Safe re:
  // fingerprint (computed from msg chars + version only) and cch signature
  // (placeholder overwritten in serialized body bytes after this string is
  // built). Server _parse_cc_header tolerates unknown extra fields so old API
  // deploys silently ignore this.
  const header = formatClaudeCodeBillingHeader({
    fingerprint,
    workload: getWorkload(),
  })

  logForDebugging(`attribution header ${header}`)
  return header
}
