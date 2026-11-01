import { describe, expect, it } from 'vitest'
import type { StarCatalog, StarVideoModel } from '../../api/star'
import { acceptsReferenceVideo, autoVideoModel, referenceVideoAvailable, videoModelsFor } from './starStudioModels'

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
