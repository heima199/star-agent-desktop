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

const MODE_ALIASES: Record<VideoMode, string[]> = {
  text2video: ['text', 'txt', 'text2video', 'txt2video'],
  image2video: ['first_frame', 'image', 'img', 'img2video', 'image2video', 'reference'],
  frames2video: ['first_last_frame', 'frames', 'frames2video', 'last_frame'],
  multi2video: ['reference', 'multi_image', 'image', 'img2video'],
  video2video: ['reference', 'video', 'reference_video', 'ref2video', 'video2video'],
}

const PREFERRED_IMAGE = ['gemini-2.5-flash-image', 'gemini-3.1-flash-image-preview', 'gpt-image-2', 'gpt-image-2.5']

export function videoSupports(model: StarVideoModel, mode: VideoMode): boolean {
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
export function autoImageModel(catalog: StarCatalog | null, mode: ImageMode): StarImageModel | undefined {
  const list = imageModelsFor(catalog, mode)
  return PREFERRED_IMAGE.map(id => list.find(model => model.id === id)).find(Boolean) ?? list[0]
}

export function autoVideoModel(catalog: StarCatalog | null, mode: VideoMode, duration: number): StarVideoModel | undefined {
  const list = videoModelsFor(catalog, mode)
  return [...list].sort((a, b) => (videoCost(a, duration) ?? Infinity) - (videoCost(b, duration) ?? Infinity))[0]
}

export function nearest(values: number[], wanted: number): number {
  return values.reduce((best, item) => (Math.abs(item - wanted) < Math.abs(best - wanted) ? item : best), values[0] ?? wanted)
}
