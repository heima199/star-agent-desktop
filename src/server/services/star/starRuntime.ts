/**
 * Data for the desktop 运行时 page: the app's process tree (Electron, this
 * server, IM adapters, every chat CLI and what those started), live chats,
 * the STAR plugin endpoints and media generation tasks.
 *
 * Command lines are read only to tell processes apart and never leave this
 * module: they can carry local tokens or MCP credentials.
 */
import * as os from 'node:os'
import * as path from 'node:path'
import { conversationService } from '../conversationService.js'
import { listStarPluginSpecs } from '../../../plugins/bundled/star.js'
import { PluginService } from '../pluginService.js'
import { handleStarMcpRequest } from './starMcp.js'
import { STAR_TOOL_GROUPS, type StarToolGroup } from './starMcpTools.js'
import { listStarMediaTasks, runningStarTaskCount } from './starMediaService.js'
import { readStarSession } from './starSession.js'

export type StarRuntimeRole =
  | 'launcher'
  | 'main'
  | 'renderer'
  | 'gpu'
  | 'network'
  | 'utility'
  | 'server'
  | 'adapter'
  | 'session'
  | 'tool'
  | 'other'

export type StarRuntimeProcess = {
  pid: number
  ppid: number
  /** 0 = tree root (Electron main, or this server when run alone); -1 = the dev launcher above it. */
  depth: number
  name: string
  role: StarRuntimeRole
  label: string
  detail?: string
  memoryBytes: number
  privateBytes: number | null
  cpuPercent: number | null
  startedAt: number | null
  sessionId?: string
  /** Console hosts and similar helpers the page folds away by default. */
  minor?: boolean
}

export type StarRuntimeSession = {
  sessionId: string
  pid: number
  workDir: string
  permissionMode: string
  providerId: string | null
  modelId: string | null
  effortLevel: string | null
  state: string
  isTeamWorker: boolean
  startupPending: boolean
  pendingPermissions: number
  memoryBytes: number | null
  cpuPercent: number | null
  startedAt: number | null
  childCount: number
}

export type StarRuntimePlugin = {
  group: StarToolGroup
  name: string
  description: string
  enabled: boolean | null
  ok: boolean
  status: number | null
  tools: number
  latencyMs: number | null
  error?: string
}

export type StarRuntimeTask = {
  id: string
  kind: string
  mode: string
  model: string
  status: string
  progress: number
  message: string
  source: string
  sessionId?: string
  createdAt: number
  updatedAt: number
  finishedAt?: number
}

export type StarRuntimeSnapshot = {
  at: number
  platform: NodeJS.Platform
  cpuCount: number
  totalMemoryBytes: number
  freeMemoryBytes: number
  server: {
    pid: number
    port: number | null
    startedAt: number
    uptimeSec: number
    bunVersion: string | null
    rssBytes: number
    heapUsedBytes: number
  }
  processes: StarRuntimeProcess[]
  processError: string | null
  totals: { count: number; memoryBytes: number; cpuPercent: number | null }
  sessions: StarRuntimeSession[]
  plugins: { signedIn: boolean; checkedAt: number | null; items: StarRuntimePlugin[] }
  tasks: { running: number; recent: StarRuntimeTask[] }
}

/** One row from the OS process table, command line included (internal only). */
type RawProcess = {
  pid: number
  ppid: number
  depth: number
  name: string
  workingSet: number
  privateBytes: number | null
  startedAt: number | null
  cpuMs: number | null
  command: string
}

const ADAPTER_NAMES: Record<string, string> = {
  feishu: '飞书',
  telegram: 'Telegram',
  wechat: '微信',
  dingtalk: '钉钉',
  whatsapp: 'WhatsApp',
  wecom: '企业微信',
  qq: 'QQ',
  slack: 'Slack',
}

const TOOL_LABELS: [RegExp, string][] = [
  [/^(node|bun|deno)(\.exe)?$/i, 'Node / 脚本'],
  [/^(npx|npm|pnpm|yarn)(\.cmd|\.exe)?$/i, '包管理器'],
  [/^(uv|uvx)(\.exe)?$/i, 'uv'],
  [/^python[\d.]*(w)?(\.exe)?$/i, 'Python'],
  [/^(bash|sh|zsh|fish|pwsh|powershell|cmd)(\.exe)?$/i, '命令行'],
  [/^rg(\.exe)?$/i, '代码搜索（ripgrep）'],
  [/^git(\.exe)?$/i, 'Git'],
  [/^conhost\.exe$/i, '控制台宿主'],
]

