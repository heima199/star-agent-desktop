import { describe, expect, test } from 'bun:test'
import type { StarCatalog } from './starCatalog.js'
import { acceptsReferenceVideo, pickImageModel, pickImageSize, pickVideoModel, sizeTier, supportsVideoType } from './starMediaModels.js'

describe('image size for a picked ratio', () => {
  // The production catalog's size list (2026-11-05): no 16:9 size below 4k.
  const sizes = ['auto', '1024x1024', '1024x1536', '1536x1024', '2048x2048', '1728x2304', '2304x1728', '2880x2880', '3840x2160', '2160x3840']
  const gpt = { id: 'gpt-image-2.5', label: 'GPT Image 2.5', sizes }
  const ratioOf = (size: string) => { const [w, h] = size.split('x').map(Number) as [number, number]; return w / h }
  const tierOf = (size: string) => { const [w, h] = size.split('x').map(Number) as [number, number]; return sizeTier(w, h) }

  test('every ratio keeps its shape and its price tier on a GPT Image model', () => {
    for (const ratio of ['1:1', '16:9', '9:16', '4:3', '3:4', '3:2', '2:3', '21:9']) {
      const [w, h] = ratio.split(':').map(Number) as [number, number]
      for (const tier of ['1k', '2k', '4k'] as const) {
        const size = pickImageSize(gpt, ratio, tier)
        expect(Math.abs(Math.log(ratioOf(size) / (w / h)))).toBeLessThan(Math.log(1.02))
        expect(tierOf(size)).toBe(tier)
        for (const side of size.split('x').map(Number)) expect(side % 16).toBe(0)
      }
    }
  })

  test('takes the listed size when it has the shape, and makes one when it does not', () => {
    expect(pickImageSize(gpt, '3:2', '1k')).toBe('1536x1024')
    expect(pickImageSize(gpt, '3:4', '2k')).toBe('1728x2304')
    expect(pickImageSize(gpt, '16:9', '4k')).toBe('3840x2160')
    // The 2026-11-05 test asked 16:9 / 9:16 and got 1536x1024 / 1024x1536 (3:2).
    expect(pickImageSize(gpt, '16:9', '1k')).toBe('1536x864')
    expect(pickImageSize(gpt, '9:16', '1k')).toBe('864x1536')
  })

  test('a model that only draws its listed sizes keeps the nearest one', () => {
    const fixed = { id: 'grok-imagine-image', label: 'Grok', sizes }
    expect(pickImageSize(fixed, '16:9', '1k')).toBe('1536x1024')
  })
})

describe('image model on 自动 with a picked ratio', () => {
  const catalog = {
    version: 1, fetchedAt: 0, brands: [], chat: [], video: [],
    image: [
      { id: 'gemini-2.5-flash-image', label: 'Gemini 2.5 Flash Image', pricePerImage: 1 },
      { id: 'gpt-image-2.5', label: 'GPT Image 2.5', pricePerImage: 1 },
      { id: 'gpt-image-2', label: 'GPT Image 2', pricePerImage: 5 },
    ],
  } as unknown as StarCatalog

  test('keeps the cheap default without a shape, and skips the square-only model with one', () => {
    expect(pickImageModel(catalog, undefined, false)?.id).toBe('gemini-2.5-flash-image')
    expect(pickImageModel(catalog, undefined, false, '1:1')?.id).toBe('gemini-2.5-flash-image')
    expect(pickImageModel(catalog, undefined, false, '16:9')?.id).toBe('gpt-image-2.5')
    expect(pickImageModel(catalog, undefined, true, '3:4')?.id).toBe('gpt-image-2.5')
  })

  test('a model the user picked is kept', () => {
    expect(pickImageModel(catalog, 'gemini-2.5-flash-image', false, '16:9')?.id).toBe('gemini-2.5-flash-image')
  })
})

/** The video models of the production catalog (2026-11-01): `reference` alone does not say video. */
const CATALOG = {
  version: 1,
  fetchedAt: 0,
  brands: [],
  chat: [],
  image: [],
  video: [
    { id: 'veo3.1-fast', label: 'veo3.1-fast', modes: ['text', 'first_frame', 'reference'], durations: [8], pricePerGeneration: 5 },
    { id: 'MiniMax-H3', label: 'MiniMax H3', modes: ['text', 'first_frame', 'first_last_frame', 'reference'], durations: [4, 5, 6], pricePerGeneration: 10 },
    { id: 'sd-2-fast', label: 'Sd 2 Fast', modes: ['text', 'first_frame', 'first_last_frame', 'reference'], durations: [5, 10], pricePerGeneration: 38 },
    { id: 'videoretalk', label: '声动人像·对口型', modes: ['reference'], durations: [5, 10], pricePerSecond: 2 },
    { id: 'doubao-seedance-2-0-260128', label: 'Seedance 2.0', modes: ['text', 'first_frame', 'first_last_frame'], durations: [5, 10], pricePerGeneration: 50 },
  ],
  videoLimits: { maxReferenceImages: 3, maxReferenceVideos: 0, mediaTypes: [] },
} as unknown as StarCatalog

/** The catalog once the console marks models as taking reference videos. */
function marking(...ids: string[]): StarCatalog {
  return { ...CATALOG, video: CATALOG.video.map(model => (ids.includes(model.id) ? { ...model, modes: [...(model.modes ?? []), 'reference_video'] } : model)) }
}

describe('reference-video model choice', () => {
  test('no model takes ref2video jobs on `reference` or on its name', () => {
    expect(CATALOG.video.filter(model => supportsVideoType(model, 'ref2video'))).toEqual([])
    expect(pickVideoModel(CATALOG, undefined, 'ref2video', 5)).toBeUndefined()
    expect(acceptsReferenceVideo({ id: 'sd-2-fast', label: 'Sd 2 Fast' })).toBe(false)
  })

  test('a model the console marks reference_video takes them', () => {
    expect(acceptsReferenceVideo({ id: 'next', label: 'next', modes: ['reference_video'] })).toBe(true)
    expect(marking('sd-2-fast', 'doubao-seedance-2-0-260128').video.filter(model => supportsVideoType(model, 'ref2video')).map(model => model.id))
      .toEqual(['sd-2-fast', 'doubao-seedance-2-0-260128'])
  })

  test('自动 picks the cheapest marked model instead of Veo', () => {
    expect(pickVideoModel(marking('sd-2-fast', 'doubao-seedance-2-0-260128'), undefined, 'ref2video', 5)?.id).toBe('sd-2-fast')
  })

  test('without such a model there is no stand-in for a reference-video job', () => {
    const veoOnly = { ...CATALOG, video: [CATALOG.video[0]!] } as StarCatalog
    expect(pickVideoModel(veoOnly, undefined, 'ref2video', 5)).toBeUndefined()
    // Other job types still fall back to whatever the catalog has.
    expect(pickVideoModel(veoOnly, undefined, 'frames2video', 5)?.id).toBe('veo3.1-fast')
  })

  test('image references keep their models', () => {
    expect(CATALOG.video.filter(model => supportsVideoType(model, 'img2video')).map(model => model.id))
      .toEqual(['veo3.1-fast', 'MiniMax-H3', 'sd-2-fast', 'videoretalk', 'doubao-seedance-2-0-260128'])
  })
})
