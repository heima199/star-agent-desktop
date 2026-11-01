/**
 * STAR media generation: text / images → image, text / images / video → video.
 *
 * A job runs in the desktop server process: references are uploaded, the job
 * is submitted to `/image/generate` or `/video/generate`, polled, and the
 * results are downloaded. Every step is written to the task record and
 * broadcast, so the desktop task center and the agent tool call that started
 * the job both see live progress.
 */

import { randomUUID } from 'node:crypto'

import { StarApiError, starRequest } from './starClient.js'
import { readStarCatalog, refreshStarCatalog, type StarCatalog } from './starCatalog.js'
import {
  clampImageCount,
  imageCost,
  IMAGE_SIZE_RE,
  normalizeTier,
  pickDuration,
  pickImageModel,
  pickImageSize,
  pickRatio,
  pickResolution,
  pickVideoModel,
  acceptsReferenceVideo,
  videoCost,
  type StarVideoType,
} from './starMediaModels.js'
import { publishStarReference, publishStarReferences } from './starMediaRefs.js'
import {
  downloadOutputs,
  errorText,
  FINAL_STATUSES,
  onStarTaskEvent,
  parseSubmission,
  pollRemoteTask,
  resolveOutputDir,
  updateStarTask,
  type StarSubmission,
} from './starMediaRunner.js'
import {
  deleteStarTask,
  listStarTasks,
  newStarTaskId,
  readStarTask,
  saveStarTask,
  type StarMediaKind,
  type StarMediaMode,
  type StarMediaTask,
} from './starMediaStore.js'
import { readStarSession } from './starSession.js'

export type StarImageInput = {
  prompt: string
  model?: string
  /** Reference images: local paths, data URLs or http(s) URLs. One = 图生图, several = 多图生图. */
  references?: string[]
  ratio?: string
  size?: string
  resolution?: string
  quality?: string
  count?: number
}

export type StarVideoInput = {
  prompt: string
  model?: string
  firstFrame?: string
  lastFrame?: string
  /** Reference images (多图生视频). */
  references?: string[]
  /** Reference videos (视频参考生视频). */
  videos?: string[]
  duration?: number
  ratio?: string
  resolution?: string
}

export type StarTaskOrigin = {
  source?: 'desktop' | 'agent'
  sessionId?: string
  /** Directory for downloaded results; relative paths resolve against `cwd`. */
  saveDir?: string
  /** Working directory of the agent session; relative reference paths resolve here. */
  cwd?: string
}

const MAX_IMAGE_REFS = 16
const MAX_VIDEO_IMAGE_REFS = 8
const MAX_VIDEO_REFS = 3

const running = new Map<string, Promise<void>>()
const processStartedAt = Date.now()
let staleChecked = false

function requireToken(): string {
  const session = readStarSession()
  if (!session) throw new StarApiError('请先登录 STAR 账号（左下角头像 → 登录）', 401, 'STAR_SIGNED_OUT')
  return session.token
}

async function loadCatalog(): Promise<StarCatalog | null> {
  return readStarCatalog() ?? await refreshStarCatalog().catch(() => null)
}

function unique(values: readonly (string | undefined)[] | undefined): string[] {
  return [...new Set((values ?? []).map(value => value?.trim() ?? '').filter(Boolean))]
}

function newTask(kind: StarMediaKind, mode: StarMediaMode, model: string, prompt: string, origin: StarTaskOrigin): StarMediaTask {
  const now = Date.now()
  return {
    id: newStarTaskId(),
    kind,
    mode,
    model,
    prompt,
    params: {},
    references: { images: [], videos: [] },
    status: 'queued',
    progress: 0,
    message: '排队中…',
    remoteIds: [],
    outputs: [],
    source: origin.source ?? 'desktop',
    ...(origin.sessionId ? { sessionId: origin.sessionId } : {}),
    saveDir: resolveOutputDir(origin.saveDir, origin.cwd),
    createdAt: now,
    updatedAt: now,
  }
}

function launch(task: StarMediaTask, run: () => Promise<void>): void {
  const job = run()
    .catch((error) => {
      const message = errorText(error)
      updateStarTask(task, { status: 'failed', error: message, message, finishedAt: Date.now() })
    })
    .finally(() => running.delete(task.id))
  running.set(task.id, job)
}