const MINOR_PROCESS = /^(conhost|OpenConsole)\.exe$/i
const PROCESS_TIMEOUT_MS = 8_000
const SNAPSHOT_TTL_MS = 1_500
const PLUGIN_TTL_MS = 20_000

function toolLabel(name: string): string {
  for (const [pattern, label] of TOOL_LABELS) if (pattern.test(name)) return label
  return name.replace(/\.exe$/i, '')
}

function localServerPort(): number | null {
  const raw = process.env.CC_HAHA_STAR_LOCAL_SERVER_URL
  if (!raw) return null
  try {
    const port = Number(new URL(raw).port)
    return Number.isFinite(port) && port > 0 ? port : null
  } catch {
    return null
  }
}

// ─── OS process table ────────────────────────────────────────────────

/**
 * Walks the tree under `root` in PowerShell so only the app's processes cross
 * the pipe. A child created before its parent is a reused parent PID, not a
 * real child, and is skipped. The root's own parent is emitted at depth -1.
 */
function windowsTreeScript(root: number): string {
  return `
$ErrorActionPreference = 'SilentlyContinue'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$root = ${Math.trunc(root)}
$all = Get-CimInstance -ClassName Win32_Process -Property ProcessId,ParentProcessId,Name,WorkingSetSize,PrivatePageCount,CreationDate,KernelModeTime,UserModeTime,CommandLine
$byId = @{}
$kids = @{}
foreach ($p in $all) {
  $byId[[int]$p.ProcessId] = $p
  $pp = [int]$p.ParentProcessId
  if (-not $kids.ContainsKey($pp)) { $kids[$pp] = New-Object System.Collections.ArrayList }
  [void]$kids[$pp].Add($p)
}
function Emit($p, $depth) {
  $created = ''
  if ($p.CreationDate) { $created = [DateTimeOffset]::new($p.CreationDate).ToUnixTimeMilliseconds() }
  $cpu = [math]::Round(([double]$p.KernelModeTime + [double]$p.UserModeTime) / 10000)
  $cmd = ([string]$p.CommandLine) -replace '[\\t\\r\\n]', ' '
  if ($cmd.Length -gt 800) { $cmd = $cmd.Substring(0, 800) }
  [Console]::Out.WriteLine(("{0}\`t{1}\`t{2}\`t{3}\`t{4}\`t{5}\`t{6}\`t{7}\`t{8}" -f $p.ProcessId, $p.ParentProcessId, $depth, $p.Name, $p.WorkingSetSize, $p.PrivatePageCount, $created, $cpu, $cmd))
}
$seen = @{}
function Walk($id, $depth) {
  # Skip this probe itself (and its console host): it is not part of the app.
  if ($id -eq $PID -or $seen.ContainsKey($id) -or $depth -gt 16) { return }
  $seen[$id] = $true
  $p = $byId[$id]
  if (-not $p) { return }
  Emit $p $depth
  if ($kids.ContainsKey($id)) {
    foreach ($c in $kids[$id]) {
      if ($c.CreationDate -and $p.CreationDate -and $c.CreationDate -lt $p.CreationDate) { continue }
      Walk ([int]$c.ProcessId) ($depth + 1)
    }
  }
}
$top = $byId[$root]
if ($top) {
  $parent = $byId[[int]$top.ParentProcessId]
  if ($parent) { Emit $parent (-1) }
}
Walk $root 0
`
}

async function readCommand(cmd: string[], timeoutMs: number): Promise<string> {
  const proc = Bun.spawn(cmd, { stdin: 'ignore', stdout: 'pipe', stderr: 'ignore', windowsHide: true })
  const timer = setTimeout(() => proc.kill(), timeoutMs)
  try {
    const text = await new Response(proc.stdout).text()
    await proc.exited
    return text
  } finally {
    clearTimeout(timer)
  }
}

