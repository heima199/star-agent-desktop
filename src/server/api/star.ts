/**
 * STAR SaaS API for the desktop:
 *
 *   GET    /api/star/status                  configuration, sign-in, provider, catalog counts
 *   POST   /api/star/login/code              { account }                send an SMS / email code
 *   POST   /api/star/login                   { account, code? | password?, inviteCode? }
 *   POST   /api/star/login/starwork          reuse the STAR Work sign-in on this computer
 *   POST   /api/star/logout
 *   GET    /api/star/profile | /quota | /catalog | /plans
 *   POST   /api/star/catalog/refresh         re-sync models (and the STAR provider mapping)
 *   POST   /api/star/activate                make STAR the active model provider
 *   POST   /api/star/order                   { kind, id, billingCycle?, payType? } → payUrl
 *   POST   /api/star/checkin | /redeem | /feedback
 *   GET    /api/star/media/tasks             task center
 *   POST   /api/star/media/image | /video    start a job
 *   GET    /api/star/media/tasks/:id         one job
 *   DELETE /api/star/media/tasks/:id         ?files=1 also deletes downloaded files
 *   GET    /api/star/media/tasks/:id/file/:n downloaded output bytes
 *   POST   /api/star/upload?kind=image|video raw bytes → public URL for references
 *   POST   /api/star/tools/search | academic | read | vision | extract
 *   GET    /api/star/check, POST /api/star/check   capability check (能力测试)
 *   GET    /api/star/prompts/strip?mode=     站点提示词 strip (code | design | all)
 *   GET    /api/star/prompts/facets | /list?group=&sub=&q=&page=&pageSize=
 *   GET    /api/star/prompts/item/:id        full prompt; POST …/:id/use counts a use
 *   POST   /api/star/mcp/:group              MCP endpoint of the STAR plugins
 *   GET    /api/star/desktop-config          operator config (关于 / support / legal / 推荐), ?force=1
 *   GET    /api/star/update?platform=        latest desktop release published in the STAR console
 *   GET    /api/star/legal                   published 用户协议 / 隐私政策 (public, no sign-in)
 *   GET    /api/star/plaza?category=&subcategory=&page=&pageSize=   灵感社区
 *   GET    /api/star/distribution            分销中心 (invite + agent panel); POST …/apply | …/withdraw
 *   GET    /api/star/api-keys                API 接入 keys; POST { name }; DELETE …/:id; POST …/:id/toggle
 *   *      /api/star/design/…                Design workspace (open-design resources, artboards)
 *   *      /api/star/kb/…                    local knowledge bases
 *   *      /api/star/skills/…                market skills installed into <config>/skills
 */

import * as fs from 'node:fs'
import * as path from 'node:path'

import { ApiError, errorResponse } from '../middleware/errorHandler.js'
import {
  activateStarProvider,
  connectStarAccount,
  createStarOrder,
  getStarPlans,
  getStarProfile,
  getStarQuota,
  getStarStatus,
  loginStar,
  loginStarWithStarWork,
  logoutStar,
  sendStarLoginCode,
  starCheckin,
  starFeedback,
  starRedeem,
} from '../services/star/starAccountService.js'
import { readStarCatalog, refreshStarCatalog } from '../services/star/starCatalog.js'
import { StarApiError, starUploadForUrl } from '../services/star/starClient.js'
import { handleStarMcpRequest, isStarToolGroup } from '../services/star/starMcp.js'
import {
  getStarMediaTask,
  listStarMediaTasks,
  removeStarMediaTask,
  runningStarTaskCount,
  startStarImageTask,
  startStarVideoTask,
} from '../services/star/starMediaService.js'
import {
  markStarPromptUsed,
  StarPromptError,
  starPromptDetail,
  starPromptFacets,
  starPromptList,
  starPromptStrip,
} from '../services/star/starPromptLibrary.js'
import {
  createStarApiKey,
  deleteStarApiKey,
  getStarDesktopConfig,
  getStarDistribution,
  getStarLegalDocs,
  getStar3dTemplates,
  recordStar3dTemplateUse,
  getStarPlaza,
  getStarUpdateInfo,
  listStarApiKeys,
  starApplyAgent,
  starRequestWithdrawal,
  toggleStarApiKey,
} from '../services/star/starPortalService.js'
import { createLocalProject, handleStarDesignApi } from '../services/star/starDesignApi.js'
import { handleStarKnowledgeApi } from '../services/star/starKnowledgeApi.js'
import { handleStarSkillsApi } from '../services/star/starSkillsApi.js'
import { getStarRuntimeSnapshot } from '../services/star/starRuntime.js'
import { readStarSession } from '../services/star/starSession.js'
import { getStarCheckRun, runStarChecks } from '../services/star/starSelfTest.js'
import {
  starAcademicSearch,
  starExtractBytes,
  starReadUrl,
  starVision,
  starWebSearch,
} from '../services/star/starToolsService.js'

