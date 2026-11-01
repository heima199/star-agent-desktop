/**
 * MCP servers for the STAR plugins, served by the desktop server at
 * `POST /api/star/mcp/:group` (Streamable HTTP, stateless: one server and
 * transport per request). Long jobs stream `notifications/progress` while the
 * call waits, so the agent and the user both see how far a job has got.
 */

import * as fs from 'node:fs'
import * as path from 'node:path'

import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js'
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js'

import { getStarQuota, getStarStatus } from './starAccountService.js'
import { readStarCatalog, refreshStarCatalog, type StarCatalog } from './starCatalog.js'
import { getStarMediaTask, startStarImageTask, startStarVideoTask, waitForStarTask } from './starMediaService.js'
import { acceptsReferenceVideo, REFERENCE_VIDEO_UNAVAILABLE } from './starMediaModels.js'
import type { StarMediaTask } from './starMediaStore.js'
import { STAR_TOOLS, STAR_TOOL_GROUPS, type StarToolGroup } from './starMcpTools.js'
import { formatStarCheckRun, runStarChecks } from './starSelfTest.js'
import { starAcademicSearch, starExtractFile, starReadUrl, starVision, starWebSearch } from './starToolsService.js'

export type StarMcpContext = { cwd?: string; sessionId?: string }

type Args = Record<string, unknown>
type Progress = (percent: number, message: string) => void

export function isStarToolGroup(value: string | undefined): value is StarToolGroup {
  return !!value && (STAR_TOOL_GROUPS as readonly string[]).includes(value)
}

