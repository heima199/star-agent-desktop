/**
 * Tool definitions of the STAR plugins (one MCP server per plugin group).
 * JSON Schemas are written out so the tool list stays stable for the model.
 */

import { IMAGE_RATIOS } from './starMediaModels.js'

export type StarToolGroup = 'image' | 'video' | 'research' | 'docs' | 'lab'

export const STAR_TOOL_GROUPS: readonly StarToolGroup[] = ['image', 'video', 'research', 'docs', 'lab']

export type StarToolDefinition = {
  name: string
  title: string
  description: string
  inputSchema: Record<string, unknown>
}

const string = (description: string, extra: Record<string, unknown> = {}) => ({ type: 'string', description, ...extra })
const stringList = (description: string, maxItems: number, minItems = 0) => ({
  type: 'array',
  description,
  items: { type: 'string' },
  maxItems,
  ...(minItems ? { minItems } : {}),
})

const SAVE_DIR = string('结果保存目录（可选）。默认保存到当前工作目录下的 star-outputs 文件夹。')
const IMAGE_MODEL = string('绘图模型 ID（可选）。不填时自动选择；可先调用 star_image_models 查看。')
const VIDEO_MODEL = string('视频模型 ID（可选）。不填时按所需模式选择价格最低的模型；可先调用 star_video_models 查看。')
const RATIO = string('画面比例，例如 1:1、3:4、16:9、9:16（可选）。', { enum: [...IMAGE_RATIOS, 'auto'] })
const RESOLUTION = string('清晰度档位：1k、2k、4k（可选，默认 1k）。', { enum: ['1k', '2k', '4k'] })
const COUNT = { type: 'integer', minimum: 1, maximum: 4, description: '生成张数 1–4（可选，默认 1）。每张单独计费。' }
const VIDEO_DURATION = { type: 'integer', minimum: 1, maximum: 30, description: '视频时长（秒），自动取模型支持的最接近值。' }
const VIDEO_RATIO = string('视频比例，例如 16:9、9:16、1:1（可选）。')
const VIDEO_RESOLUTION = string('视频分辨率，例如 720P、1080P（可选）。')
const PROMPT = string('画面描述（中文或英文均可，越具体越好：主体、风格、构图、光线、色调）。')

const TASK_TOOL: StarToolDefinition = {
  name: 'star_media_task',
  title: '查询 STAR 生成任务',
  description: '查询一个 STAR 绘图/视频任务的进度和结果（用于等待超时后继续查看）。',
  inputSchema: {
    type: 'object',
    properties: { task_id: string('生成工具返回的任务 ID。') },
    required: ['task_id'],
  },
}

