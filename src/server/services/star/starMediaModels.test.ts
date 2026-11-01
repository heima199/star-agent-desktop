import { describe, expect, test } from 'bun:test'
import type { StarCatalog } from './starCatalog.js'
import { acceptsReferenceVideo, pickVideoModel, supportsVideoType } from './starMediaModels.js'

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