async function readWindowsTree(root: number): Promise<RawProcess[]> {
  const encoded = Buffer.from(windowsTreeScript(root), 'utf16le').toString('base64')
  const text = await readCommand(
    ['powershell.exe', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encoded],
    PROCESS_TIMEOUT_MS,
  )
  const rows: RawProcess[] = []
  for (const line of text.split(/\r?\n/)) {
    const parts = line.split('\t')
    if (parts.length < 9) continue
    const pid = Number(parts[0])
    if (!Number.isFinite(pid) || pid <= 0) continue
    rows.push({
      pid,
      ppid: Number(parts[1]) || 0,
      depth: Number(parts[2]) || 0,
      name: parts[3] || 'unknown',
      workingSet: Number(parts[4]) || 0,
      // Win32_Process reports PrivatePageCount in bytes despite its name.
      privateBytes: parts[5] ? Number(parts[5]) || null : null,
      startedAt: parts[6] ? Number(parts[6]) || null : null,
      cpuMs: parts[7] ? Number(parts[7]) : null,
      command: parts.slice(8).join('\t'),
    })
  }
  return rows
}

/** `[[dd-]hh:]mm:ss` (ps etime/time) to seconds. */
function parseClock(value: string): number | null {
  const match = /^(?:(\d+)-)?(?:(\d+):)?(\d+):(\d+(?:\.\d+)?)$/.exec(value.trim())
  if (!match) return null
  const [, days, hours, minutes, seconds] = match
  return Number(days ?? 0) * 86_400 + Number(hours ?? 0) * 3_600 + Number(minutes) * 60 + Number(seconds)
}

async function readPosixTree(root: number): Promise<RawProcess[]> {
  const text = await readCommand(['ps', '-A', '-o', 'pid=,ppid=,rss=,time=,etime=,command='], PROCESS_TIMEOUT_MS)
  const now = Date.now()
  const all = new Map<number, Omit<RawProcess, 'depth'>>()
  const kids = new Map<number, number[]>()
  for (const line of text.split('\n')) {
    const match = /^\s*(\d+)\s+(\d+)\s+(\d+)\s+(\S+)\s+(\S+)\s+(.*)$/.exec(line)
    if (!match) continue
    const pid = Number(match[1])
    const ppid = Number(match[2])
    const command = match[6] ?? ''
    const cpu = parseClock(match[4] ?? '')
    const elapsed = parseClock(match[5] ?? '')
    all.set(pid, {
      pid,
      ppid,
      name: path.basename(command.split(/\s+--?/)[0]?.trim() || command),
      workingSet: Number(match[3]) * 1024,
      privateBytes: null,
      startedAt: elapsed === null ? null : now - elapsed * 1000,
      cpuMs: cpu === null ? null : cpu * 1000,
      command,
    })
    kids.set(ppid, [...(kids.get(ppid) ?? []), pid])
  }
  const rows: RawProcess[] = []
  const top = all.get(root)
  const parent = top ? all.get(top.ppid) : undefined
  if (parent) rows.push({ ...parent, depth: -1 })
  const seen = new Set<number>()
  const walk = (pid: number, depth: number) => {
    const row = all.get(pid)
    if (!row || seen.has(pid) || depth > 16) return
    seen.add(pid)
    rows.push({ ...row, depth })
    for (const child of kids.get(pid) ?? []) {
      const childRow = all.get(child)
      if (childRow?.startedAt && row.startedAt && childRow.startedAt < row.startedAt - 1000) continue
      walk(child, depth + 1)
    }
  }
  walk(root, 0)
  return rows
}

// ─── Classification ──────────────────────────────────────────────────

type RuntimeSessionInfo = ReturnType<typeof conversationService.getRuntimeSessions>[number]

function isElectronLike(row: RawProcess | undefined): boolean {
  if (!row) return false
  return /electron|star|claude.?code.?haha/i.test(row.name) || /--type=|electron-dist|app\.asar/i.test(row.command)
}

function isDevLauncher(row: RawProcess): boolean {
  return /^(bun|node)(\.exe)?$/i.test(row.name) && /electron-dev/i.test(row.command)
}

