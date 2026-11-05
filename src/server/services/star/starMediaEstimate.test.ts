import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { StarCatalog } from './starCatalog.js'
import { clearStarEstimateCache, estimateStarImageCredits, estimateStarVideoCredits } from './starMediaEstimate.js'
import { chargedImageTier, imageTierCost, videoCostAt } from './starMediaModels.js'

// The catalog has one base price per model; the console charges images by the
// tier of their size and videos by resolution and seconds. The creation page
// showed the base price for every 清晰度 / 分辨率 / 时长 (2026-11-05).
const sizes = ['auto', '1024x1024', '1536x1024', '2048x2048', '2304x1728', '2880x2880', '3840x2160']
const catalog: StarCatalog = {
  fetchedAt: 0,
  brands: [],
  chat: [],
  image: [
    { id: 'gpt-image-2.5', label: 'GPT Image 2.5', sizes, pricePerImage: 3, badge: '2K×2 4K×4' },
    { id: 'gemini-2.5-flash-image', label: 'Gemini', sizes: ['1024x1024'], pricePerImage: 1 },
  ],
  video: [
    { id: 'MiniMax-H3', label: 'MiniMax H3', resolutions: ['768P', '2K'], durations: [6, 10, 12], pricePerGeneration: 10 },
    { id: 'sd-2-fast', label: 'Seedance', resolutions: ['720P', '1080P'], durations: [5, 10], pricePerSecond: 2 },
  ],
  videoLimits: { maxReferenceImages: 3, maxReferenceVideos: 0, mediaTypes: [] },
}

describe('offline pricing follows the console rule', () => {
  test('an image is charged at the tier of the size sent', () => {
    expect(chargedImageTier('1536x1024')).toBe('1k')
    expect(chargedImageTier('2304x1728')).toBe('2k')
    expect(chargedImageTier('3840x2160')).toBe('4k')
    // `auto` and anything unparsed are charged as 1k.
    expect(chargedImageTier('auto')).toBe('1k')
    expect(imageTierCost(catalog.image[0], '1k')).toBe(3)
    expect(imageTierCost(catalog.image[0], '2k')).toBe(6)
    expect(imageTierCost(catalog.image[0], '4k')).toBe(12)
  })

  test('the badge multipliers win over the defaults', () => {
    const model = { id: 'm', label: 'm', pricePerImage: 5, badge: '2K×1.5 4K×3' }
    expect(imageTierCost(model, '2k')).toBe(8)
    expect(imageTierCost(model, '4k')).toBe(15)
  })

  test('a video changes with resolution and seconds', () => {
    const h3 = catalog.video[0]
    expect(videoCostAt(h3, 6, '768P')).toBe(12)
    // 1 + 7 × 0.2 is 2.4000000000000004 in floating point and the console
    // rounds up the same expression, so 12 s is charged 25, not 24.
    expect(videoCostAt(h3, 12, '768P')).toBe(25)
    expect(videoCostAt(h3, 12, '2K')).toBe(37)
    const perSecond = catalog.video[1]
    expect(videoCostAt(perSecond, 5, '720P')).toBe(10)
    expect(videoCostAt(perSecond, 10, '1080P')).toBe(30)
  })

  test('MiniMax H3 bills 16-30 s at twice the price, other models do not', () => {
    const h3 = { id: 'MiniMax-H3', label: 'H3', pricePerSecond: 2 }
    expect(videoCostAt(h3, 15, '768P')).toBe(30)
    expect(videoCostAt(h3, 16, '768P')).toBe(64)
    expect(videoCostAt(h3, 30, '768P')).toBe(120)
    expect(videoCostAt({ id: 'sd-2-fast', label: 'Seedance', pricePerSecond: 2 }, 30, '768P')).toBe(60)
  })
})

describe('estimates ask the console first', () => {
  const saved = { config: process.env.CLAUDE_CONFIG_DIR, base: process.env.CC_HAHA_STAR_BASE_URL, secret: process.env.CC_HAHA_STAR_APP_SECRET }
  const restore = (name: string, value: string | undefined) => { if (value === undefined) delete process.env[name]; else process.env[name] = value }
  let requests: string[] = []
  let answer: (url: URL) => Response = () => Response.json({ actual: 0 })
  let service: ReturnType<typeof Bun.serve>
  let configDir = ''

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
    configDir = fs.mkdtempSync(path.join(os.tmpdir(), 'star-estimate-'))
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
    clearStarEstimateCache()
  })

  test('an image is priced by the console for the exact size the job sends, times the count', async () => {
    answer = url => Response.json({ base: 3, actual: url.searchParams.get('size') === '3840x2160' ? 12 : 3 })
    const estimate = await estimateStarImageCredits({ model: 'gpt-image-2.5', ratio: '16:9', resolution: '4k', count: 2 }, catalog)
    expect(requests).toEqual(['/api/image/credits?model=gpt-image-2.5&size=3840x2160'])
    expect(estimate).toEqual({ credits: 24, exact: true, model: 'gpt-image-2.5', size: '3840x2160', tier: '4k' })
  })

  test('a model that draws no larger reports the tier it is charged at', async () => {
    answer = () => Response.json({ base: 1, actual: 1 })
    const estimate = await estimateStarImageCredits({ model: 'gemini-2.5-flash-image', ratio: '1:1', resolution: '4k' }, catalog)
    expect(estimate.tier).toBe('1k')
    expect(estimate.credits).toBe(1)
  })

  test('a video is priced by the console at the seconds and resolution the job runs at', async () => {
    answer = () => Response.json({ data: { base: 10, actual: 36 } })
    const estimate = await estimateStarVideoCredits({ model: 'MiniMax-H3', duration: 11, resolution: '2K' }, catalog)
    // 11 s is not offered; the job runs at the nearest listed 10 s... or 12 s.
    expect(requests).toHaveLength(1)
    expect(requests[0]).toMatch(/^\/api\/video\/credits\?model=MiniMax-H3&resolution=2K&duration=1[02]$/)
    expect(estimate).toMatchObject({ credits: 36, exact: true, model: 'MiniMax-H3', resolution: '2K' })
  })

  test('without an answer the console rule stands in, and is marked inexact', async () => {
    answer = () => new Response('down', { status: 502 })
    const video = await estimateStarVideoCredits({ model: 'MiniMax-H3', duration: 12, resolution: '2K' }, catalog)
    expect(video).toEqual({ credits: 37, exact: false, model: 'MiniMax-H3', duration: 12, resolution: '2K' })
    const image = await estimateStarImageCredits({ model: 'gpt-image-2.5', ratio: '16:9', resolution: '2k', count: 1 }, catalog)
    expect(image).toMatchObject({ credits: 6, exact: false, tier: '2k' })
  })

  test('the console answering 0 (model it cannot resolve) falls back as well', async () => {
    answer = () => Response.json({ base: 0, actual: 0 })
    const image = await estimateStarImageCredits({ model: 'gpt-image-2.5', ratio: '1:1', resolution: '1k' }, catalog)
    expect(image).toMatchObject({ credits: 3, exact: false })
  })

  test('answers are kept for a minute', async () => {
    answer = () => Response.json({ actual: 7 })
    await estimateStarVideoCredits({ model: 'sd-2-fast', duration: 5, resolution: '720P' }, catalog)
    await estimateStarVideoCredits({ model: 'sd-2-fast', duration: 5, resolution: '720P' }, catalog)
    expect(requests).toHaveLength(1)
  })
})
