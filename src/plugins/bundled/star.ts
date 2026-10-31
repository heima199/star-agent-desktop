/**
 * STAR built-in plugins (首推插件). Each plugin is one MCP server served by the
 * desktop server at `/api/star/mcp/<group>` plus the skills that drive it.
 *
 * The MCP endpoint lives in the desktop server, which holds the STAR sign-in,
 * runs long media jobs and shows their progress in the task center. A CLI
 * started outside the desktop has no such server, so the plugins hide there;
 * they also hide until the user signs in to STAR.
 */

import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'

import type { McpServerConfig } from '../../services/mcp/types.js'
import type { BundledSkillDefinition } from '../../skills/bundledSkills.js'
import { registerBuiltinPlugin } from '../builtinPlugins.js'

type SkillSpec = {
  name: string
  description: string
  whenToUse: string
  argumentHint: string
  body: string
  extraTools?: string[]
}

type StarPluginSpec = {
  name: string
  group: 'image' | 'video' | 'research' | 'docs' | 'lab'
  description: string
  skills: SkillSpec[]
}

/** Tool name prefix of a plugin's MCP server: `plugin:<name>:star` normalized. */
export function starToolPrefix(pluginName: string): string {
  return `mcp__plugin_${pluginName}_star__`
}

const RESULT_RULES = [
  '- 工具会一直等到任务完成，并持续报告进度；不要另外轮询，除非工具明确说「任务仍在进行」。',
  '- 完成后：桌面端会把图片/视频以卡片形式显示在对话里，不要再用 Markdown 插入；用一两句话说明结果，并告诉用户本地文件路径。',
  '- 如果提示未登录、积分不足或额度已用完，原样转告用户，并提示在左下角头像菜单登录、签到或购买积分。不要换别的方式偷偷重试。',
  '- 参考图/参考视频可以是本地路径或 http(s) 链接。对话里的图片附件带有源文件路径（例如 `[Image source: …]` 或 uploads 目录），直接使用这个路径。',
].join('\n')

