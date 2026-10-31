import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import {
  AppWindow, Bot, Box, CircleAlert, CircleCheck, CircleDashed, Clock, Cpu, ExternalLink, Eye, EyeOff, Image, Layers,
  MemoryStick, MessageCircle, MessagesSquare, Monitor, Network, Pause, Play, Plug, RefreshCw, Rocket, Server, Settings2,
  SquareTerminal, type LucideIcon,
} from 'lucide-react'
import {
  starApi,
  starErrorText,
  type StarRuntimePlugin,
  type StarRuntimeProcess,
  type StarRuntimeRole,
  type StarRuntimeSession,
  type StarRuntimeSnapshot,
  type StarRuntimeTask,
} from '@/api/star'
import { useChatStore } from '@/stores/chatStore'
import { useSessionStore } from '@/stores/sessionStore'
import { useStarBrand } from '@/stores/starBrandStore'
import { useTabStore } from '@/stores/tabStore'
import { STAR_STUDIO_TAB_ID, starStudioTabTitle } from '@/components/star/starTabs'
import { STAR_MODE_LABELS } from '../starMedia'
import { MemoryRuntimePage } from './MemoryRuntimePage'
import { ErrorRow, LoadingRow } from './StarPageShell'

const POLL_MS = 2_000
const HISTORY = 60

// ─── Formatting ──────────────────────────────────────────────────────

