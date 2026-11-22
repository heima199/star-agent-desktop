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

/** The catalog's base price: used to rank models for 自动, not to show what a job costs. */
export function videoCost(model: StarVideoModel | undefined, duration: number): number | undefined {
  if (!model) return undefined
  if (model.pricePerGeneration && model.pricePerGeneration > 0) return model.pricePerGeneration
  if (model.pricePerSecond && model.pricePerSecond > 0) return Math.round(model.pricePerSecond * duration * 100) / 100
  return undefined
}

/*
 * What the console charges, by its rule with its default settings (the same
 * rule as the server's starMediaModels). The catalog has one base price per
 * model, while the console charges an image by the tier of its size and a
 * video by resolution and seconds, so showing the base price read "1 积分" at
 * 4K and "10 积分" at 2K / 12 s (2026-11-05). The job's own estimate comes
 * from the console (starApi.estimateCredits); this prices the model list and
 * stands in until that answers.
 */
function imageTierMultiplier(model: StarImageModel, tier: '1k' | '2k' | '4k'): number {
  if (tier === '1k') return 1
  const match = new RegExp(`${tier.toUpperCase()}\\s*[×x*]\\s*(\\d+(?:\\.\\d+)?)`, 'i').exec(model.badge ?? '')
  const listed = match ? Number(match[1]) : Number.NaN
  return Number.isFinite(listed) && listed > 0 ? listed : tier === '4k' ? 4 : 2
}

/** Credits for one image at `tier`. */
export function imageTierCost(model: StarImageModel | undefined, tier: '1k' | '2k' | '4k'): number | undefined {
  if (!model?.pricePerImage || model.pricePerImage <= 0) return undefined
  return Math.max(1, Math.ceil(model.pricePerImage * imageTierMultiplier(model, tier)))
}

/** Credits for one video at `duration` seconds and `resolution`. */
export function videoCostAt(model: StarVideoModel | undefined, duration: number, resolution?: string): number | undefined {
  if (!model) return undefined
  const value = (resolution ?? '').toLowerCase()
  const resolutionFactor = /4k|2160/.test(value) ? 3 : /1080|2k|1440/.test(value) ? 1.5 : 1
  const seconds = Math.max(1, duration || 5)
  let credits: number | undefined
  if (model.pricePerGeneration && model.pricePerGeneration > 0) {
    credits = Math.max(1, Math.ceil(model.pricePerGeneration * resolutionFactor * (1 + Math.max(0, seconds - 5) * 0.2)))
  } else if (model.pricePerSecond && model.pricePerSecond > 0) {
    credits = Math.max(1, Math.ceil(model.pricePerSecond * resolutionFactor * seconds))
  }
  // MiniMax H3 runs to 30 s; the console bills 16-30 s at twice the price.
  if (credits !== undefined && H3_MODEL_RE.test(model.id) && seconds >= 16) credits = Math.ceil(credits * 2)
  return credits
}

const H3_MODEL_RE = /minimax-h3|hailuo-0?3/i