type Body = Record<string, unknown>

function toError(error: unknown): Response {
  if (error instanceof StarPromptError) {
    return Response.json({ error: 'STAR_PROMPTS', message: error.message }, { status: error.status })
  }
  if (error instanceof StarApiError) {
    const status = error.status >= 400 && error.status <= 599 ? error.status : 502
    return Response.json({ error: error.code, message: error.message }, { status })
  }
  return errorResponse(error)
}

async function readBody(req: Request): Promise<Body> {
  let body: unknown
  try {
    body = await req.json()
  } catch {
    throw ApiError.badRequest('Expected a JSON object')
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw ApiError.badRequest('Expected a JSON object')
  return body as Body
}

function str(value: unknown, max = 20_000): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim().slice(0, max) : undefined
}

function strings(value: unknown, max: number): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0).slice(0, max) : []
}

function int(value: unknown): number | undefined {
  const parsed = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN
  return Number.isFinite(parsed) ? Math.round(parsed) : undefined
}

const MIME_BY_EXT: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.mp4': 'video/mp4',
  '.mov': 'video/quicktime',
  '.webm': 'video/webm',
}

async function handleMedia(req: Request, url: URL, segments: string[]): Promise<Response> {
  const sub = segments[3]
  if (sub === 'tasks' && !segments[4] && req.method === 'GET') {
    const limit = Math.min(300, Math.max(1, int(url.searchParams.get('limit')) ?? 100))
    return Response.json({ tasks: listStarMediaTasks(limit), running: runningStarTaskCount() })
  }
  if ((sub === 'image' || sub === 'video') && req.method === 'POST') {
    const body = await readBody(req)
    const prompt = str(body.prompt) ?? ''
    const task = sub === 'image'
      ? await startStarImageTask({
          prompt,
          model: str(body.model, 200),
          references: strings(body.references, 16),
          ratio: str(body.ratio, 20),
          resolution: str(body.resolution, 10),
          quality: str(body.quality, 20),
          count: int(body.count),
        }, { source: 'desktop', saveDir: str(body.saveDir, 1000) })
      : await startStarVideoTask({
          prompt,
          model: str(body.model, 200),
          firstFrame: str(body.firstFrame, 30_000_000),
          lastFrame: str(body.lastFrame, 30_000_000),
          references: strings(body.references, 8),
          videos: strings(body.videos, 3),
          duration: int(body.duration),
          ratio: str(body.ratio, 20),
          resolution: str(body.resolution, 20),
        }, { source: 'desktop', saveDir: str(body.saveDir, 1000) })
    return Response.json({ task }, { status: 202 })
  }
  if (sub === 'tasks' && segments[4]) {
    const id = segments[4]
    if (segments[5] === 'file' && segments[6] !== undefined && req.method === 'GET') {
      const task = getStarMediaTask(id)
      const output = task?.outputs[Number(segments[6])]
      if (!output?.file || !fs.existsSync(output.file)) throw ApiError.notFound('File not found')
      const type = MIME_BY_EXT[path.extname(output.file).toLowerCase()] ?? 'application/octet-stream'
      return new Response(Bun.file(output.file), { headers: { 'Content-Type': type, 'Cache-Control': 'private, max-age=3600' } })
    }
    if (!segments[5] && req.method === 'GET') {
      const task = getStarMediaTask(id)
      if (!task) throw ApiError.notFound('Task not found')
      return Response.json({ task })
    }
    if (!segments[5] && req.method === 'DELETE') {
      const removed = removeStarMediaTask(id, url.searchParams.get('files') === '1')
      if (!removed) throw ApiError.notFound('Task not found')
      return Response.json({ ok: true })
    }
  }
  throw ApiError.notFound('Unknown STAR media endpoint')
}

async function handleTools(req: Request, segments: string[]): Promise<Response> {
  if (req.method !== 'POST') throw new ApiError(405, 'Method not allowed', 'METHOD_NOT_ALLOWED')
  const body = await readBody(req)
  switch (segments[3]) {
    case 'search':
      return Response.json(await starWebSearch(str(body.query, 300) ?? '', int(body.maxResults) ?? 8))
    case 'academic':
      return Response.json(await starAcademicSearch(str(body.query, 300) ?? '', int(body.count) ?? 8))
    case 'read':
      return Response.json(await starReadUrl(str(body.url, 2000) ?? '', str(body.question, 2000)))
    case 'vision':
      return Response.json(await starVision({
        question: str(body.question, 4000) ?? '',
        images: strings(body.images, 8),
        model: str(body.model, 200),
      }))
    case 'extract': {
      const filename = str(body.filename, 300) ?? 'document'
      const data = str(body.data, 120_000_000)
      if (!data) throw ApiError.badRequest('Missing file data')
      const base64 = data.includes(',') && data.startsWith('data:') ? data.slice(data.indexOf(',') + 1) : data
      return Response.json(await starExtractBytes(Uint8Array.from(Buffer.from(base64, 'base64')), path.basename(filename)))
    }
    default:
      throw ApiError.notFound('Unknown STAR tool')
  }
}