/** Poll every submission (in parallel), reporting their mean progress in 12–92%. */
async function collect(task: StarMediaTask, submissions: StarSubmission[], token: string): Promise<{ urls: string[]; failure: unknown }> {
  const fractions = submissions.map((item): number => (item.urls.length ? 1 : 0))
  const started = Date.now()
  let reportedSeconds = -1
  const report = () => {
    const mean = fractions.reduce((sum, value) => sum + value, 0) / fractions.length
    const progress = Math.max(task.progress, Math.round(12 + mean * 80))
    // Elapsed time keeps the task visibly alive when the service runs long
    // and the estimate has reached its cap.
    const seconds = Math.round((Date.now() - started) / 1000)
    if (progress === task.progress && seconds - reportedSeconds < 5) return
    reportedSeconds = seconds
    const label = task.kind === 'image' ? '生成中' : '视频生成中'
    const hint = progress >= 88 ? '，服务端仍在处理' : task.kind === 'video' ? '，通常需要数分钟' : ''
    updateStarTask(task, { progress, message: `${label} · 已用时 ${seconds} 秒${hint}` })
  }
  const results = await Promise.allSettled(submissions.map(async (item, index) => {
    if (item.urls.length) return item.urls
    if (!item.id) throw new StarApiError('服务没有返回任务编号', 502, 'STAR_MEDIA_SUBMIT')
    const urls = await pollRemoteTask(task.kind, item.id, token, (fraction) => {
      fractions[index] = fraction
      report()
    })
    fractions[index] = 1
    report()
    return urls
  }))
  const urls: string[] = []
  let failure: unknown = null
  for (const result of results) {
    if (result.status === 'fulfilled') urls.push(...result.value)
    else failure = result.reason
  }
  return { urls: [...new Set(urls)], failure }
}

async function finish(task: StarMediaTask, urls: string[], failure: unknown, expected: number): Promise<void> {
  if (!urls.length) throw failure ?? new StarApiError('生成失败', 502, 'STAR_MEDIA_FAILED')
  updateStarTask(task, { status: 'downloading', progress: 94, message: '下载生成结果…' })
  const outputs = await downloadOutputs(task, urls, task.saveDir!)
  const partial = failure && urls.length < expected ? `；另有 ${expected - urls.length} 个失败：${errorText(failure)}` : ''
  updateStarTask(task, {
    status: 'succeeded',
    progress: 100,
    outputs,
    message: `完成，共 ${outputs.length} 个${task.kind === 'image' ? '图片' : '视频'}${partial}`,
    finishedAt: Date.now(),
  })
}

export async function startStarImageTask(input: StarImageInput, origin: StarTaskOrigin = {}): Promise<StarMediaTask> {
  const prompt = input.prompt?.trim()
  if (!prompt) throw new StarApiError('请填写提示词', 400, 'STAR_BAD_PROMPT')
  const token = requireToken()
  const references = unique(input.references)
  if (references.length > MAX_IMAGE_REFS) throw new StarApiError(`参考图最多 ${MAX_IMAGE_REFS} 张`, 400, 'STAR_TOO_MANY_REFERENCES')
  const catalog = await loadCatalog()
  const model = pickImageModel(catalog, input.model?.trim() || undefined, references.length > 0)
  if (!model) throw new StarApiError('没有可用的绘图模型，请在 STAR 后台为应用启用绘图模型', 400, 'STAR_NO_IMAGE_MODEL')
  const count = clampImageCount(input.count)
  const tier = normalizeTier(input.resolution)
  const size = input.size && IMAGE_SIZE_RE.test(input.size.trim()) ? input.size.trim() : pickImageSize(model, input.ratio, tier)
  const mode: StarMediaMode = references.length > 1 ? 'multi2image' : references.length === 1 ? 'image2image' : 'text2image'
  const task = newTask('image', mode, model.id, prompt, origin)
  task.params = { size, count, ...(input.ratio ? { ratio: input.ratio } : {}), ...(tier ? { resolution: tier } : {}) }
  const estimate = imageCost(model, count)
  if (estimate !== undefined) task.estimatedCredits = estimate
  saveStarTask(task)
  updateStarTask(task, {})

  launch(task, async () => {
    let refUrls: string[] = []
    if (references.length) {
      updateStarTask(task, { status: 'uploading', progress: 4, message: `上传 ${references.length} 张参考图…` })
      refUrls = await publishStarReferences(references, 'image', token, MAX_IMAGE_REFS, { cwd: origin.cwd })
      updateStarTask(task, { references: { images: refUrls, videos: [] } })
    }
    const body: Record<string, unknown> = { model: model.id, prompt, size }
    if (tier) body.resolution = tier
    if (input.quality === 'hd' || input.quality === 'standard') body.quality = input.quality
    if (refUrls.length) {
      // The single field wins on the service, so it must carry every URL.
      body.referenceImageUrls = refUrls
      body.referenceImageUrl = refUrls.join(',')
    }
    updateStarTask(task, { status: 'submitting', progress: 8, message: '提交绘图任务…' })
    const batchId = randomUUID()
    const submissions: StarSubmission[] = []
    let failure: unknown = null
    for (let index = 0; index < count; index++) {
      try {
        const payload = await starRequest('POST', '/image/generate', {
          token,
          body: count > 1 ? { ...body, clientBatchId: batchId, batchSize: count, batchIndex: index } : body,
          timeoutMs: 120_000,
        })
        submissions.push(parseSubmission(payload, 'image'))
      } catch (error) {
        // e.g. credits ran out after the first images: keep what was accepted.
        failure = error
        break
      }
    }
    if (!submissions.length) throw failure ?? new StarApiError('绘图任务提交失败', 502, 'STAR_MEDIA_SUBMIT')
    updateStarTask(task, {
      status: 'running',
      progress: 12,
      remoteIds: submissions.map(item => item.id).filter((id): id is string => Boolean(id)),
      message: count > 1 ? `生成中（共 ${submissions.length} 张）…` : '生成中…',
    })
    const collected = await collect(task, submissions, token)
    await finish(task, collected.urls, collected.failure ?? failure, count)
  })
  return { ...task }
}

