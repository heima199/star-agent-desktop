import { describe, expect, it } from 'vitest'
import type { StarCatalog, StarVideoModel } from '../../api/star'
import { acceptsReferenceVideo, autoVideoModel, videoModelsFor } from './starStudioModels'

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

describe('视频参考 models', () => {
  it('offers only the models the console sends a reference video on to', () => {
    expect(VIDEO.filter(acceptsReferenceVideo).map(model => model.id)).toEqual(['sd-2-fast', 'MiniMax-H3', 'doubao-seedance-2-0-260128'])
    expect(videoModelsFor(CATALOG, 'video2video').map(model => model.id)).toEqual(['sd-2-fast', 'MiniMax-H3', 'doubao-seedance-2-0-260128'])
  })

  it('picks the cheapest of those on 自动, not Veo, which drops the video', () => {
    expect(autoVideoModel(CATALOG, 'video2video', 5)?.id).toBe('MiniMax-H3')
  })

  it('also accepts a model whose catalog entry names reference videos outright', () => {
    expect(acceptsReferenceVideo({ id: 'future-model', label: 'x', modes: ['reference_video'] })).toBe(true)
    expect(acceptsReferenceVideo({ id: 'future-model', label: 'x' })).toBe(false)
  })

  it('leaves the other modes as they were', () => {
    expect(videoModelsFor(CATALOG, 'multi2video').map(model => model.id)).toEqual(['sd-2-fast', 'MiniMax-H3', 'videoretalk', 'veo3.1-fast'])
    expect(autoVideoModel(CATALOG, 'image2video', 5)?.id).toBe('veo3.1-fast')
  })
})
