import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import {
  getImAgentName,
  getImBrandName,
  imAgentNameOf,
  imBrandFile,
  normalizeImBrandName,
  resetImBrandCacheForTests,
} from '../brand.js'

let configDir = ''
let savedConfigDir: string | undefined

beforeEach(() => {
  savedConfigDir = process.env.CLAUDE_CONFIG_DIR
  configDir = fs.mkdtempSync(path.join(os.tmpdir(), 'im-brand-'))
  process.env.CLAUDE_CONFIG_DIR = configDir
  resetImBrandCacheForTests()
})

afterEach(() => {
  if (savedConfigDir === undefined) delete process.env.CLAUDE_CONFIG_DIR
  else process.env.CLAUDE_CONFIG_DIR = savedConfigDir
  fs.rmSync(configDir, { recursive: true, force: true })
  resetImBrandCacheForTests()
})

function writeBrand(body: unknown): void {
  fs.mkdirSync(path.join(configDir, 'cc-haha', 'star'), { recursive: true })
  fs.writeFileSync(path.join(configDir, 'cc-haha', 'star', 'brand.json'), typeof body === 'string' ? body : JSON.stringify(body))
}

describe('IM brand name', () => {
  it('reads the file the local server writes, next to the STAR session', () => {
    expect(imBrandFile({ CLAUDE_CONFIG_DIR: '/cfg' }, '/home/u')).toBe(path.join('/cfg', 'cc-haha', 'star', 'brand.json'))
    expect(imBrandFile({}, '/home/u')).toBe(path.join('/home/u', '.claude', 'cc-haha', 'star', 'brand.json'))
  })

  it('is STAR until the server fetched a name', () => {
    expect(getImBrandName()).toBe('STAR')
    expect(getImAgentName()).toBe('STAR Agent')
  })

  it('names the agent after the console product name', () => {
    writeBrand({ name: 'PRIVO', updatedAt: 1 })
    expect(getImBrandName()).toBe('PRIVO')
    expect(getImAgentName()).toBe('PRIVO Agent')
  })

  it('falls back to STAR for an unreadable or nameless file', () => {
    writeBrand('{ not json')
    expect(getImAgentName()).toBe('STAR Agent')
    resetImBrandCacheForTests()
    writeBrand({ updatedAt: 1 })
    expect(getImAgentName()).toBe('STAR Agent')
  })

  it('applies the console naming rules', () => {
    expect(normalizeImBrandName('  Max  <b>Work</b>\n')).toBe('Max b Work /b')
    expect(normalizeImBrandName('MaxClaw')).toBe('STAR')
    expect(normalizeImBrandName('')).toBe('STAR')
    expect(normalizeImBrandName(42)).toBe('STAR')
    expect([...normalizeImBrandName('长'.repeat(40))]).toHaveLength(24)
    expect(imAgentNameOf('PRIVO')).toBe('PRIVO Agent')
    expect(imAgentNameOf('Nova Agent')).toBe('Nova Agent')
  })
})