async function handlePrompts(req: Request, url: URL, segments: string[]): Promise<Response> {
  const sub = segments[3]
  if (sub === 'item' && segments[4]) {
    if (segments[5] === 'use' && req.method === 'POST') {
      markStarPromptUsed(segments[4])
      return Response.json({ ok: true })
    }
    if (!segments[5] && req.method === 'GET') return Response.json(await starPromptDetail(segments[4]))
  }
  if (req.method !== 'GET') throw new ApiError(405, 'Method not allowed', 'METHOD_NOT_ALLOWED')
  switch (sub) {
    case 'strip': {
      const mode = url.searchParams.get('mode')
      return Response.json({ items: await starPromptStrip(mode === 'code' || mode === 'design' ? mode : 'all') })
    }
    case 'facets':
      return Response.json(await starPromptFacets())
    case 'list':
      return Response.json(await starPromptList({
        group: url.searchParams.get('group') ?? undefined,
        sub: url.searchParams.get('sub') ?? undefined,
        q: url.searchParams.get('q') ?? undefined,
        page: int(url.searchParams.get('page')),
        pageSize: int(url.searchParams.get('pageSize')),
      }))
    default:
      throw ApiError.notFound('Unknown STAR prompts endpoint')
  }
}

async function handleUpload(req: Request, url: URL): Promise<Response> {
  if (req.method !== 'POST') throw new ApiError(405, 'Method not allowed', 'METHOD_NOT_ALLOWED')
  const session = readStarSession()
  if (!session) throw new StarApiError('请先登录 STAR 账号', 401, 'STAR_SIGNED_OUT')
  const kind = url.searchParams.get('kind') === 'video' ? 'video' : 'image'
  const filename = path.basename(url.searchParams.get('name') || (kind === 'video' ? 'reference.mp4' : 'reference.png'))
  const mime = (req.headers.get('content-type') ?? '').split(';')[0]!.trim() || (kind === 'video' ? 'video/mp4' : 'image/png')
  const bytes = new Uint8Array(await req.arrayBuffer())
  const publicUrl = await starUploadForUrl(kind, session.token, bytes, filename, mime)
  return Response.json({ url: publicUrl })
}

