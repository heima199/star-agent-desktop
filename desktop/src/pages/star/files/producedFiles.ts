import { ApiError } from '@/api/client'
import { sessionsApi, type SessionTurnCheckpoint } from '@/api/sessions'
import { starApi, type StarMediaTask } from '@/api/star'
import { useSessionStore } from '@/stores/sessionStore'
import { useStarStore } from '@/stores/starStore'
import type { SessionListItem } from '@/types/session'

/**
 * 我的文件: what recent conversations produced. That is the images, videos,
 * web pages and documents their completed turns wrote (each session's turn
 * checkpoints list them) plus the STAR generation outputs saved on this
 * machine.
 *
 * Everything is read on the client from routes the local server already has.
 * A session's files only change when the session does, so they are kept per
 * session `modifiedAt` for the rest of the app session.
 */

export type ProducedFileKind = 'image' | 'video' | 'web' | 'document'
export type ProducedFileFilter = 'all' | ProducedFileKind

export type ProducedFile = {
  /** Normalized path: one entry per file, however its producers spelled it. */
  id: string
  /** Absolute local path. */
  path: string
  name: string
  kind: ProducedFileKind
  /** When it was produced (its turn's start, its task's creation), epoch ms. */
  time: number
  /** The conversation that produced it, when known. */
  sessionId?: string
  /** That conversation's list entry, when the app knows it. */
  session?: SessionListItem
  /** A STAR generation output, previewed through its task. */
  star?: { task: StarMediaTask; index: number }
}

/** How many of the most recently modified conversations are read. */
export const RECENT_SESSION_LIMIT = 30
/** Checkpoint reads in flight at once, across every caller. */
const CHECKPOINT_CONCURRENCY = 3
const CHECKPOINT_TIMEOUT_MS = 60_000
const STAR_TASK_LIMIT = 300
/** The + menu reuses a list this fresh instead of reading again on every opening. */
const RECENT_LIST_TTL_MS = 30_000

const KIND_BY_EXTENSION: Record<string, ProducedFileKind> = {
  png: 'image', jpg: 'image', jpeg: 'image', gif: 'image', webp: 'image', svg: 'image',
  mp4: 'video', mov: 'video', webm: 'video',
  html: 'web', htm: 'web',
  md: 'document', pdf: 'document', docx: 'document', doc: 'document', pptx: 'document', ppt: 'document',
  xlsx: 'document', xls: 'document', csv: 'document', txt: 'document',
}

/** Tool and dependency folders: what an agent writes there is bookkeeping (memory, plans), not a deliverable. */
const INTERNAL_SEGMENTS = new Set(['.git', '.claude', 'node_modules', '__pycache__', '.venv'])

/** One key per file: `/` separators, no `/` before a drive letter, Windows drive paths case-folded. */
export function fileIdentity(path: string): string {
  const unified = path.trim().replace(/\\/g, '/').replace(/^\/(?=[a-zA-Z]:\/)/, '').replace(/(?<!^)\/{2,}/g, '/')
  return /^[a-zA-Z]:\//.test(unified) ? unified.toLowerCase() : unified
}

export function fileName(path: string): string {
  return path.split(/[\\/]/).filter(Boolean).pop() ?? path
}

/** The folder holding `path`, keeping a root's separator (`C:\a.png` → `C:\`). */
export function parentDirectory(path: string): string {
  const index = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'))
  if (index < 0) return path
  const parent = path.slice(0, index)
  return !parent || /^[a-zA-Z]:$/.test(parent) ? path.slice(0, index + 1) : parent
}

export function producedFileKind(path: string): ProducedFileKind | null {
  const name = fileName(path)
  const dot = name.lastIndexOf('.')
  return dot > 0 ? KIND_BY_EXTENSION[name.slice(dot + 1).toLowerCase()] ?? null : null
}

function isAbsolute(path: string): boolean {
  return /^(?:[a-zA-Z]:[\\/]|[\\/])/.test(path)
}

/** Judged below the session's folder when the file is inside it, so a project under a dot folder still counts. */
function isInternalPath(path: string, workDir?: string | null): boolean {
  const file = fileIdentity(path)
  const root = workDir ? fileIdentity(workDir).replace(/\/+$/, '') : ''
  const inside = root && file.startsWith(`${root}/`) ? file.slice(root.length + 1) : file
  return inside.split('/').some(segment => INTERNAL_SEGMENTS.has(segment.toLowerCase()))
}

