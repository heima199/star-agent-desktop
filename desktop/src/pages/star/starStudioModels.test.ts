import { describe, expect, it } from 'vitest'
import type { StarCatalog, StarVideoModel } from '../../api/star'
import { acceptsReferenceVideo, autoImageModel, autoVideoModel, imageModelsFor, imageModeWith, imageRatioIgnored, imageTierCost, imageTierNote, keptModel, listedVideoCost, mediaModelLabel, referenceRefusal, referenceRoom, referenceSlot, referenceVideoAvailable, risingDurations, risingResolutions, shownRows, videoCostAt, videoModelsFor, videoRatioLabel, type VideoMode } from './starStudioModels'

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

  it('shows durations rising, whatever order the console lists them in', () => {
    const listed = [6, 4, 5, 8, 10, 12, 15]
    expect(risingDurations(listed)).toEqual([4, 5, 6, 8, 10, 12, 15])
    expect(listed[0]).toBe(6)
  })

  it('shows resolutions from the smallest to the largest', () => {
    expect(risingResolutions(['768P', '1080P', '2K', '480P'])).toEqual(['480P', '768P', '1080P', '2K'])
    expect(risingResolutions(['4K', '720p', '1080P'])).toEqual(['720p', '1080P', '4K'])
    expect(risingResolutions(['原画', '1080P', '高清'])).toEqual(['1080P', '原画', '高清'])
  })

  it('lists the picked video model at the price the console answered, the others by the rule', () => {
    const h3 = VIDEO.find(model => model.id === 'MiniMax-H3')!
    const fast = VIDEO.find(model => model.id === 'sd-2-fast')!
    expect(listedVideoCost(h3, 'MiniMax-H3', 7, 4, '480P')).toBe(7)
    expect(listedVideoCost(h3, 'MiniMax-H3', undefined, 4, '480P')).toBe(10)
    expect(listedVideoCost(h3, '', 7, 4, '480P')).toBe(10)
    expect(listedVideoCost(fast, 'MiniMax-H3', 7, 4, '480P')).toBe(38)
  })

  it('names the ratio words in Chinese and leaves the numbers alone', () => {
    expect(videoRatioLabel('adaptive')).toBe('自适应')
    expect(videoRatioLabel('auto')).toBe('自动')
    expect(videoRatioLabel('16:9')).toBe('16:9')
  })
})

// Picking the 3-credit image model and then 「用作参考」 (文生图 to 图生图) put the
// form back on 自动, the 10-credit model, without a word (2026-11-22).
describe('the picked model across modes', () => {
  const IMAGE = [
    { id: 'gpt-image-2', label: 'GPT Image 2', pricePerImage: 10 },
    { id: 'gemini-3.1-flash-image', label: 'Gemini 3.1 Flash Image', pricePerImage: 3 },
    { id: 'draw-only', label: 'Draw Only', pricePerImage: 1, supportsEdit: false },
  ]
  const catalog = { ...CATALOG, image: IMAGE } as StarCatalog

  it('stays picked in a mode that offers it too', () => {
    expect(keptModel('gemini-3.1-flash-image', imageModelsFor(catalog, 'image2image'))).toBe('gemini-3.1-flash-image')
    expect(keptModel('MiniMax-H3', videoModelsFor(CATALOG, 'image2video'))).toBe('MiniMax-H3')
  })

  it('goes back to 自动 in a mode that does not offer it', () => {
    expect(keptModel('draw-only', imageModelsFor(catalog, 'image2image'))).toBe('')
    expect(keptModel('gemini-3.1-flash-image', videoModelsFor(CATALOG, 'text2video'))).toBe('')
    expect(keptModel('wan2.2-s2v', videoModelsFor(CATALOG, 'text2video'))).toBe('')
  })

  it('has nothing picked on 自动, or while no catalog lists the model', () => {
    expect(keptModel('', imageModelsFor(catalog, 'text2image'))).toBe('')
    expect(keptModel('gpt-image-2', imageModelsFor(null, 'text2image'))).toBe('')
  })

  it('is shown under the name of the model list, not under its id', () => {
    expect(mediaModelLabel(catalog, 'gemini-3.1-flash-image')).toBe('Gemini 3.1 Flash Image')
    expect(mediaModelLabel(catalog, 'MiniMax-H3')).toBe('MiniMax H3')
    expect(mediaModelLabel(catalog, 'a-model-no-longer-listed')).toBe('a-model-no-longer-listed')
    expect(mediaModelLabel(null, 'gpt-image-2')).toBe('gpt-image-2')
  })
})