function text(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function list(value: unknown): string[] {
  return Array.isArray(value) ? value.map(item => (typeof item === 'string' ? item.trim() : '')).filter(Boolean) : []
}

function int(value: unknown): number | undefined {
  const parsed = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN
  return Number.isFinite(parsed) ? Math.round(parsed) : undefined
}

function required(args: Args, key: string, label: string): string {
  const value = text(args[key])
  if (!value) throw new Error(`缺少参数 ${key}（${label}）`)
  return value
}

export function describeStarMediaTask(task: StarMediaTask): string {
  const kind = task.kind === 'image' ? '图片' : '视频'
  if (task.status === 'failed') return `${kind}生成失败：${task.error ?? task.message}\n任务 ID：${task.id}`
  if (task.status !== 'succeeded') {
    return `${kind}任务仍在进行：${task.progress}% · ${task.message}\n任务 ID：${task.id}。稍后调用 star_media_task 查询结果，或在桌面「STAR 创作」页查看进度。`
  }
  const credit = task.estimatedCredits !== undefined ? `，预计消耗 ${task.estimatedCredits} 积分` : ''
  const lines = [`${kind}已生成（模型 ${task.model}${credit}）：`]
  task.outputs.forEach((output, index) => {
    lines.push(`${index + 1}. 本地文件：${output.file ?? '（下载失败，仅有链接）'}`)
    lines.push(`   链接：${output.url}`)
  })
  // The desktop renders the result as a card under this tool call (it reads the
  // task ID below), so the reply should not embed the media a second time.
  lines.push(`${kind}已经以卡片形式显示在对话里，回复时不要再用 Markdown 插入${kind}或链接；用一两句话说明结果，并给出本地文件路径。`)
  lines.push(`任务 ID：${task.id}`)
  return lines.join('\n')
}

async function catalog(): Promise<StarCatalog | null> {
  return readStarCatalog() ?? await refreshStarCatalog().catch(() => null)
}

async function waitMedia(task: StarMediaTask, progress: Progress, signal: AbortSignal): Promise<string> {
  progress(task.progress, task.message)
  const done = await waitForStarTask(task.id, { signal, onUpdate: update => progress(update.progress, update.message) })
  return describeStarMediaTask(done)
}

async function callTool(name: string, args: Args, context: StarMcpContext, progress: Progress, signal: AbortSignal): Promise<string> {
  const origin = { source: 'agent' as const, sessionId: context.sessionId, cwd: context.cwd, saveDir: text(args.save_dir) }
  switch (name) {
    case 'star_text_to_image':
      return waitMedia(await startStarImageTask({
        prompt: required(args, 'prompt', '画面描述'),
        model: text(args.model),
        ratio: text(args.ratio),
        resolution: text(args.resolution),
        count: int(args.count),
      }, origin), progress, signal)
    case 'star_image_to_image': {
      const images = list(args.images)
      if (!images.length) throw new Error('缺少参数 images（至少一张参考图）')
      return waitMedia(await startStarImageTask({
        prompt: required(args, 'prompt', '修改要求'),
        references: images,
        model: text(args.model),
        ratio: text(args.ratio),
        resolution: text(args.resolution),
        count: int(args.count),
      }, origin), progress, signal)
    }
    case 'star_text_to_video':
      return waitMedia(await startStarVideoTask({
        prompt: required(args, 'prompt', '视频内容'),
        model: text(args.model),
        duration: int(args.duration),
        ratio: text(args.ratio),
        resolution: text(args.resolution),
      }, origin), progress, signal)
    case 'star_image_to_video': {
      const firstFrame = text(args.first_frame)
      const images = list(args.images)
      if (!firstFrame && !images.length) throw new Error('请提供 first_frame（首帧）或 images（参考图）')
      return waitMedia(await startStarVideoTask({
        prompt: required(args, 'prompt', '视频内容'),
        firstFrame,
        lastFrame: text(args.last_frame),
        references: images,
        model: text(args.model),
        duration: int(args.duration),
        ratio: text(args.ratio),
        resolution: text(args.resolution),
      }, origin), progress, signal)
    }
    case 'star_video_to_video': {
      const videos = list(args.videos)
      if (!videos.length) throw new Error('缺少参数 videos（至少一个参考视频）')
      return waitMedia(await startStarVideoTask({
        prompt: required(args, 'prompt', '视频内容'),
        videos,
        references: list(args.images),
        model: text(args.model),
        duration: int(args.duration),
        ratio: text(args.ratio),
        resolution: text(args.resolution),
      }, origin), progress, signal)
    }
    case 'star_media_task': {
      const task = getStarMediaTask(required(args, 'task_id', '任务 ID'))
      if (!task) throw new Error('任务不存在')
      return describeStarMediaTask(task)
    }
    case 'star_image_models': {
      const models = (await catalog())?.image ?? []
      if (!models.length) return '当前没有可用的绘图模型。'
      return ['可用绘图模型：', ...models.map(model => `- ${model.id}（${model.label}）${model.badge ? ` [${model.badge}]` : ''}：${model.supportsEdit === false ? '仅文生图' : '支持参考图'}${model.pricePerImage !== undefined ? `，每张 ${model.pricePerImage} 积分` : ''}${model.sizes?.length ? `，尺寸 ${model.sizes.slice(0, 6).join('/')}` : ''}`)].join('\n')
    }
    case 'star_video_models': {
      const models = (await catalog())?.video ?? []
      if (!models.length) return '当前没有可用的视频模型。'
      const lines = ['可用视频模型：', ...models.map(model => {
        const price = model.pricePerGeneration ? `每次 ${model.pricePerGeneration} 积分` : model.pricePerSecond ? `每秒 ${model.pricePerSecond} 积分` : '价格未标注'
        return `- ${model.id}（${model.label}）：模式 ${model.modes?.join('/') ?? '全部'}；${acceptsReferenceVideo(model) ? '可用参考视频（star_video_to_video）' : '不接受参考视频'}；时长 ${model.durations?.join('/') ?? '默认'} 秒；比例 ${model.ratios?.join('/') ?? '默认'}；${price}`
      })]
      if (!models.some(acceptsReferenceVideo)) lines.push('', REFERENCE_VIDEO_UNAVAILABLE)
      return lines.join('\n')
    }
    case 'star_web_search': {
      const result = await starWebSearch(required(args, 'query', '搜索内容'), int(args.max_results) ?? 8)
      if (!result.results.length) return `没有搜索到「${result.query}」的结果。`
      return [`「${result.query}」的搜索结果（${result.results.length} 条，${result.latencyMs} ms）：`,
        ...result.results.map((hit, index) => `${index + 1}. ${hit.title}\n   ${hit.url}\n   ${hit.snippet}`)].join('\n')
    }
    case 'star_academic_search': {
      const result = await starAcademicSearch(required(args, 'query', '检索关键词'), int(args.count) ?? 8)
      if (!result.papers.length) return `没有检索到「${result.query}」相关论文。`
      return [`「${result.query}」相关论文（显示 ${result.papers.length} 篇，约 ${result.total} 篇匹配）：`,
        ...result.papers.map((paper, index) => `${index + 1}. ${paper.title}${paper.year ? `（${paper.year}）` : ''}\n   来源：${paper.source || '—'}\n   链接：${paper.url || '—'}\n   摘要：${paper.summary.slice(0, 400)}`)].join('\n')
    }
    case 'star_read_url': {
      const result = await starReadUrl(required(args, 'url', '网页链接'), text(args.question))
      return `标题：${result.title || '—'}\n链接：${result.url}\n\n${result.answer}`
    }
    case 'star_extract_file': {
      progress(10, '上传并识别文件…')
      const result = await starExtractFile(required(args, 'path', '文件路径'), { cwd: context.cwd })
      const via = result.via === 'star' ? 'STAR 云端解析' : '本地读取'
      return `文件：${result.filename}（${result.type}，${via}，${result.text.length} 字）${result.truncated ? '\n注意：内容较长，只返回了前 60000 字。' : ''}\n\n${result.text}`
    }
    case 'star_vision': {
      const images = list(args.images)
      if (!images.length) throw new Error('缺少参数 images（至少一张图片）')
      progress(20, '上传图片并识别…')
      const result = await starVision({ question: required(args, 'question', '问题'), images, model: text(args.model), cwd: context.cwd })
      return `${result.answer}\n\n（模型 ${result.model}，${result.latencyMs} ms）`
    }
    case 'star_capability_check': {
      const run = await runStarChecks({
        includeGeneration: args.include_generation === true,
        onStep: (step) => {
          const done = step.items.filter(item => !['pending', 'running'].includes(item.status)).length
          const active = step.items.find(item => item.status === 'running')
          progress(Math.round((done / step.items.length) * 100), active ? `测试${active.label}…` : `已完成 ${done}/${step.items.length}`)
        },
      })
      return formatStarCheckRun(run)
    }
    case 'star_account': {
      const status = await getStarStatus()
      if (!status.signedIn) return '尚未登录 STAR 账号。请在桌面左下角点击头像登录。'
      const quota = await getStarQuota()
      const lines = [
        `账号：${status.user?.nickname || status.user?.phone || status.user?.email || status.user?.id}`,
        `套餐：${quota.planName}`,
        `积分余额：${quota.credits ?? '--'}`,
      ]
      if (quota.normal) lines.push(`今日普通模型对话：${quota.normal.used}/${quota.normal.quota}`)
      if (quota.premium) lines.push(`今日高级模型对话：${quota.premium.used}/${quota.premium.quota}`)
      lines.push(`对话模型：${status.provider.mainModel ?? '未设置'}（${status.provider.active ? '当前使用中' : '未启用'}）`)
      return lines.join('\n')
    }
    default:
      throw new Error(`未知工具：${name}`)
  }
}

function createServer(group: StarToolGroup, context: StarMcpContext): Server {
  const server = new Server(
    { name: `star-${group}`, version: '1.0.0' },
    { capabilities: { tools: {} } },
  )
  const tools = STAR_TOOLS[group]
  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: tools.map(tool => ({ name: tool.name, title: tool.title, description: tool.description, inputSchema: tool.inputSchema as { type: 'object' } })),
  }))
  server.setRequestHandler(CallToolRequestSchema, async (request, extra) => {
    const name = request.params.name
    if (!tools.some(tool => tool.name === name)) {
      return { content: [{ type: 'text', text: `这个插件没有工具 ${name}` }], isError: true }
    }
    const token = request.params._meta?.progressToken
    let last = ''
    const progress: Progress = (percent, message) => {
      if (token === undefined) return
      const key = `${percent}|${message}`
      if (key === last) return
      last = key
      void extra.sendNotification({
        method: 'notifications/progress',
        params: { progressToken: token, progress: Math.max(0, Math.min(100, percent)), total: 100, message },
      }).catch(() => undefined)
    }
    try {
      const output = await callTool(name, (request.params.arguments ?? {}) as Args, context, progress, extra.signal)
      return { content: [{ type: 'text', text: output }] }
    } catch (error) {
      return { content: [{ type: 'text', text: error instanceof Error ? error.message : String(error) }], isError: true }
    }
  })
  return server
}