const STAR_PLUGINS: StarPluginSpec[] = [
  {
    name: 'star-image',
    group: 'image',
    description: 'STAR 绘图：文生图、图生图、多图融合生图（按 STAR 账号积分计费）',
    skills: [
      {
        name: 'star-text-to-image',
        description: 'STAR 文生图：根据文字描述生成图片（海报、插画、头像、产品图）',
        whenToUse: '用户想用文字生成图片、海报、插画、头像、产品图、配图时',
        argumentHint: '<画面描述>',
        body: [
          '# STAR 文生图',
          `调用 \`${starToolPrefix('star-image')}star_text_to_image\`。`,
          '1. 把需求整理成具体的画面描述：主体、场景、风格、构图、光线、色调。',
          '2. 用户提到比例时传 `ratio`（如 16:9、3:4、9:16）；要高清传 `resolution`（2k/4k）；要多张传 `count`（1–4，每张单独计费）。',
          '3. 用户指定模型时传 `model`；不确定有哪些模型时先调用 `star_image_models`。',
          RESULT_RULES,
        ].join('\n'),
      },
      {
        name: 'star-image-to-image',
        description: 'STAR 图生图 / 多图生图：基于一张或多张参考图改图、换风格、融合成新图',
        whenToUse: '用户给了图片并要求修改、换背景、换风格、扩展，或把多张图融合成一张时',
        argumentHint: '<修改要求>',
        body: [
          '# STAR 图生图 / 多图生图',
          `调用 \`${starToolPrefix('star-image')}star_image_to_image\`，把参考图放进 \`images\`（最多 16 张）。`,
          '1. 单张参考图：在 prompt 里写清楚要保留什么、改什么。',
          '2. 多张参考图（多图生图）：按顺序说明每张图的作用，例如「图1的人物、图2的服装、图3的背景」。',
          '3. 其余参数同文生图：`ratio`、`resolution`、`count`、`model`。',
          RESULT_RULES,
        ].join('\n'),
      },
    ],
  },
  {
    name: 'star-video',
    group: 'video',
    description: 'STAR 视频：文生视频、图生视频、多图生视频、视频参考生成视频',
    skills: [
      {
        name: 'star-text-to-video',
        description: 'STAR 文生视频：根据文字描述生成短视频',
        whenToUse: '用户想用文字描述生成视频、短片、动态海报时',
        argumentHint: '<视频内容>',
        body: [
          '# STAR 文生视频',
          `调用 \`${starToolPrefix('star-video')}star_text_to_video\`。`,
          '1. prompt 写清主体、动作、镜头运动、风格、氛围。',
          '2. 视频较贵且需要数分钟：开始前用一句话告诉用户预计耗时；用户没说时长时用默认值。',
          '3. 需要比较模型或价格时先调用 `star_video_models`。',
          RESULT_RULES,
        ].join('\n'),
      },
      {
        name: 'star-image-to-video',
        description: 'STAR 图生视频 / 多图生视频：用首帧、首尾帧或多张参考图生成视频',
        whenToUse: '用户给了图片并希望让它动起来，或用多张图片生成一段视频时',
        argumentHint: '<画面如何运动>',
        body: [
          '# STAR 图生视频 / 多图生视频',
          `调用 \`${starToolPrefix('star-video')}star_image_to_video\`。`,
          '- 一张图作为开场画面：传 `first_frame`。',
          '- 首尾两张图做过渡动画：传 `first_frame` 和 `last_frame`。',
          '- 多张参考图（多图生视频，最多 8 张）：传 `images`，并在 prompt 里说明各图在视频中的作用。',
          RESULT_RULES,
        ].join('\n'),
      },
      {
        name: 'star-video-to-video',
        description: 'STAR 视频参考生成视频：参考已有视频的动作、运镜或风格生成新视频',
        whenToUse: '用户给了参考视频，希望模仿其动作、镜头、节奏或风格生成新视频时',
        argumentHint: '<新视频内容>',
        body: [
          '# STAR 视频参考生成视频',
          `调用 \`${starToolPrefix('star-video')}star_video_to_video\`，把参考视频放进 \`videos\`（最多 3 个），参考图放进 \`images\`。`,
          '- prompt 说明新视频的内容，以及要参考原视频的哪些方面（动作、运镜、节奏、风格）。',
          '- 只有支持参考视频的模型可用；不确定时先调用 `star_video_models`，选择模式里含 reference 的模型。',
          RESULT_RULES,
        ].join('\n'),
      },
    ],
  },
  {
    name: 'star-research',
    group: 'research',
    description: 'STAR 联网研究：联网搜索、学术论文搜索、网页阅读',
    skills: [
      {
        name: 'star-web-search',
        description: 'STAR 联网搜索：搜索最新资讯并整理成带来源的回答',
        whenToUse: '问题需要最新信息、新闻、价格、版本、事实核查时',
        argumentHint: '<要搜索的问题>',
        body: [
          '# STAR 联网搜索',
          `1. 调用 \`${starToolPrefix('star-research')}star_web_search\`，把问题改写成 1–3 个简洁的搜索词，分别搜索。`,
          `2. 需要细节时，用 \`${starToolPrefix('star-research')}star_read_url\` 打开最相关的 1–3 个链接。`,
          '3. 回答时综合多个来源，每个关键结论后用 [标题](链接) 标注来源；来源互相矛盾时说明分歧。',
          '4. 搜不到可靠信息就直说，不要编造。',
        ].join('\n'),
      },
      {
        name: 'star-paper-search',
        description: 'STAR 学术论文搜索：检索论文、预印本并整理文献综述',
        whenToUse: '用户要找论文、做文献综述、查研究进展、引用学术来源时',
        argumentHint: '<研究主题>',
        body: [
          '# STAR 学术论文搜索',
          `1. 调用 \`${starToolPrefix('star-research')}star_academic_search\`。英文关键词结果更全：中文主题先翻译成英文术语，必要时中英各检索一次。`,
          '2. 按主题或时间整理论文：标题、年份、作者与来源、一句话贡献、链接（DOI）。',
          '3. 需要更多内容时，用 `star_read_url` 打开论文页面。',
          '4. 只引用工具返回的论文，不要虚构标题、作者或 DOI。',
        ].join('\n'),
      },
    ],
  },
  {
    name: 'star-docs',
    group: 'docs',
    description: 'STAR 文档与多模态：PDF / Office 文件上传识别、图片理解',
    skills: [
      {
        name: 'star-pdf',
        description: 'STAR PDF 识别：读取 PDF，提炼要点、表格和关键数据',
        whenToUse: '用户上传或指定 PDF，要求总结、问答、提取表格或核对信息时',
        argumentHint: '<PDF 路径或要求>',
        extraTools: ['Read'],
        body: [
          '# STAR PDF 识别',
          `1. 找到 PDF 路径（对话里的附件以 @"路径" 形式给出）。调用 \`${starToolPrefix('star-docs')}star_extract_file\` 获取全文。`,
          '2. 如果提示需要会员，改用 Read 工具直接读取 PDF（长文档用 pages 参数分段读取）。',
          '3. 按用户要求输出：要点摘要、结构化表格（Markdown）、关键数字，必要时注明页码或章节。',
        ].join('\n'),
      },
      {
        name: 'star-file-recognize',
        description: 'STAR 文件识别：Word、Excel、PPT、文本等上传文件转成文字后分析',
        whenToUse: '用户上传 Word/Excel/PPT/文本文件，要求识别内容、汇总、提取信息时',
        argumentHint: '<文件路径或要求>',
        extraTools: ['Read'],
        body: [
          '# STAR 文件识别',
          `1. 对每个文件调用 \`${starToolPrefix('star-docs')}star_extract_file\`（路径来自 @"路径" 附件或用户给出的位置）。`,
          '2. 多个文件时分别识别，再按用户要求合并分析。',
          '3. 云端解析需要会员；失败时文本类文件改用 Read 工具读取，并告诉用户 Office 文件需要会员才能云端解析。',
        ].join('\n'),
      },
      {
        name: 'star-vision',
        description: 'STAR 多模态理解：看图识别内容、截图文字、图表数据和多图对比',
        whenToUse: '需要识别图片内容、读截图里的文字或界面、分析图表、对比多张图片时',
        argumentHint: '<关于图片的问题>',
        body: [
          '# STAR 多模态理解',
          `调用 \`${starToolPrefix('star-docs')}star_vision\`，\`images\` 传图片路径或链接（最多 8 张），\`question\` 写清楚要识别什么。`,
          '- 对话中的图片附件使用其源文件路径（`[Image source: …]`）。',
          '- 需要精确文字时让模型逐字转写；需要数据时让它输出表格。',
        ].join('\n'),
      },
    ],
  },
  {
    name: 'star-lab',
    group: 'lab',
    description: 'STAR 能力测试：一键检测联网搜索、多模态、文件识别、绘图等能力，查看账号额度',
    skills: [
      {
        name: 'star-capability-test',
        description: 'STAR 能力测试：逐项测试联网搜索、学术检索、多模态、文件识别、对话与绘图',
        whenToUse: '用户想检查 STAR 各项能力是否可用、排查为什么某个能力失败时',
        argumentHint: '[实际生成]',
        body: [
          '# STAR 能力测试',
          `调用 \`${starToolPrefix('star-lab')}star_capability_check\`。用户明确要求「实际生成」或「测试绘图」时传 \`include_generation: true\`（会消耗少量积分）。`,
          '把结果整理成表格：能力、结果、耗时、说明；对失败或警告的项目给出处理建议（登录、开通会员、购买积分、联系管理员配置模型）。',
          `需要查看账号与额度时调用 \`${starToolPrefix('star-lab')}star_account\`。`,
        ].join('\n'),
      },
    ],
  },
]

