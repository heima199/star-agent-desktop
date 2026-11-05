import { describe, expect, it } from 'vitest'
import type { StarCatalog, StarVideoModel } from '../../api/star'
import { acceptsReferenceVideo, autoImageModel, autoVideoModel, imageRatioIgnored, imageTierCost, imageTierNote, referenceVideoAvailable, videoCostAt, videoModelsFor } from './starStudioModels'

/** The video models of the production catalog (2026-11-01), as the desktop config lists them. */
const VIDEO: StarVideoModel[] = [
  { id: 'sd-2-fast', label: 'Sd 2 Fast', modes: ['text', 'first_frame', 'first_last_frame', 'reference'], durations: [5, 10, 15], pricePerGeneration: 38 },
  { id: 'MiniMax-H3', label: 'MiniMax H3', modes: ['text', 'first_frame', 'first_last_frame', 'reference'], durations: [6, 4, 5, 8, 10, 12, 15], pricePerGeneration: 10 },
  { id: 'videoretalk', label: '声动人像·对口型', modes: ['reference'], durations: [5, 10], pricePerSecond: 2 },
  { id: 'wan2.2-s2v', label: '万相数字人', modes: ['first_frame'], durations: [5, 10], pricePerSecond: 7 },
  { id: 'doubao-seedance-2-0-260128', label: 'Seedance 2.0', modes: ['text', 'first_frame', 'first_last_frame'], durations: [5, 10, 15], pricePerGeneration: 50 },
  { id: 'veo3.1-fast', label: 'veo3.1-fast', modes: ['text', 'first_frame', 'reference'], durations: [8], pricePerGeneration: 5 },
]

const CATALOG = { video: VIDEO, image: [], chat: [], brands: [], fetchedAt: 0, videoLimits: { maxReferenceImages: 3, maxReferenceVideos: 0, mediaTypes: [] } } as StarCatalog

/** The catalog once the console marks models as taking reference videos. */
function marking(...ids: string[]): StarCatalog {
  return { ...CATALOG, video: VIDEO.map(model => (ids.includes(model.id) ? { ...model, modes: [...(model.modes ?? []), 'reference_video'] } : model)) }
}

describe('image ratio on 自动', () => {
  const IMAGE = [
    { id: 'gemini-2.5-flash-image', label: 'Gemini 2.5 Flash Image', pricePerImage: 1 },
    { id: 'gpt-image-2.5', label: 'GPT Image 2.5', pricePerImage: 1 },
    { id: 'gpt-image-2', label: 'GPT Image 2', pricePerImage: 5 },
  ]
  const catalog = { ...CATALOG, image: IMAGE } as StarCatalog

  it('keeps the cheap default when no shape is picked', () => {
    expect(autoImageModel(catalog, 'text2image')?.id).toBe('gemini-2.5-flash-image')
    expect(autoImageModel(catalog, 'text2image', 'auto')?.id).toBe('gemini-2.5-flash-image')
    expect(autoImageModel(catalog, 'text2image', '1:1')?.id).toBe('gemini-2.5-flash-image')
  })

  it('takes a model that keeps the ratio once one is picked (Gemini 2.5 Flash returns squares)', () => {
    expect(autoImageModel(catalog, 'text2image', '16:9')?.id).toBe('gpt-image-2.5')
    expect(autoImageModel(catalog, 'image2image', '3:4')?.id).toBe('gpt-image-2.5')
  })

  it('warns only when the picked model will not keep a picked shape', () => {
    expect(imageRatioIgnored(IMAGE[0], '16:9')).toBe(true)
    expect(imageRatioIgnored(IMAGE[0], '1:1')).toBe(false)
    expect(imageRatioIgnored(IMAGE[0], 'auto')).toBe(false)
    expect(imageRatioIgnored(IMAGE[1], '16:9')).toBe(false)
  })
})

describe('视频参考 models', () => {
  it('takes no model on `reference` or on its name, so today 视频参考 is off', () => {
    expect(VIDEO.filter(acceptsReferenceVideo)).toEqual([])
    expect(videoModelsFor(CATALOG, 'video2video')).toEqual([])
    expect(autoVideoModel(CATALOG, 'video2video', 5)).toBeUndefined()
    expect(referenceVideoAvailable(CATALOG)).toBe(false)
    expect(referenceVideoAvailable(null)).toBe(false)
  })

  it('comes back once the console marks a model reference_video', () => {
    expect(acceptsReferenceVideo({ id: 'future-model', label: 'x', modes: ['reference_video'] })).toBe(true)
    expect(acceptsReferenceVideo({ id: 'future-model', label: 'x' })).toBe(false)
    const catalog = marking('sd-2-fast', 'doubao-seedance-2-0-260128')
    expect(referenceVideoAvailable(catalog)).toBe(true)
    expect(videoModelsFor(catalog, 'video2video').map(model => model.id)).toEqual(['sd-2-fast', 'doubao-seedance-2-0-260128'])
  })

  it('picks the cheapest marked model on 自动, not Veo, which drops the video', () => {
    expect(autoVideoModel(marking('sd-2-fast', 'doubao-seedance-2-0-260128'), 'video2video', 5)?.id).toBe('sd-2-fast')
  })

  it('leaves the other modes as they were', () => {
    expect(videoModelsFor(CATALOG, 'multi2video').map(model => model.id)).toEqual(['sd-2-fast', 'MiniMax-H3', 'videoretalk', 'veo3.1-fast'])
    expect(autoVideoModel(CATALOG, 'image2video', 5)?.id).toBe('veo3.1-fast')
  })
})

// The creation page showed the catalog's base price for every pick: "约 1 积分"
// at 4K and "约 10 积分" at 2K / 12 s (2026-11-05). The console charges an
// image by its tier and a video by resolution and seconds.
describe('prices follow 清晰度, 分辨率 and 时长', () => {
  it('an image costs more at 2K and 4K, by the badge multipliers when it lists them', () => {
    const plain = { id: 'gemini-2.5-flash-image', label: 'Gemini', pricePerImage: 1 }
    expect([imageTierCost(plain, '1k'), imageTierCost(plain, '2k'), imageTierCost(plain, '4k')]).toEqual([1, 2, 4])
    const badged = { id: 'gpt-image-2.5', label: 'GPT', pricePerImage: 5, badge: '2K×1.5 4K×3' }
    expect([imageTierCost(badged, '2k'), imageTierCost(badged, '4k')]).toEqual([8, 15])
  })

  it('a video costs more for longer and sharper clips', () => {
    const h3 = VIDEO.find(model => model.id === 'MiniMax-H3')!
    const at = (seconds: number, resolution: string) => videoCostAt(h3, seconds, resolution)
    expect(at(6, '768P')).toBeLessThan(at(10, '768P')!)
    expect(at(10, '768P')).toBeLessThan(at(12, '768P')!)
    expect(at(12, '768P')).toBeLessThan(at(12, '2K')!)
    const perSecond = VIDEO.find(model => model.id === 'videoretalk')!
    expect(videoCostAt(perSecond, 10, '720P')).toBe(20)
  })

  it('says when the model draws, and charges, a lower tier than picked', () => {
    expect(imageTierNote('4k', '4k', '16:9')).toBeNull()
    expect(imageTierNote('4k', undefined, '16:9')).toBeNull()
    expect(imageTierNote('4k', '1k', '1:1')).toContain('最高出 1K')
    expect(imageTierNote('4k', '1k', 'auto')).toContain('请选一个比例')
  })
})