/** Note shown when the model draws no larger than `charged` though `asked` is picked. */
export function imageTierNote(asked: '1k' | '2k' | '4k', charged: '1k' | '2k' | '4k' | undefined, ratio: string | undefined): string | null {
  if (!charged || charged === asked) return null
  return !ratio || ratio === 'auto'
    ? `比例为「自动」时按 ${charged.toUpperCase()} 出图和计费；要 ${asked.toUpperCase()} 请选一个比例`
    : `这个模型最高出 ${charged.toUpperCase()}，按 ${charged.toUpperCase()} 计费`
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

/**
 * The console lists a model's values with the model's own default first
 * (6, 4, 5, 8 …; 768P, 1080P, 2K, 480P), which reads as a jumble in a row of
 * buttons. The rows show them rising; which value is picked when nothing was
 * chosen still follows the console's order.
 */
export function risingDurations(values: number[]): number[] {
  return [...values].sort((a, b) => a - b)
}

/** Lines of a resolution as it is spelled ("480P", "2K"); a spelling that says no size sorts last. */
function resolutionLines(value: string): number {
  const match = /^\s*(\d+(?:\.\d+)?)\s*([pk])\s*$/i.exec(value)
  if (!match) return Infinity
  return Number(match[1]) * (match[2]!.toLowerCase() === 'k' ? 720 : 1)
}

export function risingResolutions(values: string[]): string[] {
  return values
    .map((value, index) => ({ value, index, lines: resolutionLines(value) }))
    .sort((a, b) => (a.lines === b.lines ? a.index - b.index : a.lines - b.lines))
    .map(item => item.value)
}

/** Ratios are numbers; the words the console puts among them are shown in Chinese. */
export function videoRatioLabel(ratio: string): string {
  if (ratio === 'adaptive') return '自适应'
  if (ratio === 'auto') return '自动'
  return ratio
}

/**
 * The picked model while `offered` still lists it, otherwise '' (自动). Going
 * back to 自动 on every change of mode put a 3-credit pick on the 10-credit
 * default unnoticed (文生图 to 图生图, or 「用作参考」 on a result).
 */
export function keptModel(picked: string, offered: { id: string }[]): string {
  return picked && offered.some(item => item.id === picked) ? picked : ''
}

/**
 * The price beside a video model in the list. The picked model shows the
 * console's own price once it has answered, so the list and the line under
 * the button name one price for the job (4 s at 480P read "约 10 积分" in the
 * list and "约 7 积分" under the button); the others go by the offline rule.
 */
export function listedVideoCost(model: StarVideoModel, picked: string, exact: number | undefined, duration: number, resolution?: string): number | undefined {
  return (model.id === picked ? exact : undefined) ?? videoCostAt(model, duration, resolution)
}

/** The name the model list shows for `id`; the id itself while the catalog does not list it. */
export function mediaModelLabel(catalog: StarCatalog | null, id: string): string {
  const listed = (catalog?.image ?? []).find(model => model.id === id) ?? (catalog?.video ?? []).find(model => model.id === id)
  return listed?.label || id
}

/** How many items each reference row of a mode takes; 0 for a row the mode does not show. */
export type StudioRows = { refs: number; first: number; last: number; videos: number }

/**
 * The reference rows a mode shows. The form draws, checks and sends exactly
 * these: nothing it does not show goes along with a request or holds one back.
 */
export function shownRows(kind: 'image' | 'video', imageMode: ImageMode, videoMode: VideoMode): StudioRows {
  if (kind === 'image') return { refs: imageMode === 'text2image' ? 0 : imageMode === 'image2image' ? 1 : 16, first: 0, last: 0, videos: 0 }
  return {
    refs: videoMode === 'multi2video' || videoMode === 'video2video' ? 8 : 0,
    first: videoMode === 'image2video' || videoMode === 'frames2video' ? 1 : 0,
    last: videoMode === 'frames2video' ? 1 : 0,
    videos: videoMode === 'video2video' ? 3 : 0,
  }
}

/** The row 「用作参考」 puts an output in: the 参考图 row where the video mode shows one, 首帧 otherwise. */
export function referenceSlot(incoming: 'image' | 'video', kind: 'image' | 'video', videoMode: VideoMode): { slot: 'videos' | 'refs' | 'first'; max: number } {
  if (incoming === 'video') return { slot: 'videos', max: 3 }
  if (kind === 'image') return { slot: 'refs', max: 16 }
  const pictures = shownRows('video', 'text2image', videoMode).refs
  return pictures ? { slot: 'refs', max: pictures } : { slot: 'first', max: 1 }
}

/** Whether a row takes one more output. The same output is never attached twice. */
export function referenceRoom(attached: (string | undefined)[], url: string, max: number): 'room' | 'attached' | 'full' {
  if (attached.includes(url)) return 'attached'
  return attached.length >= max ? 'full' : 'room'
}

/** What 「用作参考」 says when it attaches nothing. */
export function referenceRefusal(kind: 'image' | 'video', why: 'attached' | 'full', max: number): string {
  if (why === 'attached') return kind === 'image' ? '这张图片已经在参考里了' : '这个视频已经在参考里了'
  return kind === 'image' ? `参考图最多 ${max} 张，先移除一张再添加` : `参考视频最多 ${max} 个，先移除一个再添加`
}

/** 图片 mode once 「用作参考」 has added a picture: one picture is 图生图, more are 多图参考. */
export function imageModeWith(mode: ImageMode, pictures: number): ImageMode {
  if (pictures > 1) return 'multi2image'
  return mode === 'text2image' ? 'image2image' : mode
}