/** `/C:/x` (a URL-style Windows path) as the system opens it: `C:/x`. */
function withoutDriveSlash(path: string): string {
  return path.replace(/^[\\/](?=[a-zA-Z]:[\\/])/, '')
}

/** The deliverables a session's completed turns wrote, one entry per write. */
export function filesFromCheckpoints(session: SessionListItem, checkpoints: SessionTurnCheckpoint[]): ProducedFile[] {
  const fallbackTime = Date.parse(session.modifiedAt) || 0
  const files: ProducedFile[] = []
  for (const checkpoint of checkpoints) {
    const workDir = checkpoint.workDir || session.workDir
    const time = checkpoint.startedAt ?? fallbackTime
    for (const changed of checkpoint.code?.filesChanged ?? []) {
      if (!isAbsolute(changed) && !workDir) continue
      const path = withoutDriveSlash(isAbsolute(changed) ? changed : `${workDir!.replace(/[\\/]+$/, '')}/${changed}`)
      const kind = producedFileKind(path)
      if (!kind || isInternalPath(path, workDir)) continue
      files.push({ id: fileIdentity(path), path, name: fileName(path), kind, time, sessionId: session.id, session })
    }
  }
  return files
}

/** STAR outputs saved on this machine; one only kept online has no file to list. */
export function filesFromStarTasks(tasks: StarMediaTask[], sessions: ReadonlyMap<string, SessionListItem>): ProducedFile[] {
  return tasks.flatMap(task => task.outputs.flatMap((output, index): ProducedFile[] => {
    if (!output.file) return []
    const session = task.sessionId ? sessions.get(task.sessionId) : undefined
    const path = withoutDriveSlash(output.file)
    return [{
      id: fileIdentity(path),
      path,
      name: fileName(path),
      kind: producedFileKind(output.file) ?? output.kind,
      time: task.createdAt,
      ...(task.sessionId ? { sessionId: task.sessionId } : {}),
      ...(session ? { session } : {}),
      star: { task, index },
    }]
  }))
}

/**
 * One entry per file, newest first. A file written more than once keeps its
 * latest time and producer; one STAR made keeps the STAR preview.
 */
export function mergeProducedFiles(...lists: ProducedFile[][]): ProducedFile[] {
  const byId = new Map<string, ProducedFile>()
  for (const file of lists.flat()) {
    const seen = byId.get(file.id)
    if (!seen) {
      byId.set(file.id, file)
      continue
    }
    const [newer, older] = file.time > seen.time ? [file, seen] : [seen, file]
    const origin = newer.sessionId ? newer : older
    byId.set(file.id, { ...newer, sessionId: origin.sessionId, session: origin.session, star: newer.star ?? older.star })
  }
  return [...byId.values()].sort((a, b) => b.time - a.time)
}

/** Matches the file name or the title of the conversation that produced it. */
export function searchProducedFiles(files: ProducedFile[], query: string): ProducedFile[] {
  const needle = query.trim().toLocaleLowerCase()
  if (!needle) return files
  return files.filter(file => file.name.toLocaleLowerCase().includes(needle)
    || (file.session?.title ?? '').toLocaleLowerCase().includes(needle))
}

export function countProducedFiles(files: ProducedFile[]): Record<ProducedFileFilter, number> {
  const counts: Record<ProducedFileFilter, number> = { all: files.length, image: 0, video: 0, web: 0, document: 0 }
  for (const file of files) counts[file.kind] += 1
  return counts
}

let activeReads = 0
const waitingReads: Array<() => void> = []

function limited<T>(read: () => Promise<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const start = () => {
      activeReads += 1
      // `then(read)` turns a read that throws before returning into a rejection.
      void Promise.resolve().then(read).then(resolve, reject).finally(() => {
        activeReads -= 1
        waitingReads.shift()?.()
      })
    }
    if (activeReads < CHECKPOINT_CONCURRENCY) start()
    else waitingReads.push(start)
  })
}

const sessionFilesCache = new Map<string, { modifiedAt: string; files: Promise<ProducedFile[]> }>()