function formatBytes(bytes: number | null | undefined): string {
  if (bytes === null || bytes === undefined || !Number.isFinite(bytes)) return '--'
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(2)} GB`
  if (bytes >= 1024 ** 2) return `${(bytes / 1024 ** 2).toFixed(bytes >= 100 * 1024 ** 2 ? 0 : 1)} MB`
  return `${Math.max(0, Math.round(bytes / 1024))} KB`
}

function formatDuration(ms: number | null | undefined): string {
  if (ms === null || ms === undefined || !Number.isFinite(ms) || ms < 0) return '--'
  const seconds = Math.floor(ms / 1000)
  const days = Math.floor(seconds / 86_400)
  const hours = Math.floor((seconds % 86_400) / 3_600)
  const minutes = Math.floor((seconds % 3_600) / 60)
  if (days > 0) return `${days} 天 ${hours} 小时`
  if (hours > 0) return `${hours} 小时 ${minutes} 分`
  if (minutes > 0) return `${minutes} 分 ${seconds % 60} 秒`
  return `${seconds} 秒`
}

function formatCpu(value: number | null | undefined): string {
  return value === null || value === undefined ? '--' : `${value.toFixed(1)}%`
}

function formatClock(ms: number): string {
  const date = new Date(ms)
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
}

function basename(value: string): string {
  const parts = value.split(/[\\/]/).filter(Boolean)
  return parts.at(-1) ?? value
}

const ROLE_ICONS: Record<StarRuntimeRole, LucideIcon> = {
  launcher: Rocket,
  main: AppWindow,
  renderer: Monitor,
  gpu: Cpu,
  network: Network,
  utility: Settings2,
  server: Server,
  adapter: MessageCircle,
  session: Bot,
  tool: SquareTerminal,
  other: Box,
}

const SESSION_STATES: Record<string, { label: string; tone: Tone }> = {
  running: { label: '运行中', tone: 'brand' },
  waiting: { label: '等待授权', tone: 'warn' },
  starting: { label: '启动中', tone: 'info' },
  idle: { label: '空闲', tone: 'muted' },
  exited: { label: '已退出', tone: 'muted' },
  failed: { label: '出错', tone: 'danger' },
  completed: { label: '已完成', tone: 'ok' },
}

const PERMISSION_LABELS: Record<string, string> = {
  default: '默认',
  acceptEdits: '自动改文件',
  plan: '计划模式',
  bypassPermissions: '全自动',
  dontAsk: '不询问',
  auto: '自动',
}

const TASK_STATES: Record<string, { label: string; tone: Tone }> = {
  queued: { label: '排队中', tone: 'info' },
  uploading: { label: '上传参考', tone: 'brand' },
  submitting: { label: '提交中', tone: 'brand' },
  running: { label: '生成中', tone: 'brand' },
  downloading: { label: '下载结果', tone: 'brand' },
  succeeded: { label: '已完成', tone: 'ok' },
  failed: { label: '失败', tone: 'danger' },
}

type Tone = 'brand' | 'ok' | 'warn' | 'danger' | 'info' | 'muted'

const TONE_CLASSES: Record<Tone, string> = {
  brand: 'bg-[var(--color-brand-soft)] text-[var(--color-on-brand-soft)]',
  ok: 'bg-[var(--color-success-container)] text-[var(--color-success)]',
  warn: 'bg-[var(--color-warning-container)] text-[var(--color-warning)]',
  danger: 'bg-[var(--color-error-container)] text-[var(--color-error)]',
  info: 'bg-[var(--color-surface-container-high)] text-[var(--color-text-accent)]',
  muted: 'bg-[var(--color-surface-container-high)] text-[var(--color-text-tertiary)]',
}

function Chip({ tone, children, pulse = false }: { tone: Tone; children: ReactNode; pulse?: boolean }) {
  return (
    <span className={`inline-flex h-5 shrink-0 items-center gap-1 rounded-full px-2 text-[11px] font-medium ${TONE_CLASSES[tone]}`}>
      {pulse ? <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-current" aria-hidden="true" /> : null}
      {children}
    </span>
  )
}

/** Tiny trend line of the last samples; the area under it is tinted. */
function Sparkline({ values, max }: { values: number[]; max?: number }) {
  if (values.length < 2) return <div className="h-8" aria-hidden="true" />
  const top = Math.max(max ?? 0, ...values, 1e-6)
  const step = 100 / (HISTORY - 1)
  const offset = (HISTORY - values.length) * step
  const points = values.map((value, index) => `${(offset + index * step).toFixed(2)},${(30 - (value / top) * 26).toFixed(2)}`)
  return (
    <svg viewBox="0 0 100 32" preserveAspectRatio="none" className="h-8 w-full" aria-hidden="true">
      <polyline points={`${offset.toFixed(2)},32 ${points.join(' ')} 100,32`} fill="var(--color-brand-soft)" stroke="none" />
      <polyline points={points.join(' ')} fill="none" stroke="var(--color-brand)" strokeWidth="1.4" vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
    </svg>
  )
}

function StatCard({ icon: Icon, label, value, hint, trend, trendMax }: {
  icon: LucideIcon
  label: string
  value: string
  hint?: string
  trend?: number[]
  trendMax?: number
}) {
  return (
    <div className="flex min-w-0 flex-col gap-1 rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-surface-container-lowest)] px-4 pb-2 pt-3">
      <div className="flex items-center gap-1.5 text-[12px] text-[var(--color-text-tertiary)]">
        <Icon size={13} strokeWidth={1.8} aria-hidden="true" />{label}
      </div>
      <div className="truncate text-[22px] font-semibold tabular-nums text-[var(--color-text-primary)]">{value}</div>
      <div className="truncate text-[11px] text-[var(--color-text-tertiary)]">{hint ?? '\u00a0'}</div>
      {trend ? <Sparkline values={trend} max={trendMax} /> : <div className="h-8" aria-hidden="true" />}
    </div>
  )
}

function Section({ icon: Icon, title, count, actions, children }: {
  icon: LucideIcon
  title: string
  count?: ReactNode
  actions?: ReactNode
  children: ReactNode
}) {
  return (
    <section className="mt-7">
      <div className="mb-2.5 flex items-center gap-2">
        <Icon size={15} strokeWidth={1.8} className="text-[var(--color-text-secondary)]" aria-hidden="true" />
        <h2 className="text-[14px] font-semibold text-[var(--color-text-primary)]">{title}</h2>
        {count !== undefined ? <span className="text-[12px] text-[var(--color-text-tertiary)]">{count}</span> : null}
        <div className="ml-auto flex items-center gap-2">{actions}</div>
      </div>
      {children}
    </section>
  )
}

function SmallButton({ onClick, children, disabled = false, title }: { onClick: () => void; children: ReactNode; disabled?: boolean; title?: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      className="inline-flex h-7 items-center gap-1.5 rounded-[var(--radius-md)] border border-[var(--color-border)] px-2.5 text-[12px] text-[var(--color-text-secondary)] transition-colors hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-text-primary)] disabled:opacity-50"
    >
      {children}
    </button>
  )
}

// ─── Sections ────────────────────────────────────────────────────────

function openSession(sessionId: string, title: string): void {
  useTabStore.getState().openTab(sessionId, title || '会话', 'session')
  useChatStore.getState().connectToSession(sessionId)
}

const GRID = 'grid grid-cols-[minmax(0,1fr)_76px_72px_92px_108px] items-center gap-3'

function ProcessTable({ rows, now, titleOf }: { rows: StarRuntimeProcess[]; now: number; titleOf: (sessionId: string) => string }) {
  return (
    <div className="overflow-hidden rounded-[var(--radius-lg)] border border-[var(--color-border)]">
      <div className={`${GRID} border-b border-[var(--color-border)] bg-[var(--color-surface-container-low)] px-4 py-2 text-[11px] text-[var(--color-text-tertiary)]`}>
        <span>进程</span>
        <span className="text-right">PID</span>
        <span className="text-right">CPU</span>
        <span className="text-right">内存</span>
        <span className="text-right">已运行</span>
      </div>
      {rows.map(row => {
        const Icon = ROLE_ICONS[row.role] ?? Box
        const indent = Math.max(0, row.depth) * 16
        const sessionTitle = row.role === 'session' && row.sessionId ? titleOf(row.sessionId) : ''
        const detail = sessionTitle || row.detail
        return (
          <div key={`${row.pid}-${row.startedAt ?? 0}`} className={`${GRID} group/row border-b border-[var(--color-border)] px-4 py-[7px] text-[12px] last:border-b-0 hover:bg-[var(--color-surface-hover)]`}>
            <span className="flex min-w-0 items-center gap-2" style={{ paddingLeft: indent }}>
              <Icon size={14} strokeWidth={1.8} className={`shrink-0 ${row.role === 'session' || row.role === 'server' ? 'text-[var(--color-brand)]' : 'text-[var(--color-text-tertiary)]'}`} aria-hidden="true" />
              <span className="shrink-0 text-[var(--color-text-primary)]">{row.label}</span>
              {detail ? <span className="min-w-0 truncate text-[var(--color-text-tertiary)]">{detail}</span> : null}
              {row.role === 'launcher' ? <Chip tone="muted">开发</Chip> : null}
              <span className="min-w-0 truncate font-mono text-[11px] text-[var(--color-text-tertiary)] opacity-70">{row.name}</span>
              {row.role === 'session' && row.sessionId ? (
                <button type="button" onClick={() => openSession(row.sessionId!, sessionTitle)} className="shrink-0 text-[var(--color-text-accent)] opacity-0 hover:underline focus-visible:opacity-100 group-hover/row:opacity-100" title="打开对话" aria-label="打开对话">
                  <ExternalLink size={12} aria-hidden="true" />
                </button>
              ) : null}
            </span>
            <span className="text-right font-mono text-[11px] tabular-nums text-[var(--color-text-secondary)]">{row.pid}</span>
            <span className="text-right tabular-nums text-[var(--color-text-secondary)]">{formatCpu(row.cpuPercent)}</span>
            <span className="text-right tabular-nums text-[var(--color-text-primary)]">{formatBytes(row.memoryBytes)}</span>
            <span className="text-right tabular-nums text-[var(--color-text-tertiary)]">{row.startedAt ? formatDuration(now - row.startedAt) : '--'}</span>
          </div>
        )
      })}
    </div>
  )
}

function SessionList({ sessions, now, titleOf }: { sessions: StarRuntimeSession[]; now: number; titleOf: (sessionId: string) => string }) {
  if (sessions.length === 0) {
    return (
      <div className="rounded-[var(--radius-lg)] border border-dashed border-[var(--color-border)] px-4 py-6 text-center text-[12px] text-[var(--color-text-tertiary)]">
        现在没有对话进程。新建会话并发送消息后，对应的命令行进程会出现在这里。
      </div>
    )
  }
  return (
    <div className="grid gap-2 md:grid-cols-2">
      {sessions.map(session => {
        const state = SESSION_STATES[session.state] ?? { label: session.state, tone: 'muted' as Tone }
        const title = titleOf(session.sessionId) || basename(session.workDir) || session.sessionId.slice(0, 8)
        return (
          <div key={session.sessionId} className="flex min-w-0 flex-col gap-1.5 rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-surface-container-lowest)] px-4 py-3">
            <div className="flex min-w-0 items-center gap-2">
              <Bot size={14} strokeWidth={1.8} className="shrink-0 text-[var(--color-brand)]" aria-hidden="true" />
              <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-[var(--color-text-primary)]" title={title}>{title}</span>
              <Chip tone={state.tone} pulse={session.state === 'running'}>{state.label}</Chip>
              {session.isTeamWorker ? <Chip tone="info">团队成员</Chip> : null}
            </div>
            <div className="truncate text-[11px] text-[var(--color-text-tertiary)]" title={session.workDir}>{session.workDir}</div>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-[var(--color-text-secondary)]">
              <span>{session.modelId ?? '默认模型'}</span>
              <span>权限：{PERMISSION_LABELS[session.permissionMode] ?? session.permissionMode}</span>
              <span className="tabular-nums">PID {session.pid}</span>
              <span className="tabular-nums">{formatBytes(session.memoryBytes)}</span>
              <span className="tabular-nums">CPU {formatCpu(session.cpuPercent)}</span>
              {session.childCount > 0 ? <span>{session.childCount} 个子进程</span> : null}
              {session.pendingPermissions > 0 ? <span className="text-[var(--color-warning)]">{session.pendingPermissions} 个待授权</span> : null}
              {session.startedAt ? <span className="tabular-nums">已运行 {formatDuration(now - session.startedAt)}</span> : null}
              <button type="button" onClick={() => openSession(session.sessionId, title)} className="ml-auto inline-flex items-center gap-1 text-[var(--color-text-accent)] hover:underline">
                打开对话<ExternalLink size={11} aria-hidden="true" />
              </button>
            </div>
          </div>
        )
      })}
    </div>
  )
}

function PluginList({ items, signedIn }: { items: StarRuntimePlugin[]; signedIn: boolean }) {
  const brand = useStarBrand()
  if (items.length === 0) return <LoadingRow label="正在检测插件接口…" />
  return (
    <div className="overflow-hidden rounded-[var(--radius-lg)] border border-[var(--color-border)]">
      {!signedIn ? (
        <div className="border-b border-[var(--color-border)] bg-[var(--color-surface-container-low)] px-4 py-2 text-[12px] text-[var(--color-text-tertiary)]">
          未登录 {brand.name}：接口可以响应，但这些插件只会在登录后出现在对话里。
        </div>
      ) : null}
      {items.map(item => (
        <div key={item.group} className="flex items-center gap-3 border-b border-[var(--color-border)] px-4 py-2.5 text-[12px] last:border-b-0">
          {item.ok
            ? <CircleCheck size={15} className="shrink-0 text-[var(--color-success)]" aria-hidden="true" />
            : <CircleAlert size={15} className="shrink-0 text-[var(--color-error)]" aria-hidden="true" />}
          <span className="w-[120px] shrink-0 font-mono text-[12px] text-[var(--color-text-primary)]">{item.name}</span>
          <span className="min-w-0 flex-1 truncate text-[var(--color-text-tertiary)]" title={item.description}>{item.description}</span>
          {item.enabled === null ? null : item.enabled ? <Chip tone="ok">已启用</Chip> : <Chip tone="muted">已停用</Chip>}
          <span className="w-[160px] shrink-0 text-right tabular-nums text-[var(--color-text-secondary)]">
            {item.ok ? `${item.tools} 个工具 · ${item.latencyMs ?? '--'} ms` : item.error ?? `HTTP ${item.status ?? '--'}`}
          </span>
        </div>
      ))}
    </div>
  )
}

function TaskList({ tasks, now }: { tasks: StarRuntimeTask[]; now: number }) {
  if (tasks.length === 0) {
    return (
      <div className="rounded-[var(--radius-lg)] border border-dashed border-[var(--color-border)] px-4 py-6 text-center text-[12px] text-[var(--color-text-tertiary)]">
        还没有生成任务。对话里的文生图、图生视频等任务也会显示在这里。
      </div>
    )
  }
  return (
    <div className="overflow-hidden rounded-[var(--radius-lg)] border border-[var(--color-border)]">
      {tasks.map(task => {
        const state = TASK_STATES[task.status] ?? { label: task.status, tone: 'muted' as Tone }
        const active = task.status !== 'succeeded' && task.status !== 'failed'
        const end = task.finishedAt ?? (active ? now : task.updatedAt)
        return (
          <div key={task.id} className="flex flex-col gap-1.5 border-b border-[var(--color-border)] px-4 py-2.5 text-[12px] last:border-b-0">
            <div className="flex min-w-0 items-center gap-2">
              <Image size={14} strokeWidth={1.8} className="shrink-0 text-[var(--color-text-tertiary)]" aria-hidden="true" />
              <span className="shrink-0 text-[var(--color-text-primary)]">{STAR_MODE_LABELS[task.mode] ?? task.mode}</span>
              <span className="min-w-0 flex-1 truncate text-[var(--color-text-tertiary)]">{task.model}</span>
              <span className="shrink-0 text-[11px] text-[var(--color-text-tertiary)]">{task.source === 'agent' ? '来自对话' : '创作台'}</span>
              <span className="w-[76px] shrink-0 text-right tabular-nums text-[11px] text-[var(--color-text-tertiary)]">{formatDuration(end - task.createdAt)}</span>
              <Chip tone={state.tone} pulse={active}>{state.label}</Chip>
            </div>
            {active ? (
              <div className="flex items-center gap-2">
                <div className="h-1 flex-1 overflow-hidden rounded-full bg-[var(--color-surface-container-high)]">
                  <div className="h-full rounded-full bg-[var(--color-brand)] transition-[width] duration-500" style={{ width: `${Math.max(3, Math.min(100, task.progress))}%` }} />
                </div>
                <span className="w-9 text-right tabular-nums text-[11px] text-[var(--color-text-tertiary)]">{Math.round(task.progress)}%</span>
              </div>
            ) : null}
            {task.message && active ? <div className="truncate text-[11px] text-[var(--color-text-tertiary)]">{task.message}</div> : null}
          </div>
        )
      })}
    </div>
  )
}

// ─── Page ────────────────────────────────────────────────────────────

type History = { memory: number[]; cpu: number[] }

function useRuntimeSnapshot(paused: boolean) {
  const [snapshot, setSnapshot] = useState<StarRuntimeSnapshot | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [history, setHistory] = useState<History>({ memory: [], cpu: [] })
  const [checkingPlugins, setCheckingPlugins] = useState(false)
  const alive = useRef(true)
  const inFlight = useRef(false)

  const load = useCallback(async (refreshPlugins = false) => {
    if (inFlight.current && !refreshPlugins) return
    inFlight.current = true
    try {
      const next = await starApi.runtime(refreshPlugins)
      if (!alive.current) return
      setSnapshot(next)
      setError(null)
      setHistory(current => ({
        memory: [...current.memory, next.totals.memoryBytes].slice(-HISTORY),
        cpu: next.totals.cpuPercent === null ? current.cpu : [...current.cpu, next.totals.cpuPercent].slice(-HISTORY),
      }))
    } catch (cause) {
      if (alive.current) setError(starErrorText(cause))
    } finally {
      inFlight.current = false
    }
  }, [])

  useEffect(() => {
    alive.current = true
    return () => { alive.current = false }
  }, [])

  useEffect(() => {
    if (paused) return
    let timer: ReturnType<typeof setTimeout> | undefined
    let stopped = false
    const tick = async () => {
      if (document.visibilityState === 'visible') await load()
      if (!stopped) timer = setTimeout(tick, POLL_MS)
    }
    void tick()
    return () => {
      stopped = true
      if (timer) clearTimeout(timer)
    }
  }, [paused, load])

  const recheckPlugins = useCallback(async () => {
    setCheckingPlugins(true)
    try {
      await load(true)
    } finally {
      if (alive.current) setCheckingPlugins(false)
    }
  }, [load])

  return { snapshot, error, history, checkingPlugins, recheckPlugins, reload: () => void load() }
}

/**
 * 运行时: STAR's processes, conversations, plugins and generation tasks on
 * this computer, polled every two seconds while shown. The description and
 * the refresh controls render into `actionsSlot`, the host page's header.
 */
export function RuntimeBody({ actionsSlot }: { actionsSlot: HTMLElement | null }) {
  const brand = useStarBrand()
  const [paused, setPaused] = useState(false)
  const [showMinor, setShowMinor] = useState(false)
  const { snapshot, error, history, checkingPlugins, recheckPlugins, reload } = useRuntimeSnapshot(paused)
  const sessions = useSessionStore(s => s.sessions)
  const titles = useMemo(() => new Map(sessions.map(session => [session.id, session.title])), [sessions])
  const titleOf = useCallback((sessionId: string) => titles.get(sessionId) ?? '', [titles])
  const now = snapshot?.at ?? Date.now()

  const rows = useMemo(() => (snapshot?.processes ?? []).filter(row => showMinor || !row.minor), [snapshot, showMinor])
  const minorCount = (snapshot?.processes ?? []).filter(row => row.minor).length
  const activeChats = (snapshot?.sessions ?? []).filter(session => session.state === 'running' || session.state === 'waiting').length

  const header = (
    <>
      <p className="min-w-0 flex-1 truncate text-[12px] text-[var(--color-text-tertiary)]">这台电脑上 {brand.name} 的进程、对话、插件和生成任务</p>
      <div className="flex shrink-0 items-center gap-2">
        {snapshot ? <span className="text-[12px] tabular-nums text-[var(--color-text-tertiary)]">{paused ? '已暂停' : '每 2 秒刷新'} · {formatClock(snapshot.at)}</span> : null}
        <SmallButton onClick={() => setPaused(value => !value)} title={paused ? '继续自动刷新' : '暂停自动刷新'}>
          {paused ? <Play size={13} strokeWidth={1.75} aria-hidden="true" /> : <Pause size={13} strokeWidth={1.75} aria-hidden="true" />}{paused ? '继续' : '暂停'}
        </SmallButton>
        <SmallButton onClick={reload} title="立即刷新"><RefreshCw size={13} strokeWidth={1.75} aria-hidden="true" />刷新</SmallButton>
      </div>
    </>
  )

  return (
    <div data-testid="runtime-view" className="min-h-0 flex-1 overflow-y-auto [scrollbar-gutter:stable]">
      {actionsSlot ? createPortal(header, actionsSlot) : null}
      <div className="mx-auto w-full max-w-[1120px] px-8 pb-16 pt-6">
        {error ? <div className="mb-4"><ErrorRow message={`读取运行状态失败：${error}`} onRetry={reload} /></div> : null}
        {!snapshot ? (error ? null : <LoadingRow label="正在读取进程…" />) : (
          <>
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              <StatCard icon={Layers} label="进程" value={String(snapshot.totals.count)} hint={`${snapshot.sessions.length} 个对话进程 · ${snapshot.cpuCount} 核 CPU`} />
              <StatCard
                icon={MemoryStick}
                label="内存合计"
                value={formatBytes(snapshot.totals.memoryBytes)}
                hint={`占系统 ${((snapshot.totals.memoryBytes / Math.max(1, snapshot.totalMemoryBytes)) * 100).toFixed(1)}% · 可用 ${formatBytes(snapshot.freeMemoryBytes)}`}
                trend={history.memory}
              />
              <StatCard icon={Cpu} label="CPU" value={formatCpu(snapshot.totals.cpuPercent)} hint="所有进程合计，按全部核心折算" trend={history.cpu} trendMax={5} />
              <StatCard
                icon={Clock}
                label="本地服务端"
                value={formatDuration(snapshot.server.uptimeSec * 1000)}
                hint={`PID ${snapshot.server.pid}${snapshot.server.port ? ` · 端口 ${snapshot.server.port}` : ''}${snapshot.server.bunVersion ? ` · Bun ${snapshot.server.bunVersion}` : ''}`}
              />
            </div>

            <Section icon={MessagesSquare} title="对话" count={`${snapshot.sessions.length} 个进程${activeChats ? ` · ${activeChats} 个在运行` : ''}`}>
              <SessionList sessions={snapshot.sessions} now={now} titleOf={titleOf} />
            </Section>

            <Section
              icon={Server}
              title="进程"
              count={`${rows.length} 个`}
              actions={minorCount > 0 ? (
                <SmallButton onClick={() => setShowMinor(value => !value)}>
                  {showMinor ? <EyeOff size={13} aria-hidden="true" /> : <Eye size={13} aria-hidden="true" />}
                  {showMinor ? '隐藏' : '显示'}控制台宿主（{minorCount}）
                </SmallButton>
              ) : null}
            >
              {snapshot.processError ? <div className="mb-2"><ErrorRow message={`进程表读取失败：${snapshot.processError}`} /></div> : null}
              {rows.length ? <ProcessTable rows={rows} now={now} titleOf={titleOf} /> : null}
            </Section>

            <Section
              icon={Plug}
              title={`${brand.name} 插件接口`}
              count={snapshot.plugins.checkedAt ? `检测于 ${formatClock(snapshot.plugins.checkedAt)}` : undefined}
              actions={(
                <SmallButton onClick={() => void recheckPlugins()} disabled={checkingPlugins}>
                  {checkingPlugins ? <CircleDashed size={13} className="animate-spin" aria-hidden="true" /> : <RefreshCw size={13} aria-hidden="true" />}重新检测
                </SmallButton>
              )}
            >
              <PluginList items={snapshot.plugins.items} signedIn={snapshot.plugins.signedIn} />
            </Section>

            <Section
              icon={Image}
              title="生成任务"
              count={snapshot.tasks.running ? `${snapshot.tasks.running} 个进行中` : '没有进行中的任务'}
              actions={(
                <SmallButton onClick={() => useTabStore.getState().openTab(STAR_STUDIO_TAB_ID, starStudioTabTitle(brand.name), 'star-studio')}>
                  打开任务中心<ExternalLink size={12} aria-hidden="true" />
                </SmallButton>
              )}
            >
              <TaskList tasks={snapshot.tasks.recent} now={now} />
            </Section>
          </>
        )}
      </div>
    </div>
  )
}

/** 运行时 as its own route: the merged 记忆图谱 · 运行时 page, opened on this view. */
export function RuntimePage() {
  return <MemoryRuntimePage initialView="runtime" />
}