function classify(
  row: RawProcess,
  sessionsByPid: Map<number, RuntimeSessionInfo>,
  sessionOf: (row: RawProcess) => string | undefined,
  port: number | null,
): Pick<StarRuntimeProcess, 'role' | 'label' | 'detail' | 'sessionId' | 'minor'> {
  if (row.pid === process.pid) return { role: 'server', label: '本地服务端', detail: port ? `端口 ${port}` : undefined }
  const session = sessionsByPid.get(row.pid)
  if (session) return { role: 'session', label: session.isTeamWorker ? '团队成员进程' : '对话进程', sessionId: session.sessionId }
  if (row.depth === -1) return { role: 'launcher', label: '开发启动器', detail: '含 Vite 热更新' }
  const type = /--type=([\w-]+)/.exec(row.command)?.[1]
  if (type === 'renderer') return { role: 'renderer', label: '渲染进程', detail: '界面' }
  if (type === 'gpu-process') return { role: 'gpu', label: 'GPU 进程' }
  if (type === 'utility') {
    const sub = /--utility-sub-type=([\w.]+)/.exec(row.command)?.[1] ?? ''
    if (/network/i.test(sub)) return { role: 'network', label: '网络服务' }
    if (/audio/i.test(sub)) return { role: 'utility', label: '音频服务' }
    if (/storage/i.test(sub)) return { role: 'utility', label: '存储服务' }
    return { role: 'utility', label: '辅助进程', detail: sub.split('.').at(-1) || undefined }
  }
  if (type === 'crashpad-handler') return { role: 'utility', label: '崩溃收集', minor: true }
  if (type) return { role: 'utility', label: '辅助进程', detail: type }
  if (/\badapters\b/.test(row.command) && /--app-root/.test(row.command)) {
    const flag = /--(feishu|telegram|wechat|dingtalk|whatsapp|wecom|qq|slack)\b/.exec(row.command)?.[1]
    return { role: 'adapter', label: 'IM 接入', detail: flag ? ADAPTER_NAMES[flag] : undefined }
  }
  if (row.depth === 0 && isElectronLike(row)) return { role: 'main', label: '主进程', detail: 'Electron' }
  const owner = sessionOf(row)
  const minor = MINOR_PROCESS.test(row.name)
  if (owner) return { role: 'tool', label: toolLabel(row.name), sessionId: owner, ...(minor ? { minor } : {}) }
  return { role: 'other', label: toolLabel(row.name), ...(minor ? { minor } : {}) }
}

/** CPU time per process between two snapshots, normalized to all cores (like Task Manager). */
const cpuSamples = new Map<string, { cpuMs: number; at: number }>()

function cpuPercent(row: RawProcess, now: number, cores: number): number | null {
  if (row.cpuMs === null) return null
  const key = `${row.pid}:${row.startedAt ?? 0}`
  const previous = cpuSamples.get(key)
  cpuSamples.set(key, { cpuMs: row.cpuMs, at: now })
  if (!previous || now <= previous.at) return null
  const value = ((row.cpuMs - previous.cpuMs) / (now - previous.at) / Math.max(1, cores)) * 100
  return Math.max(0, Math.round(value * 10) / 10)
}

function pruneCpuSamples(now: number): void {
  for (const [key, sample] of cpuSamples) if (now - sample.at > 60_000) cpuSamples.delete(key)
}

// ─── STAR plugins ────────────────────────────────────────────────────

let pluginCache: { at: number; items: StarRuntimePlugin[] } | null = null
let pluginInFlight: Promise<{ at: number; items: StarRuntimePlugin[] }> | null = null