function sessionFiles(session: SessionListItem): Promise<ProducedFile[]> {
  const cached = sessionFilesCache.get(session.id)
  if (cached && cached.modifiedAt === session.modifiedAt) return cached.files
  const entry = { modifiedAt: session.modifiedAt, files: Promise.resolve<ProducedFile[]>([]) }
  entry.files = limited(() => sessionsApi.getTurnCheckpoints(session.id, { timeout: CHECKPOINT_TIMEOUT_MS }))
    .then(response => filesFromCheckpoints(session, response.checkpoints ?? []))
    .catch((error: unknown) => {
      // A session too large to read (413) stays skipped until it changes; any
      // other failure is read again next time.
      const tooLarge = error instanceof ApiError && error.status === 413
      if (!tooLarge && sessionFilesCache.get(session.id) === entry) sessionFilesCache.delete(session.id)
      return []
    })
  sessionFilesCache.set(session.id, entry)
  return entry.files
}

function modifiedTime(session: SessionListItem): number {
  return Date.parse(session.modifiedAt) || 0
}

async function recentSessions(askServer: boolean): Promise<SessionListItem[]> {
  const known = useSessionStore.getState().sessions
  let listed: SessionListItem[] = []
  if (askServer) {
    try {
      listed = (await sessionsApi.list({ limit: RECENT_SESSION_LIMIT })).sessions ?? []
    } catch (error) {
      // The sidebar's list still names the recent conversations.
      if (!known.length) throw error
    }
  }
  const byId = new Map<string, SessionListItem>()
  for (const session of [...known, ...listed]) {
    const seen = byId.get(session.id)
    if (!seen || modifiedTime(session) >= modifiedTime(seen)) byId.set(session.id, session)
  }
  return [...byId.values()].sort((a, b) => modifiedTime(b) - modifiedTime(a)).slice(0, RECENT_SESSION_LIMIT)
}

async function starTasks(askServer: boolean): Promise<StarMediaTask[]> {
  const known = useStarStore.getState().tasks
  if (!askServer) return known
  try {
    return (await starApi.tasks(STAR_TASK_LIMIT)).tasks ?? known
  } catch {
    return known
  }
}

let recentList: { at: number; files: Promise<ProducedFile[]>; settled?: ProducedFile[] } | null = null

function remember(files: ProducedFile[]): ProducedFile[] {
  recentList = { at: Date.now(), files: Promise.resolve(files), settled: files }
  return files
}

/**
 * Reads the produced files of the 30 most recently modified conversations
 * and the STAR outputs, newest first. By default it starts from what the app
 * already holds (the sidebar's sessions, the polled STAR tasks); the page
 * also asks the server for both. Rejects only when no conversation is known.
 */
export async function loadProducedFiles(options: { askServer?: boolean } = {}): Promise<ProducedFile[]> {
  const askServer = options.askServer === true
  const [sessions, tasks] = await Promise.all([recentSessions(askServer), starTasks(askServer)])
  const sessionsById = new Map(useSessionStore.getState().sessions.map(session => [session.id, session]))
  for (const session of sessions) sessionsById.set(session.id, session)
  const turnFiles = await Promise.all(sessions.map(sessionFiles))
  const files = mergeProducedFiles(...turnFiles, filesFromStarTasks(tasks, sessionsById))
    // Cached files keep the session entry they were read with; show today's title.
    .map(file => (file.sessionId && sessionsById.has(file.sessionId) ? { ...file, session: sessionsById.get(file.sessionId) } : file))
  return remember(files)
}

/** The + menu's list: the last one read while it is fresh, a new read otherwise. Never rejects. */
export function loadRecentProducedFiles(): Promise<ProducedFile[]> {
  const now = Date.now()
  if (recentList && now - recentList.at < RECENT_LIST_TTL_MS) return recentList.files
  const stale = recentList?.settled
  const files = loadProducedFiles().catch(() => stale ?? [])
  recentList = { at: now, files, settled: stale }
  return files
}

/** What the last read settled on, for a menu that opens before its own read is done. */
export function peekRecentProducedFiles(): ProducedFile[] | null {
  return recentList?.settled ?? null
}

/** Tests only: forget every list and session read so far. */
export function resetProducedFilesCache(): void {
  recentList = null
  sessionFilesCache.clear()
}