export const STAR_TOOLS: Record<StarToolGroup, StarToolDefinition[]> = {
  image: [
    {
      name: 'star_text_to_image',
      title: 'STAR 文生图',
      description: '用 STAR 账号的绘图模型根据文字描述生成图片（文字生图）。会消耗 STAR 积分，完成后返回本地文件路径和图片链接。',
      inputSchema: {
        type: 'object',
        properties: { prompt: PROMPT, model: IMAGE_MODEL, ratio: RATIO, resolution: RESOLUTION, count: COUNT, save_dir: SAVE_DIR },
        required: ['prompt'],
      },
    },
    {
      name: 'star_image_to_image',
      title: 'STAR 图生图 / 多图生图',
      description: '以一张或多张参考图为基础生成新图片：改风格、换背景、局部修改，或把多张图融合成一张（多图生图，最多 16 张）。参考图可以是本地路径或 http(s) 链接。',
      inputSchema: {
        type: 'object',
        properties: {
          prompt: string('要怎样修改或融合参考图。多图时说明每张图的作用，例如「图1的人物穿上图2的衣服」。'),
          images: stringList('参考图：本地文件路径（相对路径基于当前工作目录）或 http(s) 链接。', 16, 1),
          model: IMAGE_MODEL,
          ratio: RATIO,
          resolution: RESOLUTION,
          count: COUNT,
          save_dir: SAVE_DIR,
        },
        required: ['prompt', 'images'],
      },
    },
    {
      name: 'star_image_models',
      title: 'STAR 绘图模型列表',
      description: '列出 STAR 账号可用的绘图模型、支持的尺寸和每张价格（积分）。',
      inputSchema: { type: 'object', properties: {} },
    },
    TASK_TOOL,
  ],
  video: [
    {
      name: 'star_text_to_video',
      title: 'STAR 文生视频',
      description: '根据文字描述生成视频。视频生成通常需要数分钟并消耗较多积分；等待期间会持续报告进度。',
      inputSchema: {
        type: 'object',
        properties: {
          prompt: string('视频内容：主体、动作、镜头运动、风格、氛围。'),
          model: VIDEO_MODEL,
          duration: VIDEO_DURATION,
          ratio: VIDEO_RATIO,
          resolution: VIDEO_RESOLUTION,
          save_dir: SAVE_DIR,
        },
        required: ['prompt'],
      },
    },
    {
      name: 'star_image_to_video',
      title: 'STAR 图生视频 / 多图生视频',
      description: '用图片生成视频：只给首帧（图生视频）、首帧+尾帧（首尾帧动画），或给多张参考图（多图生视频，最多 8 张）。',
      inputSchema: {
        type: 'object',
        properties: {
          prompt: string('画面如何运动、镜头怎么走、风格氛围。'),
          first_frame: string('首帧图片：本地路径或链接（可选）。'),
          last_frame: string('尾帧图片：本地路径或链接（可选，需同时提供首帧）。'),
          images: stringList('多张参考图（多图生视频）：本地路径或链接。', 8),
          model: VIDEO_MODEL,
          duration: VIDEO_DURATION,
          ratio: VIDEO_RATIO,
          resolution: VIDEO_RESOLUTION,
          save_dir: SAVE_DIR,
        },
        required: ['prompt'],
      },
    },
    {
      name: 'star_video_to_video',
      title: 'STAR 视频参考生成视频',
      description: '以参考视频（动作、运镜或风格）为依据生成新视频，可同时给参考图。需要支持参考视频的模型（如 sd-2 系列）。',
      inputSchema: {
        type: 'object',
        properties: {
          prompt: string('新视频的内容，以及要参考原视频的哪些方面（动作、镜头、节奏、风格）。'),
          videos: stringList('参考视频：本地 mp4/mov/webm 路径或链接（最多 3 个）。', 3, 1),
          images: stringList('参考图（可选）：本地路径或链接。', 8),
          model: VIDEO_MODEL,
          duration: VIDEO_DURATION,
          ratio: VIDEO_RATIO,
          resolution: VIDEO_RESOLUTION,
          save_dir: SAVE_DIR,
        },
        required: ['prompt', 'videos'],
      },
    },
    {
      name: 'star_video_models',
      title: 'STAR 视频模型列表',
      description: '列出 STAR 账号可用的视频模型：支持的模式（文生/首帧/首尾帧/参考）、时长、比例和价格。',
      inputSchema: { type: 'object', properties: {} },
    },
    TASK_TOOL,
  ],
  research: [
    {
      name: 'star_web_search',
      title: 'STAR 联网搜索',
      description: '联网搜索最新信息，返回标题、链接和摘要。回答时请注明来源链接。',
      inputSchema: {
        type: 'object',
        properties: {
          query: string('搜索内容。'),
          max_results: { type: 'integer', minimum: 1, maximum: 20, description: '结果数量（默认 8）。' },
        },
        required: ['query'],
      },
    },
    {
      name: 'star_academic_search',
      title: 'STAR 学术论文搜索',
      description: '检索学术论文、预印本（OpenAlex / arXiv 等），返回标题、作者与来源、年份、链接（DOI）和摘要。',
      inputSchema: {
        type: 'object',
        properties: {
          query: string('检索关键词，英文关键词通常结果更全。'),
          count: { type: 'integer', minimum: 1, maximum: 20, description: '论文数量（默认 8）。' },
        },
        required: ['query'],
      },
    },
    {
      name: 'star_read_url',
      title: 'STAR 网页阅读',
      description: '抓取一个网页链接的正文，并按要求总结、提炼或回答问题。',
      inputSchema: {
        type: 'object',
        properties: {
          url: string('网页链接（http/https）。'),
          question: string('要从网页里得到什么（可选，默认总结要点）。'),
        },
        required: ['url'],
      },
    },
  ],
  docs: [
    {
      name: 'star_extract_file',
      title: 'STAR 文件识别（PDF / Office）',
      description: '把上传或本地的文档（PDF、Word、Excel、PPT、TXT、Markdown 等）识别成文本，便于总结、问答和提取表格。云端解析需要 STAR 会员；纯文本格式本地直接读取。',
      inputSchema: {
        type: 'object',
        properties: {
          path: string('文件路径（相对路径基于当前工作目录）或 http(s) 链接。'),
        },
        required: ['path'],
      },
    },
    {
      name: 'star_vision',
      title: 'STAR 多模态理解',
      description: '让多模态模型看图回答：识别图片内容、截图里的文字和界面、图表数据、多图对比。',
      inputSchema: {
        type: 'object',
        properties: {
          question: string('要问的问题。'),
          images: stringList('图片：本地路径或 http(s) 链接（最多 8 张）。', 8, 1),
          model: string('多模态模型 ID（可选，默认 gemini-2.5-flash 等支持识图的模型）。'),
        },
        required: ['question', 'images'],
      },
    },
  ],
  lab: [
    {
      name: 'star_capability_check',
      title: 'STAR 能力测试',
      description: '逐项测试 STAR 能力：服务连接、账号、模型目录、对话中转、联网搜索、学术检索、网页阅读、多模态识图、文件识别，可选实际生成一张图片。返回每项的结果和耗时。',
      inputSchema: {
        type: 'object',
        properties: {
          include_generation: { type: 'boolean', description: '是否实际生成一张测试图片（会消耗少量积分，默认否）。' },
        },
      },
    },
    {
      name: 'star_account',
      title: 'STAR 账号与额度',
      description: '查看当前登录的 STAR 账号、套餐、积分余额和今日对话额度。',
      inputSchema: { type: 'object', properties: {} },
    },
  ],
}