export async function startStarVideoTask(input: StarVideoInput, origin: StarTaskOrigin = {}): Promise<StarMediaTask> {
  const prompt = input.prompt?.trim()
  if (!prompt) throw new StarApiError('请填写提示词', 400, 'STAR_BAD_PROMPT')
  const token = requireToken()
  const first = input.firstFrame?.trim() || undefined
  const last = input.lastFrame?.trim() || undefined
  const images = unique(input.references)
  const videos = unique(input.videos)
  if (videos.length > MAX_VIDEO_REFS) throw new StarApiError(`参考视频最多 ${MAX_VIDEO_REFS} 个`, 400, 'STAR_TOO_MANY_REFERENCES')
  if (images.length + (first ? 1 : 0) + (last ? 1 : 0) > MAX_VIDEO_IMAGE_REFS) {
    throw new StarApiError(`参考图最多 ${MAX_VIDEO_IMAGE_REFS} 张`, 400, 'STAR_TOO_MANY_REFERENCES')
  }
  const type: StarVideoType = videos.length
    ? 'ref2video'
    : first && last ? 'frames2video' : first || images.length ? 'img2video' : 'txt2video'
  const mode: StarMediaMode = type === 'ref2video'
    ? 'video2video'
    : type === 'frames2video' ? 'frames2video' : type === 'img2video' ? 'image2video' : 'text2video'
  const catalog = await loadCatalog()
  const model = pickVideoModel(catalog, input.model?.trim() || undefined, type, input.duration)
  if (!model) {
    throw new StarApiError(
      type === 'ref2video'
        ? '没有支持参考视频的视频模型（MiniMax H3 或 Seedance 2 系列），请在 STAR 后台为应用启用'
        : '没有可用的视频模型，请在 STAR 后台为应用启用视频模型',
      400,
      'STAR_NO_VIDEO_MODEL',
    )
  }
  // A listed model that drops reference videos would return an unrelated clip.
  if (type === 'ref2video' && catalog?.video.some(item => item.id === model.id) && !acceptsReferenceVideo(model)) {
    const capable = (catalog?.video ?? []).filter(acceptsReferenceVideo).map(item => item.label || item.id)
    throw new StarApiError(
      `${model.label || model.id} 不接受参考视频${capable.length ? `，可以改用：${capable.join('、')}` : ''}`,
      400,
      'STAR_MODEL_NO_REFERENCE_VIDEO',
    )
  }
  const duration = pickDuration(model, input.duration)
  const ratio = pickRatio(model, input.ratio)
  const resolution = pickResolution(model, input.resolution)
  const task = newTask('video', mode, model.id, prompt, origin)
  task.params = { type, duration, ratio, resolution }
  const estimate = videoCost(model, duration)
  if (estimate !== undefined) task.estimatedCredits = estimate
  saveStarTask(task)
  updateStarTask(task, {})

  launch(task, async () => {
    if (first || last || images.length || videos.length) {
      updateStarTask(task, { status: 'uploading', progress: 3, message: '上传参考素材…' })
    }
    const firstUrl = first ? await publishStarReference(first, 'image', token, { cwd: origin.cwd }) : undefined
    const lastUrl = last ? await publishStarReference(last, 'image', token, { cwd: origin.cwd }) : undefined
    const imageUrls = await publishStarReferences(images, 'image', token, MAX_VIDEO_IMAGE_REFS, { cwd: origin.cwd })
    const videoUrls = await publishStarReferences(videos, 'video', token, MAX_VIDEO_REFS, { cwd: origin.cwd })
    const allImages = unique([firstUrl, ...imageUrls])
    updateStarTask(task, { references: { images: unique([...allImages, lastUrl]), videos: videoUrls } })

    const body: Record<string, unknown> = { type, model: model.id, prompt, duration, ratio, resolution }
    if (type === 'frames2video') {
      body.firstFrameImage = firstUrl
      body.lastFrameImage = lastUrl
      if (imageUrls.length) body.referenceImages = imageUrls
    } else if (type === 'img2video') {
      body.referenceImages = allImages
      body.firstFrameImage = firstUrl ?? allImages[0]
      if (lastUrl) body.lastFrameImage = lastUrl
    } else if (type === 'ref2video') {
      body.referenceVideos = videoUrls
      if (allImages.length) body.referenceImages = allImages
      if (firstUrl) body.firstFrameImage = firstUrl
    }
    updateStarTask(task, { status: 'submitting', progress: 8, message: '提交视频任务…' })
    const submission = parseSubmission(await starRequest('POST', '/video/generate', { token, body, timeoutMs: 120_000 }), 'video')
    updateStarTask(task, {
      status: 'running',
      progress: 12,
      remoteIds: submission.id ? [submission.id] : [],
      message: '视频生成中（通常需要数分钟）…',
    })
    const collected = await collect(task, [submission], token)
    await finish(task, collected.urls, collected.failure, 1)
  })
  return { ...task }
}

