import { useEffect, useMemo, useState } from 'react'
import { CircleAlert, Copy, Film, FolderOpen, ImageIcon, Loader2, Wand2 } from 'lucide-react'
import { Progress } from '@/components/ui/Progress'
import { getDesktopHost } from '../../lib/desktopHost'
import { starApi, type StarMediaTask } from '../../api/star'
import { useStarBrand } from '../../stores/starBrandStore'
import { isStarTaskActive, useStarStore } from '../../stores/starStore'
import { useTabStore } from '../../stores/tabStore'
import { useUIStore } from '../../stores/uiStore'
import { STAR_MODE_LABELS, StarOutputThumb, StarOutputViewer, useStarOutputUrl } from '../../pages/star/starMedia'
import { STAR_STUDIO_TAB_ID, starStudioTabTitle } from './starTabs'
import { StarVideoPlayer } from './StarVideoPlayer'

/** STAR media tools whose result is shown as a card in the transcript. */
const MEDIA_TOOL_RE = /^mcp__plugin_star-(image|video)_[a-z0-9_-]*__star_(text_to_image|image_to_image|text_to_video|image_to_video|video_to_video)$/

export function isStarMediaToolName(toolName: string): boolean {
  return MEDIA_TOOL_RE.test(toolName)
}

const TOOL_LABELS: Record<string, string> = {
  text_to_image: '文生图',
  image_to_image: '图生图',
  text_to_video: '文生视频',
  image_to_video: '图生视频',
  video_to_video: '视频参考',
}

type ToolResult = { content: unknown; isError: boolean } | null | undefined

export type StarChatMediaItem = { id: string; toolName: string; input: unknown; result?: ToolResult }

function resultText(content: unknown): string {
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    return content.map(item => (typeof item === 'string' ? item : item && typeof item === 'object' && typeof (item as { text?: unknown }).text === 'string' ? (item as { text: string }).text : '')).join('\n')
  }
  return ''
}

/** The tool reports `任务 ID：<id>` on every outcome, done or still running. */
export function parseStarTaskId(content: unknown): string | null {
  const match = /任务 ID：\s*([a-z0-9]{6,40})/.exec(resultText(content))
  return match ? match[1]! : null
}

const TASK_POLL_INTERVAL_MS = 2_500
/** Polls a waiting call makes to find its job before it gives up: one minute. */
export const UNMATCHED_TASK_POLLS = 24

function inputRecord(input: unknown): Record<string, unknown> {
  return input && typeof input === 'object' && !Array.isArray(input) ? input as Record<string, unknown> : {}
}

function dirname(file: string): string {
  const index = Math.max(file.lastIndexOf('\\'), file.lastIndexOf('/'))
  return index > 0 ? file.slice(0, index) : file
}

/**
 * The task behind a call: by the ID in its result, or — while the call is
 * still running — the active agent task with the same prompt.
 */
function useCallTask(item: StarChatMediaItem): StarMediaTask | null {
  const taskId = item.result ? parseStarTaskId(item.result.content) : null
  const prompt = typeof inputRecord(item.input).prompt === 'string' ? (inputRecord(item.input).prompt as string).trim() : ''
  const task = useStarStore(s => {
    if (taskId) return s.tasks.find(entry => entry.id === taskId) ?? null
    if (item.result) return null
    return s.tasks.find(entry => entry.source === 'agent' && isStarTaskActive(entry) && entry.prompt.trim() === prompt) ?? null
  })
  useEffect(() => {
    if (!taskId || task) return
    let alive = true
    void starApi.task(taskId).then(({ task: loaded }) => {
      if (alive) useStarStore.getState().upsertTask(loaded)
    }).catch(() => undefined)
    return () => { alive = false }
  }, [taskId, task])
  // Agent jobs start on the server; ask for the list while the call waits, for
  // as long as its job runs. A call that never got a result (a turn stopped
  // mid-call, kept in history) has no job to wait for: it used to poll the STAR
  // server every 2.5 s for as long as it stayed on screen, so it gets a few
  // tries to find its job and then stops.
  const hasTask = task !== null
  useEffect(() => {
    if (item.result) return
    let unmatchedPolls = 0
    const timer = setInterval(() => {
      if (!hasTask && ++unmatchedPolls > UNMATCHED_TASK_POLLS) {
        clearInterval(timer)
        return
      }
      void useStarStore.getState().refreshTasks()
    }, TASK_POLL_INTERVAL_MS)
    return () => clearInterval(timer)
  }, [item.result, hasTask])
  return task
}

