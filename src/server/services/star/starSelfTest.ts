/**
 * STAR capability check (能力测试): runs each capability once, in order, and
 * reports every step as it goes. The desktop polls the latest run; the agent
 * tool streams the same steps as MCP progress.
 */

import { ensureStarRelayKey, getStarProfile, getStarQuota } from './starAccountService.js'
import { pickStarModel, readStarCatalog, refreshStarCatalog, STAR_PREFERRED_FAST_MODELS } from './starCatalog.js'
import { StarApiError, starRequest, starUpload } from './starClient.js'
import { loadStarSettings, starRelayBaseUrl } from './starConfig.js'
import { startStarImageTask, waitForStarTask } from './starMediaService.js'
import { readStarSession, starUserLabel } from './starSession.js'
import { solidPngDataUrl, starAcademicSearch, starReadUrl, starVision, starWebSearch } from './starToolsService.js'

export type StarCheckStatus = 'pending' | 'running' | 'pass' | 'warn' | 'fail' | 'skip'

export type StarCheckItem = {
  id: string
  label: string
  status: StarCheckStatus
  detail: string
  latencyMs?: number
}

export type StarCheckRun = {
  runId: string
  startedAt: number
  finishedAt?: number
  includeGeneration: boolean
  items: StarCheckItem[]
}

type Check = {
  id: string
  label: string
  /** Returns the detail line; throw to fail; return `{ warn }` to warn. */
  run: () => Promise<string | { warn: string }>
  needsSignIn?: boolean
  generation?: boolean
}

let current: StarCheckRun | null = null
let inflight: Promise<StarCheckRun> | null = null

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

const INERT_TOOL = {
  type: 'function',
  function: { name: 'noop', description: 'Unused.', parameters: { type: 'object', properties: {} } },
}

function checks(): Check[] {
  return [
    {
      id: 'service',
      label: '服务连接',
      run: async () => {
        const config = await starRequest<Record<string, unknown>>('GET', '/desktop/config', { timeoutMs: 15_000 })
        const branding = (config?.branding ?? {}) as Record<string, unknown>
        return `已连接 ${loadStarSettings().baseUrl}${branding.appName ? `（应用：${String(branding.appName)}）` : ''}`
      },
    },
    {
      id: 'account',
      label: '账号与额度',
      needsSignIn: true,
      run: async () => {
        const [profile, quota] = await Promise.all([getStarProfile(), getStarQuota()])
        const normal = quota.normal ? `，今日对话 ${quota.normal.used}/${quota.normal.quota}` : ''
        const text = `${starUserLabel(profile)} · ${quota.planName} · 积分 ${quota.credits ?? '--'}${normal}`
        return quota.normal && quota.normal.used >= quota.normal.quota ? { warn: `${text}（今日免费对话额度已用完）` } : text
      },
    },
    {
      id: 'catalog',
      label: '模型目录',
      run: async () => {
        const catalog = await refreshStarCatalog({ force: true })
        return `对话 ${catalog.chat.length} 个 · 绘图 ${catalog.image.length} 个 · 视频 ${catalog.video.length} 个`
      },
    },
    {
      id: 'relay',
      label: '对话中转',
      needsSignIn: true,
      run: async () => {
        const key = await ensureStarRelayKey()
        const response = await fetch(`${starRelayBaseUrl()}/models`, { headers: { Authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(20_000) })
        if (!response.ok) throw new StarApiError(`中转返回 ${response.status}`, response.status)
        const data = await response.json() as { data?: unknown[] }
        return `中转密钥可用，可调用 ${data.data?.length ?? 0} 个模型`
      },
    },
    {
      id: 'chat',
      label: '对话测试',
      needsSignIn: true,
      run: async () => {
        const key = await ensureStarRelayKey()
        const model = pickStarModel(readStarCatalog(), STAR_PREFERRED_FAST_MODELS) ?? STAR_PREFERRED_FAST_MODELS[0]!
        const response = await fetch(`${starRelayBaseUrl()}/chat/completions`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model,
            stream: false,
            max_tokens: 32,
            tools: [INERT_TOOL],
            tool_choice: 'none',
            messages: [{ role: 'user', content: '只回复两个字母：OK' }],
          }),
          signal: AbortSignal.timeout(60_000),
        })
        const payload = await response.json().catch(() => ({})) as Record<string, any>
        if (!response.ok) throw new StarApiError(String(payload?.error?.message ?? payload?.message ?? `对话失败（${response.status}）`), response.status)
        const text = String(payload?.choices?.[0]?.message?.content ?? '').trim()
        return `${model} 回复：${text.slice(0, 40) || '（空）'}`
      },
    },
    {
      id: 'search',
      label: '联网搜索',
      needsSignIn: true,
      run: async () => {
        const result = await starWebSearch('今日科技新闻', 3)
        if (!result.results.length) return { warn: '搜索没有返回结果' }
        return `返回 ${result.results.length} 条，例如「${result.results[0]!.title.slice(0, 30)}」`
      },
    },
    {
      id: 'academic',
      label: '学术论文搜索',
      needsSignIn: true,
      run: async () => {
        const result = await starAcademicSearch('large language model agents', 3)
        if (!result.papers.length) return { warn: '没有检索到论文' }
        return `检索到 ${result.papers.length} 篇（约 ${result.total} 篇匹配），例如「${result.papers[0]!.title.slice(0, 40)}」`
      },
    },
    {
      id: 'read',
      label: '网页阅读',
      needsSignIn: true,
      run: async () => {
        const result = await starReadUrl('https://example.com', '用一句话说明这个网页是做什么的')
        return `${result.title || 'example.com'}：${result.answer.slice(0, 60)}`
      },
    },
    {
      id: 'vision',
      label: '多模态识图',
      needsSignIn: true,
      run: async () => {
        const result = await starVision({ question: '这张图片是什么颜色？只回答颜色名称。', images: [solidPngDataUrl([229, 57, 53])] })
        const ok = /红|red/i.test(result.answer)
        const detail = `${result.model} 识别为「${result.answer.slice(0, 20)}」（测试图为红色）`
        return ok ? detail : { warn: detail }
      },
    },
    {
      id: 'extract',
      label: '文件识别',
      needsSignIn: true,
      run: async () => {
        const session = readStarSession()
        if (!session) throw new StarApiError('未登录', 401)
        try {
          const payload = await starUpload('extract', session.token, new TextEncoder().encode('STAR 文件识别测试\n第二行：12345'), 'star-check.txt', 'text/plain', { timeoutMs: 60_000 })
          const text = String(payload.text ?? '')
          return `云端解析可用，识别出 ${text.length} 个字符`
        } catch (error) {
          if (error instanceof StarApiError && error.status === 403) {
            return { warn: `${error.message}（PDF/Office 云端解析需会员；文本文件和 Read 工具不受影响）` }
          }
          throw error
        }
      },
    },
    {
      id: 'image',
      label: '文生图（实际生成）',
      needsSignIn: true,
      generation: true,
      run: async () => {
        const task = await startStarImageTask({ prompt: '一只坐着的橘色小猫，简笔插画，白色背景', ratio: '1:1', count: 1 }, { source: 'desktop' })
        const done = await waitForStarTask(task.id)
        if (done.status !== 'succeeded') throw new StarApiError(done.error || '生成失败')
        const output = done.outputs[0]
        return `${done.model} 生成成功${done.estimatedCredits ? `（约 ${done.estimatedCredits} 积分）` : ''}：${output?.file ?? output?.url ?? ''}`
      },
    },
  ]
}