/** Resume jobs a previous server process left running; mark the rest failed. */
function checkStaleTasks(): void {
  if (staleChecked) return
  staleChecked = true
  for (const task of listStarTasks(200)) {
    if (FINAL_STATUSES.has(task.status) || running.has(task.id) || task.createdAt >= processStartedAt) continue
    const session = readStarSession()
    if (!task.remoteIds.length || !session) {
      updateStarTask(task, { status: 'failed', error: '桌面服务重启，任务已中断', message: '桌面服务重启，任务已中断', finishedAt: Date.now() })
      continue
    }
    launch(task, async () => {
      updateStarTask(task, { status: 'running', message: '继续等待生成结果…' })
      const submissions = task.remoteIds.map(id => ({ id, urls: [] as string[] }))
      const collected = await collect(task, submissions, session.token)
      await finish(task, collected.urls, collected.failure, submissions.length)
    })
  }
}

export function listStarMediaTasks(limit = 100): StarMediaTask[] {
  checkStaleTasks()
  return listStarTasks(limit)
}

export function getStarMediaTask(id: string): StarMediaTask | null {
  checkStaleTasks()
  return readStarTask(id)
}

export function removeStarMediaTask(id: string, removeFiles = false): boolean {
  if (running.has(id)) throw new StarApiError('任务仍在进行，完成后再删除', 409, 'STAR_TASK_RUNNING')
  return deleteStarTask(id, removeFiles)
}

export function runningStarTaskCount(): number {
  return running.size
}

/**
 * Wait for a job to finish. Resolves with the latest record when `signal`
 * aborts — the job itself keeps running and stays visible in the task center.
 */
export function waitForStarTask(
  id: string,
  options: { signal?: AbortSignal; onUpdate?: (task: StarMediaTask) => void } = {},
): Promise<StarMediaTask> {
  return new Promise((resolve, reject) => {
    const current = readStarTask(id)
    if (!current) {
      reject(new StarApiError('任务不存在', 404, 'STAR_TASK_NOT_FOUND'))
      return
    }
    if (FINAL_STATUSES.has(current.status)) {
      resolve(current)
      return
    }
    let unsubscribe = () => {}
    const guard = setInterval(() => {
      // A job that is not running here (and not final) will never report again.
      if (!running.has(id)) finishWith(readStarTask(id) ?? current)
    }, 5_000)
    const finishWith = (task: StarMediaTask) => {
      clearInterval(guard)
      unsubscribe()
      options.signal?.removeEventListener('abort', onAbort)
      resolve(task)
    }
    const onAbort = () => finishWith(readStarTask(id) ?? current)
    unsubscribe = onStarTaskEvent((task) => {
      if (task.id !== id) return
      options.onUpdate?.(task)
      if (FINAL_STATUSES.has(task.status)) finishWith(task)
    })
    if (options.signal?.aborted) onAbort()
    else options.signal?.addEventListener('abort', onAbort, { once: true })
  })
}

export { onStarTaskEvent }
