import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { resetStarBrandNameCacheForTests, starBrandFile } from '../utils/starBrand.js'
import {
  CLI_SYSPROMPT_PREFIXES,
  getCLISyspromptPrefix,
  getStarAgentSyspromptPrefix,
  isCLISyspromptPrefix,
  usesClaudeCodeIdentity,
} from './system.js'
import { splitSysPromptPrefix } from '../utils/api.js'
import { asSystemPrompt } from '../utils/systemPromptType.js'

const ENV_KEYS = [
  'CLAUDE_CONFIG_DIR',
  'ANTHROPIC_BASE_URL',
  'CLAUDE_CODE_USE_BEDROCK',
  'CLAUDE_CODE_USE_VERTEX',
  'CLAUDE_CODE_USE_FOUNDRY',
  'CLAUDE_CODE_USE_AZURE_OPENAI',
] as const

const CLAUDE_CODE_PREFIX = "You are Claude Code, Anthropic's official CLI for Claude."
// A placeholder gateway; the real STAR domain is never written into tests.
const GATEWAY_URL = 'https://gateway.example.test/anthropic'

describe('agent identity prefix', () => {
  const saved: Partial<Record<(typeof ENV_KEYS)[number], string | undefined>> = {}
  let configDir = ''

  beforeEach(() => {
    for (const key of ENV_KEYS) {
      saved[key] = process.env[key]
      delete process.env[key]
    }
    // An empty config dir: no cached console name, so STAR Agent; the real one is never read.
    configDir = mkdtempSync(join(tmpdir(), 'star-identity-'))
    process.env.CLAUDE_CONFIG_DIR = configDir
    resetStarBrandNameCacheForTests()
  })

  afterEach(() => {
    for (const key of ENV_KEYS) {
      if (saved[key] === undefined) delete process.env[key]
      else process.env[key] = saved[key]
    }
    resetStarBrandNameCacheForTests()
    rmSync(configDir, { recursive: true, force: true })
  })

  test('introduces itself as STAR Agent powered by the selected model on a gateway', () => {
    process.env.ANTHROPIC_BASE_URL = GATEWAY_URL
    for (const isNonInteractive of [false, true]) {
      for (const hasAppendSystemPrompt of [false, true]) {
        const prefix = getCLISyspromptPrefix({ isNonInteractive, hasAppendSystemPrompt, model: 'gpt-5.6' })
        expect(prefix).toBe('You are STAR Agent, an AI assistant powered by gpt-5.6.')
        expect(prefix).not.toContain('Claude')
      }
    }
    // A Claude model behind someone else's endpoint is still STAR Agent, not Claude Code.
    expect(getCLISyspromptPrefix({ isNonInteractive: false, hasAppendSystemPrompt: false, model: 'claude-sonnet-5-5' }))
      .toBe('You are STAR Agent, an AI assistant powered by claude-sonnet-5-5.')
  })

  test('stays neutral when the model is unknown', () => {
    process.env.ANTHROPIC_BASE_URL = GATEWAY_URL
    expect(getCLISyspromptPrefix()).toBe('You are STAR Agent, an AI assistant.')
    expect(getStarAgentSyspromptPrefix('  ')).toBe('You are STAR Agent, an AI assistant.')
    expect(getStarAgentSyspromptPrefix(' deepseek-v4\n pro ')).toBe('You are STAR Agent, an AI assistant powered by deepseek-v4 pro.')
  })

  test("keeps Claude Code's identity on Anthropic's own API, where the subscription checks it", () => {
    expect(usesClaudeCodeIdentity('claude-opus-4-8')).toBe(true)
    expect(getCLISyspromptPrefix({ isNonInteractive: false, hasAppendSystemPrompt: false, model: 'claude-opus-4-8' }))
      .toBe(CLAUDE_CODE_PREFIX)
    expect(getCLISyspromptPrefix({ isNonInteractive: true, hasAppendSystemPrompt: false, model: 'claude-opus-4-8' }))
      .toBe("You are a Claude agent, built on Anthropic's Claude Agent SDK.")
    process.env.CLAUDE_CODE_USE_VERTEX = '1'
    expect(getCLISyspromptPrefix({ isNonInteractive: true, hasAppendSystemPrompt: false, model: 'claude-opus-4-8' }))
      .toBe(CLAUDE_CODE_PREFIX)
  })

  test('never claims to be Claude for a known non-Claude model', () => {
    expect(usesClaudeCodeIdentity('gpt-5.5')).toBe(false)
    expect(getCLISyspromptPrefix({ isNonInteractive: false, hasAppendSystemPrompt: false, model: 'gpt-5.5' }))
      .toBe('You are STAR Agent, an AI assistant powered by gpt-5.5.')
    process.env.CLAUDE_CODE_USE_AZURE_OPENAI = '1'
    expect(usesClaudeCodeIdentity()).toBe(false)
  })

  test('recognizes every identity line as the prefix block, and nothing else', () => {
    for (const prefix of CLI_SYSPROMPT_PREFIXES) expect(isCLISyspromptPrefix(prefix)).toBe(true)
    expect(isCLISyspromptPrefix('You are STAR Agent, an AI assistant.')).toBe(true)
    expect(isCLISyspromptPrefix('You are STAR Agent, an AI assistant powered by kimi-k2.5.')).toBe(true)
    expect(isCLISyspromptPrefix('You are STAR Agent, an AI assistant powered by x.\nMore text.')).toBe(false)
    expect(isCLISyspromptPrefix('You are an interactive agent that helps users.')).toBe(false)
  })

  test('introduces itself with the product name the STAR console sets (brand.json)', () => {
    process.env.ANTHROPIC_BASE_URL = GATEWAY_URL
    const file = starBrandFile()
    mkdirSync(dirname(file), { recursive: true })
    writeFileSync(file, JSON.stringify({ name: 'PRIVO', updatedAt: Date.now() }))
    resetStarBrandNameCacheForTests()
    const prefix = getCLISyspromptPrefix({ isNonInteractive: false, hasAppendSystemPrompt: false, model: 'gpt-5.6' })
    expect(prefix).toBe('You are PRIVO Agent, an AI assistant powered by gpt-5.6.')
    expect(getStarAgentSyspromptPrefix()).toBe('You are PRIVO Agent, an AI assistant.')
    expect(isCLISyspromptPrefix(prefix)).toBe(true)
    expect(splitSysPromptPrefix(asSystemPrompt([prefix, 'Rules A']))[0]?.text).toBe(prefix)

    // A name that already ends with "Agent" is not doubled.
    writeFileSync(file, JSON.stringify({ name: 'PRIVO Agent', updatedAt: Date.now() }))
    resetStarBrandNameCacheForTests()
    expect(getStarAgentSyspromptPrefix('kimi-k2.6')).toBe('You are PRIVO Agent, an AI assistant powered by kimi-k2.6.')
  })

  test('splits the STAR identity line into its own system block, like the Claude Code one', () => {
    process.env.ANTHROPIC_BASE_URL = GATEWAY_URL
    const prefix = getCLISyspromptPrefix({ isNonInteractive: false, hasAppendSystemPrompt: false, model: 'gemini-3.1-pro' })
    const blocks = splitSysPromptPrefix(asSystemPrompt([prefix, 'Rules A', 'Rules B']))
    expect(blocks[0]).toEqual({ text: 'You are STAR Agent, an AI assistant powered by gemini-3.1-pro.', cacheScope: 'org' })
    expect(blocks.slice(1).map(block => block.text).join('\n\n')).toContain('Rules A')
    expect(blocks.some(block => block.text.includes('STAR Agent') && block.text.includes('Rules A'))).toBe(false)
  })
})
