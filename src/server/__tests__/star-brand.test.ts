import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'bun:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {
  formatStarBrand,
  normalizeStarBrandName,
  starBrandProductName,
} from '../../utils/starBrand.js'
import {
  brandNameFromDesktopConfig,
  readStarBrandName,
  refreshStarBrand,
  resetStarBrandRefreshForTests,
  STAR_BRAND_REFRESH_MS,
  starBrandPath,
} from '../services/star/starBrand.js'
import { getStarStatus } from '../services/star/starAccountService.js'
import { loadStarSettings } from '../services/star/starConfig.js'

// 「star需要跟随后台设置的名称来展示」: the name comes from branding.appName of the
// public desktop config, is normalized like STAR Code's, and is cached in
// <config>/cc-haha/star/brand.json for the shell, the Electron host and the agent.
describe('STAR brand name rules', () => {
  it('trims, drops control characters and angle brackets, collapses spaces and keeps 24 characters', () => {
    expect(normalizeStarBrandName('  PRIVO  ')).toBe('PRIVO')
    expect(normalizeStarBrandName('PR\u0000I\nVO')).toBe('PR I VO')
    expect(normalizeStarBrandName('<b>Acme</b>')).toBe('b Acme /b')
    expect(normalizeStarBrandName('星 \t 辰')).toBe('星 辰')
    expect(normalizeStarBrandName('一二三四五六七八九十一二三四五六七八九十一二三四五六')).toHaveLength(24)
    expect(normalizeStarBrandName('A'.repeat(23) + ' B')).toBe('A'.repeat(23))
  })

  it('falls back to STAR for an empty name, the console default MaxClaw, or no string', () => {
    for (const raw of ['', '   ', '<>', 'MaxClaw', ' maxclaw ', null, undefined, 42, { name: 'X' }]) {
      expect(normalizeStarBrandName(raw)).toBe('STAR')
    }
  })

  it('names the products without doubling the last word', () => {
    expect(starBrandProductName('PRIVO', 'Agent')).toBe('PRIVO Agent')
    expect(starBrandProductName('PRIVO', 'Code')).toBe('PRIVO Code')
    expect(starBrandProductName('PRIVO Agent', 'Agent')).toBe('PRIVO Agent')
    expect(starBrandProductName('privo code', 'Code')).toBe('privo code')
    expect(starBrandProductName('Codex', 'Code')).toBe('Codex Code')
    expect(starBrandProductName(' ', 'Agent')).toBe('STAR Agent')
  })

  it('fills the brand placeholders and leaves other braces alone', () => {
    expect(formatStarBrand('登录 {brand} 账号 · {brandAgent} · {brandCode} · {0} {name}', 'PRIVO'))
      .toBe('登录 PRIVO 账号 · PRIVO Agent · PRIVO Code · {0} {name}')
  })

  it('reads branding.appName from a desktop config answer', () => {
    expect(brandNameFromDesktopConfig({ branding: { appName: ' PRIVO ', logoUrl: 'x' } })).toBe('PRIVO')
    expect(brandNameFromDesktopConfig({ branding: { appName: 'MaxClaw' } })).toBe('STAR')
    expect(brandNameFromDesktopConfig({})).toBe('STAR')
    expect(brandNameFromDesktopConfig('<html>')).toBe('STAR')
  })
})

