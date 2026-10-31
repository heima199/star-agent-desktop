import { useEffect, useState } from 'react'
import { CheckCircle2, CircleAlert, Copy, FolderOpen, ImagePlus, Loader2, Play, Trash2 } from 'lucide-react'
import { Progress } from '../../components/ui/Progress'
import { getDesktopHost } from '../../lib/desktopHost'
import { useUIStore } from '../../stores/uiStore'
import { useStarStore } from '../../stores/starStore'
import { starApi, starErrorText, type StarMediaTask } from '../../api/star'
import { StarVideoPlayer } from '../../components/star/StarVideoPlayer'

const blobCache = new Map<string, Promise<string>>()

/** Blob URL of a downloaded output (images and videos both go through the authenticated client). */
export function useStarOutputUrl(task: StarMediaTask, index: number): { url: string | null; failed: boolean } {
  const output = task.outputs[index]
  const key = `${task.id}:${index}`
  const [state, setState] = useState<{ url: string | null; failed: boolean }>({ url: null, failed: false })
  useEffect(() => {
    if (!output) return
    if (!output.file) {
      // Download failed on the server: the remote URL is still viewable for images.
      setState({ url: output.kind === 'image' ? output.url : null, failed: output.kind !== 'image' })
      return
    }
    let alive = true
    let pending = blobCache.get(key)
    if (!pending) {
      pending = starApi.outputBlob(task.id, index).then(blob => URL.createObjectURL(blob))
      blobCache.set(key, pending)
      pending.catch(() => blobCache.delete(key))
    }
    pending.then(url => { if (alive) setState({ url, failed: false }) })
      .catch(() => { if (alive) setState({ url: output.kind === 'image' ? output.url : null, failed: true }) })
    return () => { alive = false }
  }, [key, output, task.id, index])
  return state
}

export const STAR_MODE_LABELS: Record<string, string> = {
  text2image: '文生图',
  image2image: '图生图',
  multi2image: '多图生图',
  text2video: '文生视频',
  image2video: '图生视频',
  frames2video: '首尾帧视频',
  ref2video: '视频参考',
  video2video: '视频参考生视频',
}

const STATUS_LABELS: Record<StarMediaTask['status'], string> = {
  queued: '排队中',
  uploading: '上传素材',
  submitting: '提交中',
  running: '生成中',
  downloading: '下载结果',
  succeeded: '已完成',
  failed: '失败',
}

function toast(type: 'success' | 'error' | 'info', message: string) {
  useUIStore.getState().addToast({ type, message })
}

/** Controls on the dark viewer backdrop, in the lightbox palette every theme shares. */
const VIEWER_BUTTON = 'rounded-[var(--radius-sm)] bg-[var(--color-lightbox-control-bg)] px-2.5 py-1 text-[var(--color-lightbox-control-fg)] transition-colors hover:bg-[var(--color-lightbox-control-hover)]'

function dirname(file: string): string {
  const index = Math.max(file.lastIndexOf('\\'), file.lastIndexOf('/'))
  return index > 0 ? file.slice(0, index) : file
}

export function formatStarTime(ts: number): string {
  const date = new Date(ts)
  const pad = (value: number) => String(value).padStart(2, '0')
  const sameDay = new Date().toDateString() === date.toDateString()
  return `${sameDay ? '' : `${date.getMonth() + 1}/${date.getDate()} `}${pad(date.getHours())}:${pad(date.getMinutes())}`
}

export function StarOutputThumb({ task, index, onOpen, className = '' }: { task: StarMediaTask; index: number; onOpen?: () => void; className?: string }) {
  const { url, failed } = useStarOutputUrl(task, index)
  const output = task.outputs[index]
  if (!output) return null
  return (
    <button
      type="button"
      onClick={onOpen}
      title={output.name}
      className={`relative overflow-hidden rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface-container)] ${className}`}
    >
      {url ? (
        output.kind === 'image'
          ? <img src={url} alt={output.name} className="h-full w-full object-cover" loading="lazy" />
          : <video src={url} className="h-full w-full object-cover" muted preload="metadata" />
      ) : (
        <span className="flex h-full w-full items-center justify-center text-[11px] text-[var(--color-text-tertiary)]">
          {failed ? '无法预览' : <Loader2 size={16} className="animate-spin" />}
        </span>
      )}
      {output.kind === 'video' ? (
        <span className="absolute inset-0 flex items-center justify-center"><Play size={22} className="rounded-full bg-[var(--color-lightbox-scrim)] p-1 text-[var(--color-lightbox-control-bg)]" aria-hidden="true" /></span>
      ) : null}
    </button>
  )
}