// 「用作参考」 on a picture while the form was on 视频参考 put it in the 首帧 row, which
// that mode does not show, and the request then took it along; pressing it twice
// on one output attached the output twice (2026-11-22).
describe('「用作参考」', () => {
  const VIDEO_MODES_ALL: VideoMode[] = ['text2video', 'image2video', 'frames2video', 'multi2video', 'video2video']

  it('puts a picture in the row the form shows', () => {
    expect(referenceSlot('image', 'image', 'text2video')).toEqual({ slot: 'refs', max: 16 })
    expect(referenceSlot('image', 'video', 'text2video')).toEqual({ slot: 'first', max: 1 })
    expect(referenceSlot('image', 'video', 'image2video')).toEqual({ slot: 'first', max: 1 })
    expect(referenceSlot('image', 'video', 'frames2video')).toEqual({ slot: 'first', max: 1 })
    expect(referenceSlot('image', 'video', 'multi2video')).toEqual({ slot: 'refs', max: 8 })
    expect(referenceSlot('image', 'video', 'video2video')).toEqual({ slot: 'refs', max: 8 })
  })

  it('puts a video with the reference videos, wherever the form is', () => {
    expect(referenceSlot('video', 'image', 'text2video')).toEqual({ slot: 'videos', max: 3 })
    expect(referenceSlot('video', 'video', 'multi2video')).toEqual({ slot: 'videos', max: 3 })
  })

  it('shows, checks and sends the same rows in every mode', () => {
    expect(shownRows('image', 'text2image', 'video2video')).toEqual({ refs: 0, first: 0, last: 0, videos: 0 })
    expect(shownRows('image', 'image2image', 'text2video')).toEqual({ refs: 1, first: 0, last: 0, videos: 0 })
    expect(shownRows('image', 'multi2image', 'text2video')).toEqual({ refs: 16, first: 0, last: 0, videos: 0 })
    expect(shownRows('video', 'multi2image', 'text2video')).toEqual({ refs: 0, first: 0, last: 0, videos: 0 })
    expect(shownRows('video', 'text2image', 'image2video')).toEqual({ refs: 0, first: 1, last: 0, videos: 0 })
    expect(shownRows('video', 'text2image', 'frames2video')).toEqual({ refs: 0, first: 1, last: 1, videos: 0 })
    expect(shownRows('video', 'text2image', 'multi2video')).toEqual({ refs: 8, first: 0, last: 0, videos: 0 })
    // 视频参考 shows no 首帧 row, so a first frame left over from 图生视频 is not sent with it.
    expect(shownRows('video', 'text2image', 'video2video')).toEqual({ refs: 8, first: 0, last: 0, videos: 3 })
  })

  it('puts a picture only in a row the mode shows', () => {
    for (const mode of VIDEO_MODES_ALL) {
      const { slot } = referenceSlot('image', 'video', mode)
      // 文生视频 moves to 图生视频 when it takes a picture.
      const rows = shownRows('video', 'text2image', slot === 'first' && mode === 'text2video' ? 'image2video' : mode)
      expect(rows[slot]).toBeGreaterThan(0)
    }
  })

  it('attaches one output once, and says so instead of dropping it', () => {
    expect(referenceRoom([], 'a', 3)).toBe('room')
    expect(referenceRoom(['a'], 'b', 3)).toBe('room')
    expect(referenceRoom(['a', undefined], 'a', 3)).toBe('attached')
    expect(referenceRoom(['a', 'b', 'c'], 'd', 3)).toBe('full')
    expect(referenceRoom(['a', 'b', 'c'], 'c', 3)).toBe('attached')
    expect(referenceRefusal('image', 'attached', 16)).toBe('这张图片已经在参考里了')
    expect(referenceRefusal('video', 'attached', 3)).toBe('这个视频已经在参考里了')
    expect(referenceRefusal('image', 'full', 8)).toContain('最多 8 张')
    expect(referenceRefusal('video', 'full', 3)).toContain('最多 3 个')
  })

  it('moves 图片 to 图生图 for one picture and to 多图参考 for more', () => {
    expect(imageModeWith('text2image', 1)).toBe('image2image')
    expect(imageModeWith('image2image', 1)).toBe('image2image')
    expect(imageModeWith('image2image', 2)).toBe('multi2image')
    expect(imageModeWith('text2image', 3)).toBe('multi2image')
    expect(imageModeWith('multi2image', 1)).toBe('multi2image')
  })
})