function contextFrom(req: Request): StarMcpContext {
  let cwd: string | undefined
  const rawCwd = req.headers.get('x-star-cwd')
  if (rawCwd) {
    try {
      const decoded = decodeURIComponent(rawCwd)
      if (path.isAbsolute(decoded) && fs.statSync(decoded).isDirectory()) cwd = decoded
    } catch {
      cwd = undefined
    }
  }
  const sessionId = req.headers.get('x-star-session')?.trim()
  return { ...(cwd ? { cwd } : {}), ...(sessionId ? { sessionId: sessionId.slice(0, 200) } : {}) }
}

export async function handleStarMcpRequest(req: Request, group: StarToolGroup): Promise<Response> {
  if (req.method !== 'POST') {
    return Response.json(
      { jsonrpc: '2.0', error: { code: -32000, message: 'Method not allowed' }, id: null },
      { status: 405, headers: { Allow: 'POST' } },
    )
  }
  const server = createServer(group, contextFrom(req))
  const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined })
  await server.connect(transport)
  const close = () => {
    void transport.close().catch(() => undefined)
    void server.close().catch(() => undefined)
  }
  let response: Response
  try {
    response = await transport.handleRequest(req)
  } catch (error) {
    close()
    throw error
  }
  if (!response.body) {
    close()
    return response
  }
  const relay = new TransformStream<Uint8Array, Uint8Array>()
  void response.body.pipeTo(relay.writable).catch(() => undefined).finally(close)
  return new Response(relay.readable, { status: response.status, statusText: response.statusText, headers: response.headers })
}
