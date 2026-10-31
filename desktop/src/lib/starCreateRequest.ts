/**
 * STAR 创作 in the main chat: the composer's creation modes (文生图 … 多模态).
 *
 * Armed, the next message goes to the model with an instruction block in
 * front of it that names the STAR tool to call and its parameters, while the
 * bubble shows only what the user typed — the same pattern as the Agent Team
 * switch (agentTeamRequest.ts). The block carries its mode, so a reloaded
 * transcript can drop it again and show the mode chip instead.
 */

export type StarCreateMode =
  | 'text2image'
  | 'image2image'
  | 'multi2image'
  | 'text2video'
  | 'image2video'
  | 'frames2video'
  | 'multi2video'
  | 'video2video'
  | 'vision'

export type StarCreateKind = 'image' | 'video' | 'vision'

export type StarCreateParams = {
  model?: string
  ratio?: string
  resolution?: string
  count?: number
  duration?: number
}

type ModeSpec = {
  mode: StarCreateMode
  label: string
  kind: StarCreateKind
  /** What the user has to attach, shown in the menu and in errors. */
  hint: string
  placeholder: string
  tool: string
}

const IMAGE_TOOL = 'mcp__plugin_star-image_star__'
const VIDEO_TOOL = 'mcp__plugin_star-video_star__'
const DOCS_TOOL = 'mcp__plugin_star-docs_star__'

export const STAR_CREATE_MODES: readonly ModeSpec[] = [
  { mode: 'text2image', label: '文生图', kind: 'image', hint: '用文字描述生成图片', placeholder: '描述想要的画面：主体、风格、构图、光线…', tool: `${IMAGE_TOOL}star_text_to_image` },
  { mode: 'image2image', label: '图生图', kind: 'image', hint: '上传 1 张参考图，改风格或局部修改', placeholder: '上传参考图，说说要怎么改…', tool: `${IMAGE_TOOL}star_image_to_image` },
  { mode: 'multi2image', label: '多图生图', kind: 'image', hint: '上传 2–16 张图融合成一张', placeholder: '上传多张图，说明每张图的作用，例如「图1的人物穿上图2的衣服」…', tool: `${IMAGE_TOOL}star_image_to_image` },
  { mode: 'text2video', label: '文生视频', kind: 'video', hint: '用文字描述生成视频', placeholder: '描述视频：主体、动作、镜头运动、风格…', tool: `${VIDEO_TOOL}star_text_to_video` },
  { mode: 'image2video', label: '图生视频', kind: 'video', hint: '上传 1 张首帧图片让它动起来', placeholder: '上传首帧图片，描述画面如何运动…', tool: `${VIDEO_TOOL}star_image_to_video` },
  { mode: 'frames2video', label: '首尾帧', kind: 'video', hint: '上传 2 张图：第 1 张首帧，第 2 张尾帧', placeholder: '上传首帧和尾帧，描述两帧之间如何过渡…', tool: `${VIDEO_TOOL}star_image_to_video` },
  { mode: 'multi2video', label: '多图生视频', kind: 'video', hint: '上传 2–8 张参考图生成一段视频', placeholder: '上传多张参考图，说明它们在视频里的作用…', tool: `${VIDEO_TOOL}star_image_to_video` },
  { mode: 'video2video', label: '视频参考', kind: 'video', hint: '上传参考视频，模仿动作、运镜或风格', placeholder: '上传参考视频，说明新视频的内容和要参考的方面…', tool: `${VIDEO_TOOL}star_video_to_video` },
  { mode: 'vision', label: '多模态', kind: 'vision', hint: '上传图片，让多模态模型识别和回答', placeholder: '上传图片，问问它：识别文字、分析图表、对比差异…', tool: `${DOCS_TOOL}star_vision` },
]

const SPEC = new Map(STAR_CREATE_MODES.map(spec => [spec.mode, spec]))

export function starCreateSpec(mode: StarCreateMode): ModeSpec {
  return SPEC.get(mode)!
}

export function isStarCreateMode(value: unknown): value is StarCreateMode {
  return typeof value === 'string' && SPEC.has(value as StarCreateMode)
}

/** The parts of an outgoing attachment this module reads. */
export type StarCreateAttachment = { type?: string; name?: string; path?: string; mimeType?: string; isDirectory?: boolean }

const IMAGE_RE = /\.(png|jpe?g|gif|webp|bmp)$/i
const VIDEO_RE = /\.(mp4|mov|webm|m4v|mkv|avi)$/i

export type StarCreateRefs = {
  /** Local paths of the attached images, in order. */
  images: string[]
  /** Images that travel without a local path (pasted in the web UI). */
  pathlessImages: number
  videos: string[]
}