/** Full-size preview of one output. */
export function StarOutputViewer({ task, index, onClose }: { task: StarMediaTask; index: number; onClose: () => void }) {
  const { url } = useStarOutputUrl(task, index)
  const output = task.outputs[index]
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])
  if (!output) return null
  return (
    <div className="fixed inset-0 z-[var(--z-dialog)] flex flex-col items-center justify-center gap-3 bg-[var(--color-lightbox-scrim)] p-8" onClick={onClose}>
      <div className="flex max-h-[82vh] max-w-[90vw] items-center justify-center" onClick={event => event.stopPropagation()}>
        {url ? (
          output.kind === 'image'
            ? <img src={url} alt={output.name} className="max-h-[82vh] max-w-[90vw] rounded-[var(--radius-md)] object-contain" />
            : <StarVideoPlayer src={url} label={output.name} autoPlay className="rounded-[var(--radius-md)]" videoClassName="max-h-[82vh] max-w-[90vw]" />
        ) : <Loader2 size={24} className="animate-spin text-[var(--color-lightbox-control-bg)]" aria-label="加载中" />}
      </div>
      <div className="flex max-w-[90vw] flex-wrap items-center justify-center gap-2 text-[12px] text-[var(--color-lightbox-control-bg)]" onClick={event => event.stopPropagation()}>
        <span className="max-w-[60vw] truncate opacity-90">{task.prompt}</span>
        <span className="opacity-90">· {task.model}</span>
        {output.file ? <button type="button" className={VIEWER_BUTTON} onClick={() => void getDesktopHost().shell.openPath(dirname(output.file!))}>打开所在文件夹</button> : null}
        <button type="button" className={VIEWER_BUTTON} onClick={() => void navigator.clipboard.writeText(output.url).then(() => toast('success', '链接已复制'))}>复制链接</button>
      </div>
    </div>
  )
}

/** One job in the task center: live progress while running, results when done. */
export function StarTaskCard({ task, onUseAsReference }: { task: StarMediaTask; onUseAsReference?: (url: string, kind: 'image' | 'video') => void }) {
  const [viewing, setViewing] = useState<number | null>(null)
  const active = task.status !== 'succeeded' && task.status !== 'failed'
  const remove = async () => {
    try {
      await starApi.deleteTask(task.id, false)
      useStarStore.getState().removeTask(task.id)
    } catch (error) {
      toast('error', starErrorText(error))
    }
  }
  const firstFile = task.outputs.find(output => output.file)?.file
  return (
    <div className="flex flex-col gap-2 rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-surface-container-lowest)] p-3" data-testid="star-task-card">
      <div className="flex items-start gap-2">
        <span className="mt-0.5 shrink-0">
          {task.status === 'succeeded'
            ? <CheckCircle2 size={15} className="text-[var(--color-success)]" />
            : task.status === 'failed'
              ? <CircleAlert size={15} className="text-[var(--color-error)]" />
              : <Loader2 size={15} className="animate-spin text-[var(--color-brand)]" />}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[12px] text-[var(--color-text-tertiary)]">
            <span className="font-medium text-[var(--color-text-secondary)]">{STAR_MODE_LABELS[task.mode] ?? task.mode}</span>
            <span>{task.model}</span>
            {task.estimatedCredits !== undefined ? <span>约 {task.estimatedCredits} 积分</span> : null}
            <span>{task.source === 'agent' ? '来自对话' : '创作台'}</span>
            <span className="ml-auto tabular-nums">{formatStarTime(task.createdAt)}</span>
          </div>
          <p className="mt-0.5 line-clamp-2 text-[13px] leading-5 text-[var(--color-text-primary)]" title={task.prompt}>{task.prompt}</p>
        </div>
      </div>
      {active ? (
        <div className="flex flex-col gap-1">
          <Progress value={task.progress} size="xs" tone="info" label="生成进度" />
          <div className="flex justify-between text-[11px] text-[var(--color-text-tertiary)]">
            <span>{STATUS_LABELS[task.status]} · {task.message}</span>
            <span className="tabular-nums">{task.progress}%</span>
          </div>
        </div>
      ) : null}
      {task.status === 'failed' ? <p className="text-[12px] leading-5 text-[var(--color-error)]">{task.error ?? task.message}</p> : null}
      {task.outputs.length ? (
        <div className="grid grid-cols-4 gap-1.5">
          {task.outputs.map((output, index) => (
            <StarOutputThumb key={output.url + index} task={task} index={index} className="aspect-square" onOpen={() => setViewing(index)} />
          ))}
        </div>
      ) : null}
      {!active ? (
        <div className="flex flex-wrap items-center gap-1 text-[12px]">
          {firstFile ? (
            <button type="button" className="inline-flex h-6 items-center gap-1 rounded px-1.5 text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-hover)]" onClick={() => void getDesktopHost().shell.openPath(dirname(firstFile))}>
              <FolderOpen size={13} />打开文件夹
            </button>
          ) : null}
          {task.outputs[0] ? (
            <button type="button" className="inline-flex h-6 items-center gap-1 rounded px-1.5 text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-hover)]" onClick={() => void navigator.clipboard.writeText(task.outputs.map(output => output.url).join('\n')).then(() => toast('success', '链接已复制'))}>
              <Copy size={13} />复制链接
            </button>
          ) : null}
          {onUseAsReference && task.outputs[0] ? (
            <button type="button" className="inline-flex h-6 items-center gap-1 rounded px-1.5 text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-hover)]" onClick={() => onUseAsReference(task.outputs[0]!.url, task.outputs[0]!.kind)}>
              <ImagePlus size={13} />用作参考
            </button>
          ) : null}
          <button type="button" className="ml-auto inline-flex h-6 items-center gap-1 rounded px-1.5 text-[var(--color-text-tertiary)] hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-error)]" onClick={() => void remove()}>
            <Trash2 size={13} />删除记录
          </button>
        </div>
      ) : null}
      {viewing !== null ? <StarOutputViewer task={task} index={viewing} onClose={() => setViewing(null)} /> : null}
    </div>
  )
}
