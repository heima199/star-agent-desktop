import type { StarCatalog, StarImageModel, StarVideoModel } from '../../api/star'

export type ImageMode = 'text2image' | 'image2image' | 'multi2image'
export type VideoMode = 'text2video' | 'image2video' | 'frames2video' | 'multi2video' | 'video2video'

export const IMAGE_MODES: { value: ImageMode; label: string; hint: string }[] = [
  { value: 'text2image', label: '文生图', hint: '用文字描述生成图片' },
  { value: 'image2image', label: '图生图', hint: '基于一张参考图修改、换风格' },
  { value: 'multi2image', label: '多图生图', hint: '融合多张参考图（最多 16 张）' },
]

export const VIDEO_MODES: { value: VideoMode; label: string; hint: string }[] = [
  { value: 'text2video', label: '文生视频', hint: '用文字描述生成视频' },
  { value: 'image2video', label: '图生视频', hint: '让一张图片动起来（首帧）' },
  { value: 'frames2video', label: '首尾帧', hint: '在首帧和尾帧之间生成过渡动画' },
  { value: 'multi2video', label: '多图生视频', hint: '用多张参考图生成一段视频（最多 8 张）' },
  { value: 'video2video', label: '视频参考', hint: '参考已有视频的动作、运镜或风格' },
]

export const IMAGE_RATIOS = ['auto', '1:1', '3:4', '4:3', '9:16', '16:9', '2:3', '3:2', '21:9']

const MODE_ALIASES: Record<Exclude<VideoMode, 'video2video'>, string[]> = {
  text2video: ['text', 'txt', 'text2video', 'txt2video'],
  image2video: ['first_frame', 'image', 'img', 'img2video', 'image2video', 'reference'],
  frames2video: ['first_last_frame', 'frames', 'frames2video', 'last_frame'],
  multi2video: ['reference', 'multi_image', 'image', 'img2video'],
}

/** Catalog modes that name a reference video outright. */
const REFERENCE_VIDEO_MODES = ['reference_video', 'video', 'video2video', 'ref2video', 'multimodal']

/**
 * Only a model whose catalog entry names reference videos outright takes
 * them. `reference` alone also means reference images, and no model is taken
 * on its name any more: in production (2026-11-01) Seedance 2 through the
 * router came back as plain text-to-video with the video dropped, and
 * MiniMax H3 refused reference videos. So 视频参考 stays off until the console
 * marks a model `reference_video`, and then comes back without a new build.
 */
export function acceptsReferenceVideo(model: StarVideoModel): boolean {
  return Boolean(model.modes?.some(item => REFERENCE_VIDEO_MODES.includes(item.toLowerCase())))
}

/** Whether any model of the catalog takes reference videos (视频参考 is offered only then). */
export function referenceVideoAvailable(catalog: StarCatalog | null): boolean {
  return (catalog?.video ?? []).some(acceptsReferenceVideo)
}

/** Shown where a reference video comes in while no model takes one. */
export const REFERENCE_VIDEO_PAUSED = '参考视频生成暂未开放，可以截取视频里的一帧用图生视频'

const PREFERRED_IMAGE = ['gemini-2.5-flash-image', 'gemini-3.1-flash-image-preview', 'gpt-image-2', 'gpt-image-2.5']

/**
 * Models whose output ignores the requested size. In production (2026-11-03)
 * every non-square gemini-2.5-flash-image job came back 1024x1024 (3:2, 4:3,
 * 3:4 alike), while gpt-image-2.5 and gpt-image-2 kept the size they were
 * asked for. With a ratio picked, 自动 takes one of those instead.
 */
const RATIO_IGNORED_IMAGE = ['gemini-2.5-flash-image']
const PREFERRED_IMAGE_WITH_RATIO = ['gpt-image-2.5', 'gpt-image-2']

/** Whether `ratio` asks for a shape other than the model's default square. */
function wantsShape(ratio: string | undefined): boolean {
  const value = ratio?.trim()
  return Boolean(value && value !== 'auto' && value !== '1:1')
}

/** Whether the model's output keeps a picked ratio (false: it comes back square). */
export function imageKeepsRatio(model: StarImageModel | undefined): boolean {
  return !model || !RATIO_IGNORED_IMAGE.includes(model.id)
}

export function videoSupports(model: StarVideoModel, mode: VideoMode): boolean {
  if (mode === 'video2video') return acceptsReferenceVideo(model)
  if (!model.modes?.length) return true
  return model.modes.some(item => MODE_ALIASES[mode].includes(item.toLowerCase()))
}

export function videoCost(model: StarVideoModel | undefined, duration: number): number | undefined {
  if (!model) return undefined
  if (model.pricePerGeneration && model.pricePerGeneration > 0) return model.pricePerGeneration
  if (model.pricePerSecond && model.pricePerSecond > 0) return Math.round(model.pricePerSecond * duration * 100) / 100
  return undefined
}

export function imageModelsFor(catalog: StarCatalog | null, mode: ImageMode): StarImageModel[] {
  const list = catalog?.image ?? []
  return mode === 'text2image' ? list : list.filter(model => model.supportsEdit !== false)
}

export function videoModelsFor(catalog: StarCatalog | null, mode: VideoMode): StarVideoModel[] {
  return (catalog?.video ?? []).filter(model => videoSupports(model, mode))
}

/** The model the server picks when the user leaves the model on 自动. */
export function autoImageModel(catalog: StarCatalog | null, mode: ImageMode, ratio?: string): StarImageModel | undefined {
  const list = imageModelsFor(catalog, mode)
  if (wantsShape(ratio)) {
    const keeping = list.filter(imageKeepsRatio)
    const picked = PREFERRED_IMAGE_WITH_RATIO.map(id => keeping.find(model => model.id === id)).find(Boolean)
      ?? PREFERRED_IMAGE.map(id => keeping.find(model => model.id === id)).find(Boolean)
      ?? keeping[0]
    if (picked) return picked
  }
  return PREFERRED_IMAGE.map(id => list.find(model => model.id === id)).find(Boolean) ?? list[0]
}

/** Shown when the picked image model would return a square image for a picked ratio. */
export const IMAGE_RATIO_IGNORED = '这个模型不支持指定比例，会生成方图；要指定比例请选「自动」或 GPT Image 模型'

/** Whether to warn that `model` will not keep `ratio`. */
export function imageRatioIgnored(model: StarImageModel | undefined, ratio: string | undefined): boolean {
  return wantsShape(ratio) && !imageKeepsRatio(model)
}

export function autoVideoModel(catalog: StarCatalog | null, mode: VideoMode, duration: number): StarVideoModel | undefined {
  const list = videoModelsFor(catalog, mode)
  return [...list].sort((a, b) => (videoCost(a, duration) ?? Infinity) - (videoCost(b, duration) ?? Infinity))[0]
}

export function nearest(values: number[], wanted: number): number {
  return values.reduce((best, item) => (Math.abs(item - wanted) < Math.abs(best - wanted) ? item : best), values[0] ?? wanted)
}