function toSkill(plugin: StarPluginSpec, spec: SkillSpec): BundledSkillDefinition {
  return {
    name: spec.name,
    description: spec.description,
    whenToUse: spec.whenToUse,
    argumentHint: spec.argumentHint,
    // Server-level rule: every tool of this plugin's STAR server.
    allowedTools: [`mcp__plugin_${plugin.name}_star`, ...(spec.extraTools ?? [])],
    userInvocable: true,
    async getPromptForCommand(args) {
      const parts = [spec.body]
      if (args.trim()) parts.push(`## 用户请求\n\n${args.trim()}`)
      return [{ type: 'text', text: parts.join('\n\n') }]
    },
  }
}

function desktopServerUrl(): string | null {
  const raw = process.env.CC_HAHA_DESKTOP_SERVER_URL?.trim()
  if (raw) {
    try {
      const url = new URL(raw)
      if (url.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)) return url.origin
    } catch {
      return null
    }
  }
  // The desktop server registers the plugins for its own listings.
  const own = process.env.CC_HAHA_STAR_LOCAL_SERVER_URL?.trim()
  return own || null
}

function mcpServer(base: string, group: StarPluginSpec['group']): Record<string, McpServerConfig> {
  const headers: Record<string, string> = {}
  try {
    headers['x-star-cwd'] = encodeURIComponent(process.cwd())
  } catch {
    // No working directory: outputs go to the desktop's own folder.
  }
  const session = process.env.CC_HAHA_SESSION_ID?.trim()
  if (session) headers['x-star-session'] = session
  return { star: { type: 'http', url: `${base}/api/star/mcp/${group}`, headers } }
}

/**
 * Signed in to STAR on this machine (the desktop writes the session file).
 * Without a sign-in the plugins stay hidden, so sessions of people who do not
 * use STAR keep exactly the tool list they had before.
 */
function starSignedIn(): boolean {
  try {
    const configDir = process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude')
    const raw = JSON.parse(fs.readFileSync(path.join(configDir, 'cc-haha', 'star', 'session.json'), 'utf-8')) as { token?: unknown }
    return typeof raw.token === 'string' && raw.token.length > 0
  } catch {
    return false
  }
}

let registered = false

export function registerStarPlugins(): void {
  if (registered) return
  const base = desktopServerUrl()
  if (!base) return
  registered = true
  for (const plugin of STAR_PLUGINS) {
    registerBuiltinPlugin({
      name: plugin.name,
      description: plugin.description,
      version: '1.0.0',
      defaultEnabled: true,
      isAvailable: starSignedIn,
      mcpServers: mcpServer(base, plugin.group),
      skills: plugin.skills.map(skill => toSkill(plugin, skill)),
    })
  }
}

/** Plugin metadata for the desktop's STAR pages (no MCP config). */
export function listStarPluginSpecs(): { name: string; group: string; description: string; skills: { name: string; description: string }[] }[] {
  return STAR_PLUGINS.map(plugin => ({
    name: plugin.name,
    group: plugin.group,
    description: plugin.description,
    skills: plugin.skills.map(skill => ({ name: skill.name, description: skill.description })),
  }))
}