function VideoOutput({ task, index }: { task: StarMediaTask; index: number }) {
  const { url, failed } = useStarOutputUrl(task, index)
  return (
    <div className="overflow-hidden rounded-[var(--radius-lg)] border border-[var(--color-border-separator)] bg-[var(--color-surface-container-low)]">
      {url ? (
        <StarVideoPlayer src={url} label={task.outputs[index]?.name ?? '生成的视频'} videoClassName="max-h-[360px] w-full" />
      ) : (
        <div className="flex aspect-video items-center justify-center text-[12px] text-[var(--color-text-tertiary)]">
          {failed ? '视频无法预览，可打开所在文件夹查看' : <Loader2 size={18} className="animate-spin" aria-label="加载视频" />}
        </div>
      )}
    </div>
  )
}

function StarCallCard({ item }: { item: StarChatMediaItem }) {
  const task = useCallTask(item)
  const [viewing, setViewing] = useState<number | null>(null)
  const tool = /__star_([a-z_]+)$/.exec(item.toolName)?.[1] ?? ''
  const isVideo = item.toolName.includes('star-video')
  const brand = useStarBrand()
  const label = (task ? STAR_MODE_LABELS[task.mode] : undefined) ?? TOOL_LABELS[tool] ?? starStudioTabTitle(brand.name)
  // The tool's own reference lines (task ID, follow-up hints) are for the agent, not the card.
  const errorText = item.result?.isError
    ? resultText(item.result.content).split('\n').filter(line => !/^任务 ID：/.test(line.trim())).join('\n').trim()
    : ''
  const failed = Boolean(errorText) || task?.status === 'failed'
  const done = task?.status === 'succeeded'
  const running = !failed && !done
  const requested = Math.min(4, Math.max(1, Number(inputRecord(item.input).count) || 1))
  const Icon = isVideo ? Film : ImageIcon
  const toast = (message: string) => useUIStore.getState().addToast({ type: 'success', message })
  const firstFile = task?.outputs.find(output => output.file)?.file

  const status = failed
    ? `${label}失败`
    : done
      ? `${label}完成 · ${task!.outputs.length} ${isVideo ? '段视频' : '张图片'}`
      : task
        ? `${label}中 · ${task.message || '生成中…'}`
        : `${label} · 正在提交…`

  return (
    <div data-testid="star-chat-media" className="min-w-0 rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-surface-container-lowest)] p-3">
      <div className="flex min-w-0 items-center gap-1.5 text-[12px] text-[var(--color-text-tertiary)]">
        {failed
          ? <CircleAlert size={14} strokeWidth={1.75} className="shrink-0 text-[var(--color-error)]" aria-hidden="true" />
          : running
            ? <Loader2 size={14} strokeWidth={1.75} className="shrink-0 animate-spin text-[var(--color-brand)]" aria-hidden="true" />
            : <Icon size={14} strokeWidth={1.75} className="shrink-0 text-[var(--color-brand)]" aria-hidden="true" />}
        <span className={`truncate ${failed ? 'text-[var(--color-on-error-container)]' : 'text-[var(--color-text-secondary)]'}`}>{brand.name} · {status}</span>
        {task?.model ? <span className="shrink-0 truncate">· {task.model}</span> : null}
        {task?.estimatedCredits !== undefined ? <span className="shrink-0 tabular-nums">· 约 {task.estimatedCredits} 积分</span> : null}
        {running && task ? <span className="ml-auto shrink-0 tabular-nums">{task.progress}%</span> : null}
      </div>

      {running ? (
        <div className="mt-2 flex flex-col gap-2">
          <Progress value={task?.progress ?? 0} indeterminate={!task} size="xs" tone="brand" label={`${label}进度`} />
          <div className={isVideo ? 'grid grid-cols-1' : 'grid grid-flow-col auto-cols-[9.5rem] justify-start gap-2 overflow-x-auto'}>
            {Array.from({ length: isVideo ? 1 : requested }, (_, index) => (
              <div key={index} className={`${isVideo ? 'aspect-video max-h-[240px]' : 'aspect-square'} animate-pulse rounded-[var(--radius-lg)] bg-[var(--color-surface-container)] motion-reduce:animate-none`} />
            ))}
          </div>
          {isVideo ? <p className="text-[11px] text-[var(--color-text-tertiary)]">视频通常需要几分钟，可以继续做别的事，完成后会显示在这里。</p> : null}
        </div>
      ) : null}

      {failed ? (
        <p className="mt-2 rounded-[var(--radius-md)] bg-[var(--color-error-container)] px-3 py-2 text-[12px] leading-5 text-[var(--color-on-error-container)]">
          {errorText || task?.error || task?.message || '生成失败'}
        </p>
      ) : null}

      {done && task ? (
        <div className="mt-2">
          {isVideo ? (
            <div className="grid grid-cols-1 gap-2">
              {task.outputs.map((output, index) => <VideoOutput key={output.url + index} task={task} index={index} />)}
            </div>
          ) : (
            <div className="grid grid-flow-col auto-cols-[9.5rem] justify-start gap-2 overflow-x-auto pb-1 sm:auto-cols-[11rem]">
              {task.outputs.map((output, index) => (
                <StarOutputThumb key={output.url + index} task={task} index={index} className="aspect-square w-full" onOpen={() => setViewing(index)} />
              ))}
            </div>
          )}
          <div className="mt-2 flex flex-wrap items-center gap-1 text-[12px]">
            {firstFile ? (
              <button type="button" className="inline-flex h-6 items-center gap-1 rounded-[var(--radius-sm)] px-1.5 text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-hover)]" onClick={() => void getDesktopHost().shell.openPath(dirname(firstFile))}>
                <FolderOpen size={13} aria-hidden="true" />打开文件夹
              </button>
            ) : null}
            {task.outputs[0] ? (
              <button type="button" className="inline-flex h-6 items-center gap-1 rounded-[var(--radius-sm)] px-1.5 text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-hover)]" onClick={() => void navigator.clipboard.writeText(task.outputs.map(output => output.url).join('\n')).then(() => toast('链接已复制'))}>
                <Copy size={13} aria-hidden="true" />复制链接
              </button>
            ) : null}
            <button type="button" className="inline-flex h-6 items-center gap-1 rounded-[var(--radius-sm)] px-1.5 text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-hover)]" onClick={() => useTabStore.getState().openTab(STAR_STUDIO_TAB_ID, starStudioTabTitle(brand.name), 'star-studio')}>
              <Wand2 size={13} aria-hidden="true" />在 {starStudioTabTitle(brand.name)}中查看
            </button>
          </div>
        </div>
      ) : null}

      {viewing !== null && task ? <StarOutputViewer task={task} index={viewing} onClose={() => setViewing(null)} /> : null}
    </div>
  )
}

/** One or more STAR media calls in a row of the transcript. */
export function StarChatMediaGroup({ items }: { items: StarChatMediaItem[] }) {
  const unique = useMemo(() => items.filter((item, index) => items.findIndex(other => other.id === item.id) === index), [items])
  return (
    <div className="space-y-2" data-testid="star-chat-media-group">
      {unique.map(item => <StarCallCard key={item.id} item={item} />)}
    </div>
  )
}

export function StarChatMediaBlock({ toolName, input, result }: { toolName: string; input: unknown; result?: ToolResult }) {
  return <StarCallCard item={{ id: 'single', toolName, input, result }} />
}
