import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'bun:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { handleStarApi } from '../api/star.js'
import { starHostArch, starInstallerForChip } from '../services/star/starPortalService.js'

// 登录改为这种的: the login form links 用户协议 and 隐私政策. The desktop config
// only lists their titles, so the bodies are read from the public
// /api/desktop/legal through the local server's GET /api/star/legal.
describe('GET /api/star/legal', () => {
  const saved = { config: process.env.CLAUDE_CONFIG_DIR, base: process.env.CC_HAHA_STAR_BASE_URL, secret: process.env.CC_HAHA_STAR_APP_SECRET }
  const restore = (name: string, value: string | undefined) => { if (value === undefined) delete process.env[name]; else process.env[name] = value }
  let requests: { path: string; authorization: string | null; secret: string | null }[] = []
  let answer: () => Response = () => Response.json({ docs: [] })
  let service: ReturnType<typeof Bun.serve>
  let configDir = ''

  const call = (method = 'GET') => {
    const url = new URL('http://127.0.0.1/api/star/legal')
    return handleStarApi(new Request(url, { method }), url, ['api', 'star', 'legal'])
  }

  beforeAll(() => {
    service = Bun.serve({
      hostname: '127.0.0.1',
      port: 0,
      fetch(request) {
        const url = new URL(request.url)
        requests.push({ path: url.pathname, authorization: request.headers.get('authorization'), secret: request.headers.get('x-app-secret') })
        return answer()
      },
    })
    // A fresh config dir: no saved STAR session, as before the first sign-in.
    configDir = fs.mkdtempSync(path.join(os.tmpdir(), 'star-legal-'))
    process.env.CLAUDE_CONFIG_DIR = configDir
    process.env.CC_HAHA_STAR_BASE_URL = `http://127.0.0.1:${service.port}`
    process.env.CC_HAHA_STAR_APP_SECRET = 'test-secret'
  })

  afterAll(() => {
    service.stop(true)
    fs.rmSync(configDir, { recursive: true, force: true })
    restore('CLAUDE_CONFIG_DIR', saved.config)
    restore('CC_HAHA_STAR_BASE_URL', saved.base)
    restore('CC_HAHA_STAR_APP_SECRET', saved.secret)
  })

  beforeEach(() => {
    requests = []
    answer = () => Response.json({ docs: [] })
  })

  it('returns the published documents with their bodies, without a sign-in', async () => {
    answer = () => Response.json({
      docs: [
        { id: 'terms', title: ' 用户协议 ', bodyHtml: '<p>使用 STAR 即表示同意。</p>', body: '使用 STAR 即表示同意。', updatedAt: 1_793_000_000_000 },
        { id: 'privacy', title: '隐私政策', bodyHtml: '', body: '我们只收集必要的信息。', updatedAt: '1793000000000' },
        { id: 'refund', title: '退款说明', bodyHtml: '  ', body: '' },
      ],
    })
    const response = await call()
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      docs: [
        { id: 'terms', title: '用户协议', bodyHtml: '<p>使用 STAR 即表示同意。</p>', body: '使用 STAR 即表示同意。', updatedAt: 1_793_000_000_000 },
        { id: 'privacy', title: '隐私政策', bodyHtml: '', body: '我们只收集必要的信息。', updatedAt: 1_793_000_000_000 },
      ],
    })
    expect(requests).toEqual([{ path: '/api/desktop/legal', authorization: null, secret: 'test-secret' }])
  })

  it('answers an empty list when nothing is published', async () => {
    const response = await call()
    expect(await response.json()).toEqual({ docs: [] })
  })

  it('keeps an oversized document within the limit and names an untitled one', async () => {
    answer = () => Response.json({ docs: [{ id: 'long', body: 'x'.repeat(250_000) }, { body: '无标题的条款' }] })
    const { docs } = await (await call()).json() as { docs: { id: string; title: string; body: string; updatedAt: number }[] }
    expect(docs[0]!.body).toHaveLength(200_000)
    expect(docs[0]!.title).toBe('long')
    expect(docs[1]).toEqual({ id: '', title: '协议', bodyHtml: '', body: '无标题的条款', updatedAt: 0 })
  })

  it('reports a service failure instead of an empty list', async () => {
    answer = () => new Response('unavailable', { status: 503 })
    const response = await call()
    expect(response.status).toBe(503)
    expect(((await response.json()) as { message?: string }).message).toBeTruthy()
  })

  it('only answers GET', async () => {
    const response = await call('POST')
    expect(response.status).toBe(404)
    expect(requests).toEqual([])
  })
})

