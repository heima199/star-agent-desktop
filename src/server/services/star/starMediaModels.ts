/**
 * Model and parameter choice for STAR media jobs: default models, image size
 * from ratio + resolution tier, video duration / ratio / resolution within
 * what the model lists, and the credit estimate shown before a job runs.
 */

import type { StarCatalog, StarImageModel, StarVideoModel } from './starCatalog.js'

export type StarVideoType = 'txt2video' | 'img2video' | 'frames2video' | 'ref2video'

/** Cheap, edit-capable image models first. */
const PREFERRED_IMAGE_MODELS = [
  'gemini-2.5-flash-image',
  'gemini-3.1-flash-image-preview',
  'gpt-image-2',
  'gpt-image-2.5',
]

const VIDEO_MODE_ALIASES: Record<Exclude<StarVideoType, 'ref2video'>, string[]> = {
  txt2video: ['text', 'txt', 'text2video', 'txt2video'],
  img2video: ['first_frame', 'image', 'img', 'img2video', 'image2video', 'reference', 'multi_image'],
  frames2video: ['first_last_frame', 'frames', 'frames2video', 'last_frame'],
}

/** Catalog modes that name a reference video outright. */
const REFERENCE_VIDEO_MODES = ['reference_video', 'video', 'video2video', 'ref2video', 'multimodal']

/**
 * Only a model whose catalog entry names reference videos outright takes
 * them. `reference` alone also means reference images, and no model is taken
 * on its name any more: in production (2026-11-01) Seedance 2 through the
 * router came back as plain text-to-video with the video dropped (still
 * charged), and MiniMax H3 refused reference videos. Reference-video jobs are
 * refused before anything is charged until the console marks a model
 * `reference_video`.
 */
export function acceptsReferenceVideo(model: StarVideoModel): boolean {
  return Boolean(model.modes?.some(mode => REFERENCE_VIDEO_MODES.includes(mode.toLowerCase())))
}

/** Shown when a reference-video job has no model that takes reference videos. */
export const REFERENCE_VIDEO_UNAVAILABLE = '参考视频生成暂未开放：现在的视频模型还不能按参考视频生成。可以截取视频里的一帧作为首帧或参考图，用图生视频。'

export const IMAGE_SIZE_RE = /^(\d{3,4}x\d{3,4}|auto)$/

const RATIO_BASE: Record<string, [number, number]> = {
  '1:1': [1024, 1024],
  '2:3': [1024, 1536],
  '3:2': [1536, 1024],
  '3:4': [960, 1280],
  '4:3': [1280, 960],
  '9:16': [1024, 1792],
  '16:9': [1792, 1024],
  '21:9': [2016, 864],
}

export const IMAGE_RATIOS = Object.keys(RATIO_BASE)

const TIER_PIXELS: Record<string, number> = { '1k': 1.05e6, '2k': 4.2e6, '4k': 8.3e6 }

export function normalizeTier(value: string | undefined): '1k' | '2k' | '4k' | undefined {
  const tier = value?.trim().toLowerCase()
  return tier === '1k' || tier === '2k' || tier === '4k' ? tier : undefined
}

function parseSize(value: string): [number, number] | null {
  const match = /^(\d{3,4})x(\d{3,4})$/.exec(value.trim())
  return match ? [Number(match[1]), Number(match[2])] : null
}

/** WIDTHxHEIGHT for a ratio and tier, chosen from the model's own size list when it has one. */
export function pickImageSize(model: StarImageModel | undefined, ratio?: string, resolution?: string): string {
  const listed = (model?.sizes ?? []).map(parseSize).filter((item): item is [number, number] => item !== null)
  const base = ratio ? RATIO_BASE[ratio.trim()] : undefined
  if (!base) {
    if (!listed.length || model?.sizes?.includes('auto')) return 'auto'
    return `${listed[0]![0]}x${listed[0]![1]}`
  }
  const tier = normalizeTier(resolution) ?? '1k'
  const targetRatio = base[0] / base[1]
  const targetPixels = TIER_PIXELS[tier]!
  if (listed.length) {
    let best = listed[0]!
    let bestScore = Number.POSITIVE_INFINITY
    for (const [w, h] of listed) {
      const score = Math.abs(Math.log((w / h) / targetRatio)) * 10 + Math.abs(Math.log((w * h) / targetPixels))
      if (score < bestScore) {
        bestScore = score
        best = [w, h]
      }
    }
    return `${best[0]}x${best[1]}`
  }
  const scale = tier === '1k' ? 1 : 2
  const clampSide = (value: number) => Math.min(2048, Math.max(256, Math.floor((value * scale) / 64) * 64))
  return `${clampSide(base[0])}x${clampSide(base[1])}`
}