export function collectStarCreateRefs(attachments: readonly StarCreateAttachment[]): StarCreateRefs {
  const refs: StarCreateRefs = { images: [], pathlessImages: 0, videos: [] }
  for (const attachment of attachments) {
    if (attachment.isDirectory) continue
    const name = attachment.path ?? attachment.name ?? ''
    const isVideo = attachment.mimeType?.startsWith('video/') || VIDEO_RE.test(name)
    const isImage = !isVideo && (attachment.type === 'image' || attachment.mimeType?.startsWith('image/') || IMAGE_RE.test(name))
    if (isVideo) {
      if (attachment.path) refs.videos.push(attachment.path)
    } else if (isImage) {
      if (attachment.path) refs.images.push(attachment.path)
      else refs.pathlessImages += 1
    }
  }
  return refs
}

export type StarCreateResolution =
  | { ok: true; mode: StarCreateMode; notice?: string }
  | { ok: false; message: string }

/**
 * Settle the mode against what is attached. A text mode with references
 * becomes the matching reference mode (what the user evidently meant); a
 * reference mode without its references is an error the composer shows.
 */
export function resolveStarCreateMode(mode: StarCreateMode, refs: StarCreateRefs): StarCreateResolution {
  const images = refs.images.length + refs.pathlessImages
  const videos = refs.videos.length
  switch (mode) {
    case 'text2image':
      if (videos) return { ok: false, message: '图片模式不支持参考视频，请移除视频或改用「视频参考」' }
      return images === 0 ? { ok: true, mode } : { ok: true, mode: images === 1 ? 'image2image' : 'multi2image', notice: '已按参考图生成' }
    case 'image2image':
    case 'multi2image':
      if (videos) return { ok: false, message: '图片模式不支持参考视频，请移除视频或改用「视频参考」' }
      if (images === 0) return { ok: false, message: mode === 'image2image' ? '图生图需要先上传 1 张参考图' : '多图生图需要先上传至少 2 张参考图' }
      if (images > 16) return { ok: false, message: '参考图最多 16 张' }
      return { ok: true, mode: images === 1 ? 'image2image' : 'multi2image' }
    case 'text2video':
      if (videos) return { ok: true, mode: 'video2video', notice: '已按参考视频生成' }
      if (images === 1) return { ok: true, mode: 'image2video', notice: '已把图片作为首帧' }
      if (images > 1) return images > 8 ? { ok: false, message: '视频参考图最多 8 张' } : { ok: true, mode: 'multi2video', notice: '已按多张参考图生成' }
      return { ok: true, mode }
    case 'image2video':
      if (videos) return { ok: false, message: '图生视频不需要参考视频；参考视频请改用「视频参考」' }
      if (images === 0) return { ok: false, message: '图生视频需要先上传 1 张首帧图片' }
      if (images > 1) return images > 8 ? { ok: false, message: '视频参考图最多 8 张' } : { ok: true, mode: 'multi2video', notice: '多张图片按多图生视频处理' }
      return { ok: true, mode }
    case 'frames2video':
      if (videos) return { ok: false, message: '首尾帧不需要参考视频' }
      if (images < 2) return { ok: false, message: '首尾帧需要 2 张图片：第 1 张首帧，第 2 张尾帧' }
      return images > 2 ? { ok: true, mode, notice: '只使用前 2 张图片作为首帧和尾帧' } : { ok: true, mode }
    case 'multi2video':
      if (videos) return { ok: false, message: '多图生视频不需要参考视频；参考视频请改用「视频参考」' }
      if (images === 0) return { ok: false, message: '多图生视频需要先上传至少 2 张参考图' }
      if (images > 8) return { ok: false, message: '视频参考图最多 8 张' }
      return images === 1 ? { ok: true, mode: 'image2video', notice: '只有 1 张图，按图生视频处理' } : { ok: true, mode }
    case 'video2video':
      if (videos === 0) return { ok: false, message: '视频参考需要先上传 1 段参考视频（mp4 / mov / webm）' }
      if (videos > 3) return { ok: false, message: '参考视频最多 3 个' }
      if (images > 8) return { ok: false, message: '视频参考图最多 8 张' }
      return { ok: true, mode }
    case 'vision':
      if (images === 0) return { ok: false, message: '多模态识图需要先上传图片' }
      if (images > 8) return { ok: false, message: '一次最多识别 8 张图片' }
      return { ok: true, mode }
  }
}

const OPEN_RE = /<star-create-request mode="([a-z0-9]+)">/
const BLOCK_RE = /<star-create-request mode="[a-z0-9]+">[\s\S]*?<\/star-create-request>\n*/

function list(paths: string[]): string {
  return JSON.stringify(paths)
}