// 多芯片安装包: the console publishes an installer per platform AND chip, so the
// update check names this machine's chip, read from the Electron host.
describe('GET /api/star/update', () => {
  const saved = { config: process.env.CLAUDE_CONFIG_DIR, base: process.env.CC_HAHA_STAR_BASE_URL, secret: process.env.CC_HAHA_STAR_APP_SECRET, arch: process.env.CC_HAHA_HOST_ARCH }
  const restore = (name: string, value: string | undefined) => { if (value === undefined) delete process.env[name]; else process.env[name] = value }
  let queries: string[] = []
  let service: ReturnType<typeof Bun.serve>
  let configDir = ''
  const call = (search: string) => {
    const url = new URL(`http://127.0.0.1/api/star/update${search}`)
    return handleStarApi(new Request(url), url, ['api', 'star', 'update'])
  }
  beforeAll(() => {
    service = Bun.serve({
      hostname: '127.0.0.1',
      port: 0,
      fetch(request) {
        const url = new URL(request.url)
        queries.push(`${url.pathname}${url.search}`)
        return Response.json({ hasUpdate: true, version: '1.1.0', downloadUrl: 'https://cdn.example.com/STAR-Agent-1.1.0-win-arm64.exe', releaseNotes: '新芯片', mandatory: false, publishedAt: 1_793_000_000 })
      },
    })
    configDir = fs.mkdtempSync(path.join(os.tmpdir(), 'star-update-'))
    process.env.CLAUDE_CONFIG_DIR = configDir
    process.env.CC_HAHA_STAR_BASE_URL = `http://127.0.0.1:${service.port}`
    process.env.CC_HAHA_STAR_APP_SECRET = 'test-secret'
  })
  afterAll(() => {
    service.stop(true)
    fs.rmSync(configDir, { recursive: true, force: true })
    restore('CLAUDE_CONFIG_DIR', saved.config)
    restore('CC_HAHA_STAR_BASE_URL', saved.base)
    restore('CC_HAHA_STAR_APP_SECRET', saved.secret)
    restore('CC_HAHA_HOST_ARCH', saved.arch)
  })
  beforeEach(() => {
    queries = []
  })

  it('asks for the installer of the chip the Electron host reports', async () => {
    process.env.CC_HAHA_HOST_ARCH = 'arm64'
    const response = await call('?platform=win')
    expect(await response.json()).toEqual({
      version: '1.1.0',
      downloadUrl: 'https://cdn.example.com/STAR-Agent-1.1.0-win-arm64.exe',
      releaseNotes: '新芯片',
      mandatory: false,
      publishedAt: 1_793_000_000_000,
    })
    expect(queries).toEqual(['/api/desktop/update/latest?platform=win&arch=arm64'])
  })

  it('falls back to the arch the server was built for', async () => {
    delete process.env.CC_HAHA_HOST_ARCH
    await call('?platform=mac')
    const built = starHostArch({}, process.arch)
    expect(queries).toEqual([built ? `/api/desktop/update/latest?platform=mac&arch=${built}` : '/api/desktop/update/latest?platform=mac'])
  })

  it('names chips the way the console stores them, and nothing for one it does not ship', () => {
    expect(starHostArch({ CC_HAHA_HOST_ARCH: 'arm64' }, 'x64')).toBe('arm64')
    expect(starHostArch({}, 'x64')).toBe('x64')
    expect(starHostArch({}, 'arm64')).toBe('arm64')
    expect(starHostArch({ CC_HAHA_HOST_ARCH: ' AARCH64 ' }, 'x64')).toBe('arm64')
    expect(starHostArch({}, 'ia32')).toBeNull()
  })

  // The console ignores the chip: an Intel Mac must not be sent the Apple-chip dmg.
  it('points an Intel Mac at the x64 dmg and leaves every other installer alone', () => {
    const base = 'https://apisaas.spkx.cn/downloads/star-agent/1.1.0/'
    expect(starInstallerForChip(`${base}STAR-Agent-1.1.0-mac-arm64.dmg`, 'x64')).toBe(`${base}STAR-Agent-1.1.0-mac-x64.dmg`)
    expect(starInstallerForChip(`${base}STAR-Agent-1.1.0-mac-arm64.dmg`, 'arm64')).toBe(`${base}STAR-Agent-1.1.0-mac-arm64.dmg`)
    expect(starInstallerForChip(`${base}STAR-Agent-1.1.0-mac-arm64.dmg`, null)).toBe(`${base}STAR-Agent-1.1.0-mac-arm64.dmg`)
    expect(starInstallerForChip(`${base}STAR-Agent-1.1.0-win-x64.exe`, 'arm64')).toBe(`${base}STAR-Agent-1.1.0-win-x64.exe`)
    expect(starInstallerForChip('https://bo.spkx.cn/download', 'x64')).toBe('https://bo.spkx.cn/download')
  })
})