async function checkPluginEndpoint(group: StarToolGroup): Promise<Pick<StarRuntimePlugin, 'ok' | 'status' | 'tools' | 'latencyMs' | 'error'>> {
  const started = Date.now()
  try {
    const request = new Request(`http://127.0.0.1/api/star/mcp/${group}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} }),
    })
    const response = await handleStarMcpRequest(request, group)
    const text = await Promise.race([
      response.text(),
      new Promise<string>((_, reject) => setTimeout(() => reject(new Error('超时')), 10_000)),
    ])
    const tools = new Set([...text.matchAll(/"name":"(star_[a-z0-9_]+)"/g)].map(match => match[1])).size
    return { ok: response.status === 200 && tools > 0, status: response.status, tools, latencyMs: Date.now() - started }
  } catch (error) {
    return { ok: false, status: null, tools: 0, latencyMs: Date.now() - started, error: error instanceof Error ? error.message : String(error) }
  }
}

async function loadPluginStates(): Promise<Map<string, boolean>> {
  const states = new Map<string, boolean>()
  try {
    const list = await new PluginService().listPlugins()
    for (const plugin of list.plugins ?? []) if (plugin.isBuiltin) states.set(plugin.name, plugin.enabled)
  } catch {
    // Unknown enablement shows as "--" on the page.
  }
  return states
}

async function readPlugins(force: boolean): Promise<{ at: number; items: StarRuntimePlugin[] }> {
  if (!force && pluginCache && Date.now() - pluginCache.at < PLUGIN_TTL_MS) return pluginCache
  if (pluginInFlight) return pluginInFlight
  pluginInFlight = (async () => {
    const specs = new Map(listStarPluginSpecs().map(spec => [spec.group, spec]))
    const [states, checks] = await Promise.all([
      loadPluginStates(),
      Promise.all(STAR_TOOL_GROUPS.map(group => checkPluginEndpoint(group))),
    ])
    const items = STAR_TOOL_GROUPS.map((group, index) => {
      const spec = specs.get(group)
      const name = spec?.name ?? `star-${group}`
      return { group, name, description: spec?.description ?? '', enabled: states.get(name) ?? null, ...checks[index]! }
    })
    pluginCache = { at: Date.now(), items }
    return pluginCache
  })().finally(() => { pluginInFlight = null })
  return pluginInFlight
}

// ─── Snapshot ────────────────────────────────────────────────────────

async function chatStates(ids: string[]): Promise<Map<string, string>> {
  const states = new Map<string, string>()
  if (ids.length === 0) return states
  try {
    // Loaded lazily: the WebSocket handler imports most of the server.
    const { getSessionChatActivityState } = await import('../../ws/handler.js')
    for (const id of ids) states.set(id, getSessionChatActivityState(id))
  } catch {
    // The page shows the process without a chat state.
  }
  return states
}

/**
 * Keeps the Electron tree (plus the dev launcher above it), or only this
 * server's subtree when it runs on its own. Rows arrive in depth-first order.
 */
function rootedRows(raw: RawProcess[]): RawProcess[] {
  const top = raw.find(row => row.depth === 0)
  if (top && isElectronLike(top)) return raw.filter(row => row.depth >= 0 || isDevLauncher(row))
  const self = raw.find(row => row.pid === process.pid)
  if (!self) return raw.filter(row => row.depth >= 0)
  const keep = new Set<number>([self.pid])
  const out: RawProcess[] = []
  for (const row of raw) {
    if (row.pid === self.pid) {
      out.push({ ...row, depth: 0 })
    } else if (row.depth > self.depth && keep.has(row.ppid)) {
      keep.add(row.pid)
      out.push({ ...row, depth: row.depth - self.depth })
    }
  }
  return out
}

async function readProcesses(root: number): Promise<{ rows: RawProcess[]; error: string | null }> {
  try {
    const rows = process.platform === 'win32' ? await readWindowsTree(root) : await readPosixTree(root)
    return rows.length > 0 ? { rows, error: null } : { rows, error: '没有读到进程信息' }
  } catch (error) {
    return { rows: [], error: error instanceof Error ? error.message : String(error) }
  }
}

function taskRow(task: ReturnType<typeof listStarMediaTasks>[number]): StarRuntimeTask {
  return {
    id: task.id,
    kind: task.kind,
    mode: task.mode,
    model: task.model,
    status: task.status,
    progress: task.progress,
    message: task.message,
    source: task.source,
    ...(task.sessionId ? { sessionId: task.sessionId } : {}),
    createdAt: task.createdAt,
    updatedAt: task.updatedAt,
    ...(task.finishedAt ? { finishedAt: task.finishedAt } : {}),
  }
}

async function buildSnapshot(refreshPlugins: boolean): Promise<StarRuntimeSnapshot> {
  const now = Date.now()
  const cores = os.cpus().length || 1
  const port = localServerPort()
  const runtimeSessions = conversationService.getRuntimeSessions()
  const sessionsByPid = new Map(runtimeSessions.filter(item => item.pid > 0).map(item => [item.pid, item]))

  // Under the desktop app the tree starts at Electron main, this server's parent.
  const { rows: raw, error } = await readProcesses(process.ppid > 0 ? process.ppid : process.pid)
  const rows = rootedRows(raw)

  const byPid = new Map(rows.map(row => [row.pid, row]))
  const ownerCache = new Map<number, string | undefined>()
  const sessionOf = (row: RawProcess): string | undefined => {
    if (ownerCache.has(row.pid)) return ownerCache.get(row.pid)
    let owner: string | undefined
    let cursor: RawProcess | undefined = byPid.get(row.ppid)
    for (let hops = 0; cursor && hops < 16; hops++) {
      const session = sessionsByPid.get(cursor.pid)
      if (session) {
        owner = session.sessionId
        break
      }
      cursor = byPid.get(cursor.ppid)
    }
    ownerCache.set(row.pid, owner)
    return owner
  }

  const processes: StarRuntimeProcess[] = rows.map(row => ({
    pid: row.pid,
    ppid: row.ppid,
    depth: row.depth,
    name: row.name,
    memoryBytes: row.workingSet,
    privateBytes: row.privateBytes,
    cpuPercent: cpuPercent(row, now, cores),
    startedAt: row.startedAt,
    ...classify(row, sessionsByPid, sessionOf, port),
  }))
  pruneCpuSamples(now)

  const counted = processes.filter(row => row.role !== 'launcher' || row.depth >= 0)
  const cpuValues = counted.map(row => row.cpuPercent).filter((value): value is number => value !== null)
  const states = await chatStates(runtimeSessions.map(item => item.sessionId))
  const sessions: StarRuntimeSession[] = runtimeSessions.map(item => {
    const row = processes.find(entry => entry.pid === item.pid)
    return {
      sessionId: item.sessionId,
      pid: item.pid,
      workDir: item.workDir,
      permissionMode: item.permissionMode,
      providerId: item.providerId,
      modelId: item.modelId,
      effortLevel: item.effortLevel,
      state: item.exitCode !== null ? 'exited' : item.startupPending ? 'starting' : states.get(item.sessionId) ?? 'idle',
      isTeamWorker: item.isTeamWorker,
      startupPending: item.startupPending,
      pendingPermissions: item.pendingPermissions,
      memoryBytes: row?.memoryBytes ?? null,
      cpuPercent: row?.cpuPercent ?? null,
      startedAt: row?.startedAt ?? null,
      childCount: processes.filter(entry => entry.role === 'tool' && entry.sessionId === item.sessionId && !entry.minor).length,
    }
  })

  const plugins = await readPlugins(refreshPlugins).catch(() => null)
  const memory = process.memoryUsage()
  return {
    at: now,
    platform: process.platform,
    cpuCount: cores,
    totalMemoryBytes: os.totalmem(),
    freeMemoryBytes: os.freemem(),
    server: {
      pid: process.pid,
      port,
      startedAt: Math.round(now - process.uptime() * 1000),
      uptimeSec: Math.round(process.uptime()),
      bunVersion: process.versions.bun ?? null,
      rssBytes: memory.rss,
      heapUsedBytes: memory.heapUsed,
    },
    processes,
    processError: error,
    totals: {
      count: counted.length,
      memoryBytes: counted.reduce((sum, row) => sum + row.memoryBytes, 0),
      cpuPercent: cpuValues.length ? Math.round(cpuValues.reduce((sum, value) => sum + value, 0) * 10) / 10 : null,
    },
    sessions,
    plugins: { signedIn: Boolean(readStarSession()), checkedAt: plugins?.at ?? null, items: plugins?.items ?? [] },
    tasks: { running: runningStarTaskCount(), recent: listStarMediaTasks(12).map(taskRow) },
  }
}

let snapshotCache: StarRuntimeSnapshot | null = null
let snapshotInFlight: Promise<StarRuntimeSnapshot> | null = null

/** Coalesces polls from several windows; `refreshPlugins` re-runs the endpoint checks now. */
export async function getStarRuntimeSnapshot(options: { refreshPlugins?: boolean } = {}): Promise<StarRuntimeSnapshot> {
  if (!options.refreshPlugins && snapshotCache && Date.now() - snapshotCache.at < SNAPSHOT_TTL_MS) return snapshotCache
  if (snapshotInFlight && !options.refreshPlugins) return snapshotInFlight
  const run = buildSnapshot(options.refreshPlugins === true)
    .then(snapshot => {
      snapshotCache = snapshot
      return snapshot
    })
    .finally(() => {
      if (snapshotInFlight === run) snapshotInFlight = null
    })
  snapshotInFlight = run
  return run
}