async function route(req: Request, url: URL, segments: string[]): Promise<Response> {
  const resource = segments[2]
  const method = req.method
  switch (resource) {
    case 'status':
      return Response.json(await getStarStatus())
    case 'login': {
      if (method !== 'POST') break
      if (segments[3] === 'code') {
        const body = await readBody(req)
        await sendStarLoginCode(str(body.account, 200) ?? '')
        return Response.json({ ok: true })
      }
      const body = await readBody(req).catch(() => ({} as Body))
      if (segments[3] === 'starwork') return Response.json(await loginStarWithStarWork({ activate: body.activate === true }))
      return Response.json(await loginStar({
        account: str(body.account, 200) ?? '',
        code: str(body.code, 20),
        password: typeof body.password === 'string' ? body.password.slice(0, 200) : undefined,
        inviteCode: str(body.inviteCode, 40),
        activate: body.activate === true,
      }))
    }
    case 'logout':
      if (method === 'POST') return Response.json(await logoutStar())
      break
    case 'profile':
      return Response.json({ user: await getStarProfile() })
    case 'quota':
      return Response.json(await getStarQuota())
    case 'catalog': {
      if (segments[3] === 'refresh' && method === 'POST') {
        const catalog = await refreshStarCatalog({ force: true })
        if (readStarSession()) await connectStarAccount({ activate: 'never' }).catch(() => undefined)
        return Response.json({ catalog })
      }
      return Response.json({ catalog: readStarCatalog() ?? await refreshStarCatalog().catch(() => null) })
    }
    case 'activate':
      if (method === 'POST') return Response.json(await activateStarProvider())
      break
    case 'plans':
      return Response.json(await getStarPlans())
    case 'order': {
      if (method !== 'POST') break
      const body = await readBody(req)
      const kind = body.kind === 'credits' ? 'credits' : 'plan'
      const id = str(body.id, 200)
      if (!id) throw ApiError.badRequest('Missing id')
      return Response.json(await createStarOrder({
        kind,
        id,
        billingCycle: str(body.billingCycle, 40),
        payType: str(body.payType, 20),
        quantity: int(body.quantity),
      }))
    }
    case 'checkin':
      if (method === 'POST') return Response.json(await starCheckin() ?? { ok: true })
      break
    case 'redeem':
      if (method === 'POST') return Response.json(await starRedeem(str((await readBody(req)).code, 200) ?? '') ?? { ok: true })
      break
    case 'feedback': {
      if (method !== 'POST') break
      const body = await readBody(req)
      return Response.json(await starFeedback({
        category: str(body.category, 20),
        message: str(body.message, 5000) ?? '',
        contact: str(body.contact, 200),
        appVersion: str(body.appVersion, 40),
      }) ?? { ok: true })
    }
    case 'media':
      return handleMedia(req, url, segments)
    case 'upload':
      return handleUpload(req, url)
    case 'tools':
      return handleTools(req, segments)
    case 'prompts':
      return handlePrompts(req, url, segments)
    case 'check': {
      if (method === 'POST') {
        const body = await readBody(req).catch(() => ({} as Body))
        void runStarChecks({ includeGeneration: body.includeGeneration === true })
        await new Promise(resolve => setTimeout(resolve, 50))
      }
      return Response.json({ run: getStarCheckRun() })
    }
    case 'desktop-config':
      return Response.json(await getStarDesktopConfig({ force: url.searchParams.get('force') === '1' }))
    case 'update':
      return Response.json(await getStarUpdateInfo(url.searchParams.get('platform') || process.platform))
    case 'legal':
      if (method === 'GET') return Response.json(await getStarLegalDocs())
      break
    case 'plaza':
      return Response.json(await getStarPlaza({
        category: url.searchParams.get('category') ?? undefined,
        subcategory: url.searchParams.get('subcategory') ?? undefined,
        page: int(url.searchParams.get('page')),
        pageSize: int(url.searchParams.get('pageSize')),
      }))
    case 'distribution': {
      if (segments[3] === 'apply' && method === 'POST') return Response.json(await starApplyAgent() ?? { ok: true })
      if (segments[3] === 'withdraw' && method === 'POST') {
        const body = await readBody(req)
        return Response.json(await starRequestWithdrawal({
          amount: typeof body.amount === 'number' ? body.amount : Number(body.amount),
          accountType: str(body.accountType, 20) ?? 'alipay',
          accountInfo: str(body.accountInfo, 200) ?? '',
        }) ?? { ok: true })
      }
      if (!segments[3] && method === 'GET') return Response.json(await getStarDistribution())
      break
    }
    case 'api-keys': {
      const id = segments[3]
      if (!id && method === 'GET') return Response.json(await listStarApiKeys())
      if (!id && method === 'POST') return Response.json(await createStarApiKey(str((await readBody(req)).name, 60) ?? ''))
      if (id && !segments[4] && method === 'DELETE') {
        await deleteStarApiKey(id)
        return Response.json({ ok: true })
      }
      if (id && segments[4] === 'toggle' && method === 'POST') {
        await toggleStarApiKey(id)
        return Response.json({ ok: true })
      }
      break
    }
    case 'design':
      return handleStarDesignApi(req, url, segments)
    case 'projects':
      if (method === 'POST') return Response.json(createLocalProject(str((await readBody(req)).name, 80) ?? ''), { status: 201 })
      break
    case '3d':
      if (segments[3] && segments[4] === 'use' && method === 'POST') return Response.json(await recordStar3dTemplateUse(segments[3]))
      return Response.json(await getStar3dTemplates(url.searchParams.get('type') ?? undefined))
    case 'kb':
      return handleStarKnowledgeApi(req, url, segments)
    case 'skills':
      return handleStarSkillsApi(req, segments)
    case 'runtime':
      if (method === 'GET') return Response.json(await getStarRuntimeSnapshot({ refreshPlugins: url.searchParams.get('plugins') === 'refresh' }))
      break
    case 'mcp': {
      const group = segments[3]
      if (!isStarToolGroup(group)) throw ApiError.notFound('Unknown STAR plugin')
      return handleStarMcpRequest(req, group)
    }
    default:
      break
  }
  throw ApiError.notFound('Unknown STAR endpoint')
}

export async function handleStarApi(req: Request, url: URL, segments: string[]): Promise<Response> {
  try {
    return await route(req, url, segments)
  } catch (error) {
    if (segments[2] === 'mcp') {
      return Response.json(
        { jsonrpc: '2.0', error: { code: -32603, message: error instanceof Error ? error.message : String(error) }, id: null },
        { status: 500 },
      )
    }
    return toError(error)
  }
}
