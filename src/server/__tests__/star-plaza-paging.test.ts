import { afterAll, beforeAll, beforeEach, describe, expect, it, setSystemTime } from 'bun:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { isStarDisconnect, StarApiError, starRequest } from '../services/star/starClient.js'
import type { StarSettings } from '../services/star/starConfig.js'
import { forgetPlazaListsInMemory, getStarPlaza, pagePlazaList } from '../services/star/starPortalService.js'

function plaza(count: number, total = count) {
  return {
    categories: [{ id: 'image', name: '图片', children: [] }],
    items: Array.from({ length: count }, (_, index) => ({
      id: `w-${index}`, category: 'image', subcategory: '', title: `作品 ${index}`, summary: '', coverUrl: `https://cdn.example.test/${index}.png`, prompt: 'p', invokePath: '/image',
    })),
    total,
  }
}

// 灵感设计的加载需要单次加载15个即可: the STAR service returns the whole list.
describe('pagePlazaList', () => {
  it('cuts an unpaged answer into the requested page', () => {
    const full = plaza(1027)
    const first = pagePlazaList(full, 1, 15)
    expect(first.items.map(item => item.id)).toEqual(Array.from({ length: 15 }, (_, index) => `w-${index}`))
    expect(first.total).toBe(1027)
    expect(first.categories).toEqual(full.categories)

    expect(pagePlazaList(full, 2, 15).items[0]?.id).toBe('w-15')
    expect(pagePlazaList(full, 69, 15).items.map(item => item.id)).toEqual(['w-1020', 'w-1021', 'w-1022', 'w-1023', 'w-1024', 'w-1025', 'w-1026'])
    expect(pagePlazaList(full, 70, 15).items).toEqual([])
  })

  it('keeps a page the service already cut, and its total', () => {
    const page = plaza(15, 400)
    expect(pagePlazaList(page, 3, 15)).toBe(page)
  })
})

// 灵感社区 took 10–60 s to open: every first page downloaded the whole 5 MB
// list again. A list is now downloaded once, kept in memory and on disk, and
// replaced in the background once it is a few minutes old.
describe('getStarPlaza keeps lists', () => {
  const saved = { config: process.env.CLAUDE_CONFIG_DIR, base: process.env.CC_HAHA_STAR_BASE_URL, secret: process.env.CC_HAHA_STAR_APP_SECRET }
  const restore = (name: string, value: string | undefined) => { if (value === undefined) delete process.env[name]; else process.env[name] = value }
  const works = (prefix: string, count: number, total = count, from = 0) => ({
    categories: [{ id: 'image', name: '图片', children: [] }],
    items: Array.from({ length: count }, (_, index) => ({
      id: `${prefix}-${from + index}`, category: 'image', subcategory: '', title: `作品 ${from + index}`, summary: '', coverUrl: '', prompt: 'p', invokePath: '/image',
    })),
    total,
  })
  let requests: string[] = []
  let answer: (url: URL) => Response = () => Response.json(works('w', 30))
  let service: ReturnType<typeof Bun.serve>
  let configDir = ''
  const ids = (page: { items: { id: string }[] }) => page.items.map(item => item.id)
  const settled = async (count: number) => {
    for (let wait = 0; wait < 100 && requests.length < count; wait++) await Bun.sleep(20)
    // The kept list is written right after the answer arrives.
    await Bun.sleep(50)
  }

  beforeAll(() => {
    service = Bun.serve({
      hostname: '127.0.0.1',
      port: 0,
      fetch(request) {
        const url = new URL(request.url)
        requests.push(`${url.pathname}${url.search}`)
        return answer(url)
      },
    })
    configDir = fs.mkdtempSync(path.join(os.tmpdir(), 'star-plaza-'))
    process.env.CLAUDE_CONFIG_DIR = configDir
    process.env.CC_HAHA_STAR_BASE_URL = `http://127.0.0.1:${service.port}`
    process.env.CC_HAHA_STAR_APP_SECRET = 'test-secret'
  })

  afterAll(() => {
    setSystemTime()
    service.stop(true)
    forgetPlazaListsInMemory()
    fs.rmSync(configDir, { recursive: true, force: true })
    restore('CLAUDE_CONFIG_DIR', saved.config)
    restore('CC_HAHA_STAR_BASE_URL', saved.base)
    restore('CC_HAHA_STAR_APP_SECRET', saved.secret)
  })

  beforeEach(() => {
    setSystemTime()
    requests = []
    answer = () => Response.json(works('w', 30))
    forgetPlazaListsInMemory()
    fs.rmSync(path.join(configDir, 'cc-haha'), { recursive: true, force: true })
  })

  it('serves every page from one download, the first page again included', async () => {
    expect(ids(await getStarPlaza({ page: 1, pageSize: 12 }))).toEqual(Array.from({ length: 12 }, (_, index) => `w-${index}`))
    expect(ids(await getStarPlaza({ page: 3, pageSize: 12 }))).toEqual(['w-24', 'w-25', 'w-26', 'w-27', 'w-28', 'w-29'])
    expect((await getStarPlaza({ page: 1, pageSize: 12 })).total).toBe(30)
    expect(requests).toHaveLength(1)
    // A category is a list of its own.
    await getStarPlaza({ category: 'image', page: 1, pageSize: 12 })
    expect(requests).toHaveLength(2)
    expect(requests[1]).toContain('category=image')
  })

  it('serves a list gone stale at once and replaces it in the background', async () => {
    const start = new Date('2026-10-30T08:00:00Z')
    setSystemTime(start)
    await getStarPlaza({ page: 1, pageSize: 12 })
    answer = () => Response.json(works('n', 30))

    setSystemTime(new Date(start.getTime() + 6 * 60_000))
    expect(ids(await getStarPlaza({ page: 1, pageSize: 12 }))[0]).toBe('w-0')
    await settled(2)
    expect(ids(await getStarPlaza({ page: 1, pageSize: 12 }))[0]).toBe('n-0')
    expect(requests).toHaveLength(2)
  })

  it('keeps lists on disk for the next start', async () => {
    await getStarPlaza({ page: 1, pageSize: 12 })
    forgetPlazaListsInMemory()
    answer = () => new Response('unavailable', { status: 503 })

    expect(ids(await getStarPlaza({ page: 2, pageSize: 12 }))[0]).toBe('w-12')
    expect(requests).toHaveLength(1)
  })

  it('downloads a list kept too long again first, and still serves it while the service is down', async () => {
    const start = new Date('2026-10-30T08:00:00Z')
    setSystemTime(start)
    await getStarPlaza({ page: 1, pageSize: 12 })
    setSystemTime(new Date(start.getTime() + 25 * 60 * 60_000))

    answer = () => new Response('unavailable', { status: 503 })
    expect(ids(await getStarPlaza({ page: 1, pageSize: 12 }))[0]).toBe('w-0')
    answer = () => Response.json(works('n', 30))
    expect(ids(await getStarPlaza({ page: 1, pageSize: 12 }))[0]).toBe('n-0')
    expect(requests).toHaveLength(3)
  })

  it('never keeps one page of a longer list', async () => {
    answer = url => {
      const page = Number(url.searchParams.get('page'))
      return Response.json(works('s', 12, 369_612, (page - 1) * 12))
    }
    expect(ids(await getStarPlaza({ category: 'skill', page: 1, pageSize: 12 }))[0]).toBe('s-0')
    expect(ids(await getStarPlaza({ category: 'skill', page: 2, pageSize: 12 }))[0]).toBe('s-12')
    expect(ids(await getStarPlaza({ category: 'skill', page: 1, pageSize: 12 }))[0]).toBe('s-0')
    expect(requests).toHaveLength(3)
    expect(fs.existsSync(path.join(configDir, 'cc-haha', 'star', 'plaza'))).toBe(false)
  })
})