export function pickImageModel(
  catalog: StarCatalog | null,
  requested: string | undefined,
  needsEdit: boolean,
): StarImageModel | undefined {
  const list = catalog?.image ?? []
  if (requested) return list.find(model => model.id === requested) ?? { id: requested, label: requested }
  const candidates = needsEdit ? list.filter(model => model.supportsEdit !== false) : list
  for (const id of PREFERRED_IMAGE_MODELS) {
    const found = candidates.find(model => model.id === id)
    if (found) return found
  }
  return candidates[0] ?? list[0]
}

export function supportsVideoType(model: StarVideoModel, type: StarVideoType): boolean {
  if (type === 'ref2video') return acceptsReferenceVideo(model)
  if (!model.modes?.length) return true
  const aliases = VIDEO_MODE_ALIASES[type]
  return model.modes.some(mode => aliases.includes(mode.toLowerCase()))
}

/** Credits for one job, or undefined when the catalog lists no price. */
export function videoCost(model: StarVideoModel | undefined, duration: number): number | undefined {
  if (!model) return undefined
  if (model.pricePerGeneration && model.pricePerGeneration > 0) return model.pricePerGeneration
  if (model.pricePerSecond && model.pricePerSecond > 0) return Math.round(model.pricePerSecond * duration * 100) / 100
  return undefined
}

export function imageCost(model: StarImageModel | undefined, count: number): number | undefined {
  return model?.pricePerImage !== undefined && model.pricePerImage > 0 ? model.pricePerImage * count : undefined
}

export function pickVideoModel(
  catalog: StarCatalog | null,
  requested: string | undefined,
  type: StarVideoType,
  duration: number | undefined,
): StarVideoModel | undefined {
  const list = catalog?.video ?? []
  if (requested) return list.find(model => model.id === requested) ?? { id: requested, label: requested }
  const candidates = list.filter(model => supportsVideoType(model, type))
  // A reference video sent to a model that drops it gives an unrelated clip:
  // no stand-in for that one.
  if (!candidates.length && type === 'ref2video') return undefined
  const seconds = duration ?? 5
  const ranked = [...(candidates.length ? candidates : list)].sort((a, b) => {
    const left = videoCost(a, seconds) ?? Number.POSITIVE_INFINITY
    const right = videoCost(b, seconds) ?? Number.POSITIVE_INFINITY
    return left - right
  })
  return ranked[0]
}

export function pickDuration(model: StarVideoModel | undefined, requested: number | undefined): number {
  const listed = model?.durations ?? []
  const wanted = requested && Number.isFinite(requested) && requested > 0 ? Math.round(requested) : undefined
  if (!listed.length) return wanted ?? 5
  if (wanted === undefined) return listed.includes(5) ? 5 : listed[0]!
  return listed.reduce((best, item) => (Math.abs(item - wanted) < Math.abs(best - wanted) ? item : best), listed[0]!)
}

export function pickRatio(model: StarVideoModel | undefined, requested: string | undefined): string {
  const listed = model?.ratios ?? []
  const wanted = requested?.trim()
  if (wanted && (!listed.length || listed.includes(wanted))) return wanted
  return listed[0] ?? '16:9'
}

export function pickResolution(model: StarVideoModel | undefined, requested: string | undefined): string {
  const listed = model?.resolutions ?? []
  const wanted = requested?.trim()
  if (wanted) {
    const match = listed.find(item => item.toLowerCase() === wanted.toLowerCase())
    if (match) return match
    if (!listed.length) return wanted.toUpperCase()
  }
  return listed[0] ?? '720P'
}

export function clampImageCount(value: number | undefined): number {
  const count = Math.round(Number(value ?? 1))
  return Number.isFinite(count) ? Math.min(4, Math.max(1, count)) : 1
}