describe('STAR brand cache', () => {
  const keys = ['CLAUDE_CONFIG_DIR', 'CC_HAHA_STAR_BASE_URL', 'CC_HAHA_STAR_APP_SECRET', 'HOME', 'USERPROFILE'] as const
  const saved = Object.fromEntries(keys.map(key => [key, process.env[key]])) as Record<(typeof keys)[number], string | undefined>
  let requests: { path: string; query: string; secret: string | null; authorization: string | null }[] = []
  let answer: () => Response = () => Response.json({ branding: { appName: 'PRIVO' } })
  let service: ReturnType<typeof Bun.serve>
  let configDir = ''
  let homeDir = ''

  beforeAll(() => {
    service = Bun.serve({
      hostname: '127.0.0.1',
      port: 0,
      fetch(request) {
        const url = new URL(request.url)
        requests.push({
          path: url.pathname,
          query: url.search,
          secret: request.headers.get('x-app-secret'),
          authorization: request.headers.get('authorization'),
        })
        return answer()
      },
    })
    homeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'star-brand-home-'))
    process.env.HOME = homeDir
    process.env.USERPROFILE = homeDir
    process.env.CC_HAHA_STAR_BASE_URL = `http://127.0.0.1:${service.port}`
    process.env.CC_HAHA_STAR_APP_SECRET = 'test-secret'
  })

  afterAll(() => {
    service.stop(true)
    for (const key of keys) {
      if (saved[key] === undefined) delete process.env[key]
      else process.env[key] = saved[key]
    }
    fs.rmSync(homeDir, { recursive: true, force: true })
  })

  beforeEach(() => {
    if (configDir) fs.rmSync(configDir, { recursive: true, force: true })
    // A fresh config dir per case: the settings cache is keyed by it.
    configDir = fs.mkdtempSync(path.join(os.tmpdir(), 'star-brand-'))
    process.env.CLAUDE_CONFIG_DIR = configDir
    requests = []
    answer = () => Response.json({ branding: { appName: '  PRIVO  ' } })
    resetStarBrandRefreshForTests()
  })

  const cacheFile = () => JSON.parse(fs.readFileSync(starBrandPath(), 'utf8')) as { name: string; updatedAt: number }

  it('fetches the public desktop config once and caches the normalized name in brand.json', async () => {
    expect(readStarBrandName()).toBe('STAR')
    const before = Date.now()
    expect(await refreshStarBrand()).toBe('PRIVO')
    expect(requests).toEqual([{ path: '/api/desktop/config', query: '?platform=windows', secret: 'test-secret', authorization: null }])
    expect(starBrandPath()).toBe(path.join(configDir, 'cc-haha', 'star', 'brand.json'))
    const cached = cacheFile()
    expect(cached.name).toBe('PRIVO')
    expect(cached.updatedAt).toBeGreaterThanOrEqual(before)
    expect(readStarBrandName()).toBe('PRIVO')

    // Within 30 minutes nothing is asked again.
    answer = () => Response.json({ branding: { appName: 'Other' } })
    expect(await refreshStarBrand()).toBe('PRIVO')
    expect(requests).toHaveLength(1)
  })

  it('uses a fresh cache from an earlier run without asking', async () => {
    fs.mkdirSync(path.dirname(starBrandPath()), { recursive: true })
    fs.writeFileSync(starBrandPath(), JSON.stringify({ name: 'Cached', updatedAt: Date.now() - 60_000 }))
    expect(await refreshStarBrand()).toBe('Cached')
    expect(requests).toEqual([])
  })

  it('asks again when the cache is older than 30 minutes, and keeps it when the request fails', async () => {
    fs.mkdirSync(path.dirname(starBrandPath()), { recursive: true })
    const old = { name: 'Cached', updatedAt: Date.now() - STAR_BRAND_REFRESH_MS - 1_000 }
    fs.writeFileSync(starBrandPath(), JSON.stringify(old))
    answer = () => new Response('unavailable', { status: 503 })
    expect(await refreshStarBrand()).toBe('Cached')
    expect(requests).toHaveLength(1)
    expect(cacheFile()).toEqual(old)

    // A failed attempt also waits 30 minutes before the next one.
    expect(await refreshStarBrand()).toBe('Cached')
    expect(requests).toHaveLength(1)
  })

  it('keeps the cached name when the answer is not JSON', async () => {
    fs.mkdirSync(path.dirname(starBrandPath()), { recursive: true })
    fs.writeFileSync(starBrandPath(), JSON.stringify({ name: 'Cached', updatedAt: 0 }))
    answer = () => new Response('<html>portal</html>', { status: 200, headers: { 'content-type': 'text/html' } })
    expect(await refreshStarBrand()).toBe('Cached')
    expect(cacheFile().name).toBe('Cached')
  })

  it('stores STAR when the console sets no name', async () => {
    answer = () => Response.json({ branding: { appName: 'MaxClaw' } })
    expect(await refreshStarBrand()).toBe('STAR')
    expect(cacheFile().name).toBe('STAR')
  })

  it('reports the name in the STAR status', async () => {
    const status = await getStarStatus()
    expect(status.brandName).toBe('PRIVO')
    expect(status.signedIn).toBe(false)
  })
})

// The installed app asks the console with the product settings it ships: the
// sidecar gets resources/app.asar as its app root, which it cannot read, and
// the package unpacks star-product.json beside it.
describe('STAR product settings in the installed app', () => {
  let root = ''

  beforeEach(() => {
    if (root) fs.rmSync(root, { recursive: true, force: true })
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'star-installed-'))
  })

  afterAll(() => {
    if (root) fs.rmSync(root, { recursive: true, force: true })
  })

  const installedEnv = (): NodeJS.ProcessEnv => ({
    CLAUDE_CONFIG_DIR: path.join(root, 'config'),
    CLAUDE_APP_ROOT: path.join(root, 'resources', 'app.asar'),
  })

  it('reads star-product.json from app.asar.unpacked', () => {
    const unpacked = path.join(root, 'resources', 'app.asar.unpacked')
    fs.mkdirSync(unpacked, { recursive: true })
    fs.writeFileSync(path.join(unpacked, 'star-product.json'), JSON.stringify({
      productName: 'STAR',
      saasBaseUrl: 'https://console.example.com/',
      saasAppSecret: 'packaged-secret',
    }))
    expect(loadStarSettings(installedEnv())).toEqual({
      baseUrl: 'https://console.example.com',
      appSecret: 'packaged-secret',
      configured: true,
      source: 'product',
    })
  })

  it('stays unconfigured when the package carries no settings', () => {
    expect(loadStarSettings(installedEnv())).toMatchObject({ appSecret: '', configured: false, source: 'none' })
  })
})