// 「STAR 服务不可达：The socket connection was closed unexpectedly」: the
// service (or a proxy before it) closed a connection under a request. The plaza
// and the research tools now send such a request again on a fresh connection.
describe('starRequest when the connection drops', () => {
  /** A service that closes its first `drops` connections unanswered and answers the rest. */
  function flakyService(drops: number) {
    let connections = 0
    const dropped = new WeakSet<object>()
    const server = Bun.listen({
      hostname: '127.0.0.1',
      port: 0,
      socket: {
        open(socket) {
          connections += 1
          if (connections <= drops) {
            dropped.add(socket)
            socket.end()
          }
        },
        data(socket) {
          if (dropped.has(socket)) return
          socket.write('HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: 11\r\nConnection: close\r\n\r\n{"ok":true}')
          socket.end()
        },
      },
    })
    const settings = { configured: true, baseUrl: `http://127.0.0.1:${server.port}`, appSecret: 'test-secret' } as unknown as StarSettings
    return { settings, connections: () => connections, stop: () => server.stop(true) }
  }

  it('sends a read again on a fresh connection', async () => {
    const service = flakyService(1)
    try {
      expect(await starRequest('GET', '/plaza', { settings: service.settings, timeoutMs: 10_000 })).toEqual({ ok: true })
      expect(service.connections()).toBe(2)
    } finally {
      service.stop()
    }
  })

  it('does not repeat a request with an effect unless it says a repeat is harmless', async () => {
    const service = flakyService(1)
    try {
      const failure = await starRequest('POST', '/payment/create', { settings: service.settings, body: {}, timeoutMs: 10_000 }).catch(error => error)
      expect(failure).toBeInstanceOf(StarApiError)
      expect((failure as StarApiError).code).toBe('STAR_UNREACHABLE')
      expect(service.connections()).toBe(1)

      expect(await starRequest('POST', '/skills/web-search/execute', { settings: service.settings, body: {}, timeoutMs: 10_000, retryOnDisconnect: true })).toEqual({ ok: true })
    } finally {
      service.stop()
    }
  })

  it('gives up after two repeats', async () => {
    const service = flakyService(5)
    try {
      const failure = await starRequest('GET', '/plaza', { settings: service.settings, timeoutMs: 10_000 }).catch(error => error)
      expect((failure as StarApiError).code).toBe('STAR_UNREACHABLE')
      expect(service.connections()).toBe(3)
    } finally {
      service.stop()
    }
  })

  it('tells a dropped connection from an answer, a timeout or a cancel', () => {
    expect(isStarDisconnect(new Error('The socket connection was closed unexpectedly. For more information, pass `verbose: true` in the second argument to fetch()'))).toBe(true)
    expect(isStarDisconnect(Object.assign(new Error('closed'), { code: 'ConnectionClosed' }))).toBe(true)
    expect(isStarDisconnect(Object.assign(new TypeError('fetch failed'), { cause: Object.assign(new Error('other side closed'), { code: 'UND_ERR_SOCKET' }) }))).toBe(true)
    expect(isStarDisconnect(Object.assign(new Error('timed out'), { name: 'TimeoutError' }))).toBe(false)
    expect(isStarDisconnect(Object.assign(new Error('aborted'), { name: 'AbortError' }))).toBe(false)
    expect(isStarDisconnect(new Error('STAR 服务返回 500'))).toBe(false)
  })
})