function argumentLines(mode: StarCreateMode, params: StarCreateParams, refs: StarCreateRefs): string[] {
  const lines: string[] = []
  const pathless = refs.pathlessImages
    ? `另有 ${refs.pathlessImages} 张图片没有本地路径，请改用本条消息附带图片的源文件路径（[Image source: …]）。`
    : ''
  switch (mode) {
    case 'text2image':
      lines.push('- prompt：用户在下面写的画面描述')
      break
    case 'image2image':
    case 'multi2image':
      lines.push(mode === 'multi2image'
        ? '- prompt：用户在下面写的融合要求（按顺序把参考图称为图1、图2…）'
        : '- prompt：用户在下面写的修改要求')
      lines.push(`- images：${list(refs.images)}${pathless}`)
      break
    case 'text2video':
      lines.push('- prompt：用户在下面写的视频内容（主体、动作、镜头、风格）')
      break
    case 'image2video':
      lines.push('- prompt：用户在下面写的画面运动方式')
      lines.push(refs.images[0] ? `- first_frame：${JSON.stringify(refs.images[0])}` : `- first_frame：本条消息附带的图片。${pathless}`)
      break
    case 'frames2video':
      lines.push('- prompt：用户在下面写的过渡方式')
      if (refs.images.length >= 2) {
        lines.push(`- first_frame：${JSON.stringify(refs.images[0])}`)
        lines.push(`- last_frame：${JSON.stringify(refs.images[1])}`)
      } else {
        lines.push(`- first_frame / last_frame：本条消息附带的第 1、2 张图片。${pathless}`)
      }
      break
    case 'multi2video':
      lines.push('- prompt：用户在下面写的视频内容，以及各参考图的作用')
      lines.push(`- images：${list(refs.images)}${pathless}`)
      break
    case 'video2video':
      lines.push('- prompt：用户在下面写的新视频内容，以及要参考原视频的哪些方面')
      lines.push(`- videos：${list(refs.videos)}`)
      if (refs.images.length || refs.pathlessImages) lines.push(`- images：${list(refs.images)}${pathless}`)
      break
    case 'vision':
      lines.push('- question：用户在下面提的问题')
      lines.push(`- images：${list(refs.images)}${pathless}`)
      break
  }
  if (params.model) lines.push(`- model：${params.model}`)
  if (mode === 'vision') return lines
  if (params.ratio && params.ratio !== 'auto') lines.push(`- ratio：${params.ratio}`)
  if (params.resolution) lines.push(`- resolution：${params.resolution}`)
  if (starCreateSpec(mode).kind === 'image' && params.count && params.count > 1) lines.push(`- count：${params.count}`)
  if (starCreateSpec(mode).kind === 'video' && params.duration) lines.push(`- duration：${params.duration}`)
  return lines
}

/** The instruction block for one creation request. Chinese, like the STAR tools it talks about. */
export function buildStarCreateBlock(mode: StarCreateMode, params: StarCreateParams, refs: StarCreateRefs): string {
  const spec = starCreateSpec(mode)
  const vision = spec.kind === 'vision'
  return [
    `<star-create-request mode="${mode}">`,
    `【STAR 创作 · ${spec.label}】这条消息是一次 STAR ${vision ? '多模态识图' : '生成'}请求：请直接调用工具 \`${spec.tool}\`，不要先追问，也不要改用其他工具或写代码。`,
    '参数：',
    ...argumentLines(mode, params, refs),
    vision
      ? '拿到识别结果后，按用户的要求整理回答。'
      : 'prompt 保持用户原意；描述过于简短时可补充风格、构图、光线等细节。生成完成后结果会以卡片形式显示在对话里：不要再用 Markdown 插入图片或视频，用一两句话说明结果并给出本地文件路径。失败时把原因原样告诉用户（例如需要登录、积分不足）。',
    '</star-create-request>',
  ].join('\n')
}

export function withStarCreateRequest(content: string, block: string): string {
  return content ? `${block}\n\n${content}` : block
}

/** The user-facing text of a message, with the creation block removed. */
export function stripStarCreateRequest(text: string): { content: string; mode: StarCreateMode | null } {
  if (!text.includes('<star-create-request')) return { content: text, mode: null }
  const match = OPEN_RE.exec(text)
  const mode = match && isStarCreateMode(match[1]) ? match[1] : null
  if (!mode) return { content: text, mode: null }
  const content = text.replace(BLOCK_RE, '')
  return content === text ? { content: text, mode: null } : { content, mode }
}

/** The block itself, so an edited message can be sent again with the same request. */
export function extractStarCreateBlock(text: string): string | null {
  const match = BLOCK_RE.exec(text)
  return match ? match[0].trimEnd() : null
}