export function getStarCheckRun(): StarCheckRun | null {
  return current ? { ...current, items: current.items.map(item => ({ ...item })) } : null
}

/** Start a run, or return the one already in progress. `onStep` sees every change. */
export function runStarChecks(
  options: { includeGeneration?: boolean; onStep?: (run: StarCheckRun) => void } = {},
): Promise<StarCheckRun> {
  if (inflight) return inflight
  const includeGeneration = Boolean(options.includeGeneration)
  const list = checks()
  const run: StarCheckRun = {
    runId: `c${Date.now().toString(36)}`,
    startedAt: Date.now(),
    includeGeneration,
    items: list.map(check => ({ id: check.id, label: check.label, status: 'pending', detail: '' })),
  }
  current = run
  const emit = () => options.onStep?.(getStarCheckRun()!)
  inflight = (async () => {
    const signedIn = Boolean(readStarSession())
    for (const [index, check] of list.entries()) {
      const item = run.items[index]!
      if (check.generation && !includeGeneration) {
        Object.assign(item, { status: 'skip', detail: '未勾选「实际生成」，已跳过（会消耗积分）' })
        emit()
        continue
      }
      if (check.needsSignIn && !signedIn) {
        Object.assign(item, { status: 'skip', detail: '请先登录 STAR 账号' })
        emit()
        continue
      }
      Object.assign(item, { status: 'running', detail: '测试中…' })
      emit()
      const started = Date.now()
      try {
        const result = await check.run()
        Object.assign(item, typeof result === 'string'
          ? { status: 'pass', detail: result }
          : { status: 'warn', detail: result.warn })
      } catch (error) {
        Object.assign(item, { status: 'fail', detail: message(error) })
      }
      item.latencyMs = Date.now() - started
      emit()
    }
    run.finishedAt = Date.now()
    emit()
    return getStarCheckRun()!
  })().finally(() => {
    inflight = null
  })
  return inflight
}

export function formatStarCheckRun(run: StarCheckRun): string {
  const icon: Record<StarCheckStatus, string> = { pass: '✅', warn: '⚠️', fail: '❌', skip: '⏭️', running: '⏳', pending: '…' }
  const lines = run.items.map(item => `${icon[item.status]} ${item.label}：${item.detail}${item.latencyMs !== undefined ? `（${item.latencyMs} ms）` : ''}`)
  const passed = run.items.filter(item => item.status === 'pass').length
  const failed = run.items.filter(item => item.status === 'fail').length
  return [`STAR 能力测试：通过 ${passed} 项，失败 ${failed} 项`, ...lines].join('\n')
}
