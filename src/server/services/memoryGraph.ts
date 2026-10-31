/**
 * Pure pieces of the memory graph the desktop 记忆图谱 page draws.
 *
 * Per project the graph has three layers, after DeepTutor's L1/L2/L3 model:
 *   L3 — the project's MEMORY.md index (and, at the centre, the user CLAUDE.md)
 *   L2 — the memory files themselves
 *   L1 — the conversations those files were written in
 *
 * api/memory.ts gathers the files and sessions; this module only parses and
 * links them, so it can be reasoned about without a filesystem.
 */

/** A session-list item's display and routing fields, enough for the client to reopen it. */
export type MemoryGraphSession = {
  id: string
  title: string
  createdAt: string
  modifiedAt: string
  messageCount: number
  projectPath: string
  projectRoot: string | null
  workDir: string | null
  workDirExists: boolean
  workspaceState?: string
}

export type MemoryGraphMemory = {
  path: string
  title: string
  type?: string
  description?: string
  updatedAt: string
  bytes: number
  /** Linked from the project's MEMORY.md index. */
  indexed: boolean
  /** The conversation that was running when the file last changed. */
  sessionId: string | null
}

export type MemoryGraphCluster = {
  /** Directory name under ~/.claude/projects; also the memory API projectId. */
  id: string
  label: string
  isCurrent: boolean
  memoryDir: string
  index: { exists: boolean; updatedAt: string | null; links: number }
  memories: MemoryGraphMemory[]
  memoryTotal: number
  sessions: MemoryGraphSession[]
  sessionTotal: number
}

export type MemoryGraph = {
  generatedAt: string
  userMemory: { exists: boolean; bytes: number; updatedAt: string | null }
  clusters: MemoryGraphCluster[]
}

export const MEMORY_GRAPH_LIMITS = {
  clusters: 10,
  memoriesPerCluster: 160,
  sessionsPerCluster: 30,
} as const

/** Session ids are kept even when a memory points at one outside the recent window. */
const SESSION_WINDOW_BEFORE_MS = 60_000
const SESSION_WINDOW_AFTER_MS = 5 * 60_000

/** Relative `.md` targets of the markdown links in a MEMORY.md index. */
export function parseMemoryIndexLinks(markdown: string): Set<string> {
  const links = new Set<string>()
  for (const match of markdown.matchAll(/\]\(\s*<?([^)\s>]+?\.md)>?(?:\s+"[^"]*")?\s*\)/g)) {
    let target = match[1]!
    try {
      target = decodeURIComponent(target)
    } catch {
      // Keep the link as written.
    }
    target = target.replace(/\\/g, '/').replace(/^\.\//, '')
    if (/^[a-z][a-z0-9+.-]*:/i.test(target) || target.startsWith('/') || target.split('/').includes('..')) continue
    links.add(target)
  }
  return links
}

/**
 * The conversation a memory was written in, by time: the narrowest session
 * whose active window contains the file's last change. Memory files carry no
 * session id, and reading every transcript for the Write call would cost far
 * more than this page is worth.
 */
export function matchMemorySession(updatedAt: string, sessions: readonly MemoryGraphSession[]): string | null {
  const at = Date.parse(updatedAt)
  if (!Number.isFinite(at)) return null
  let best: { id: string; span: number } | null = null
  for (const session of sessions) {
    const start = Date.parse(session.createdAt) - SESSION_WINDOW_BEFORE_MS
    const end = Date.parse(session.modifiedAt) + SESSION_WINDOW_AFTER_MS
    if (!Number.isFinite(start) || !Number.isFinite(end) || at < start || at > end) continue
    const span = end - start
    if (!best || span < best.span) best = { id: session.id, span }
  }
  return best?.id ?? null
}

/**
 * Trims one project's sessions to the recent window while keeping every
 * session a memory is linked to, newest first.
 */
export function selectClusterSessions(
  sessions: readonly MemoryGraphSession[],
  linkedIds: ReadonlySet<string>,
  limit: number = MEMORY_GRAPH_LIMITS.sessionsPerCluster,
): MemoryGraphSession[] {
  const sorted = [...sessions].sort((a, b) => Date.parse(b.modifiedAt) - Date.parse(a.modifiedAt))
  const picked = sorted.slice(0, limit)
  const pickedIds = new Set(picked.map((session) => session.id))
  for (const session of sorted) {
    if (linkedIds.has(session.id) && !pickedIds.has(session.id)) {
      picked.push(session)
      pickedIds.add(session.id)
    }
  }
  return picked
}

/** Current project first, then the ones with the most memories, then the most recent activity. */
export function compareClusters(a: MemoryGraphCluster, b: MemoryGraphCluster): number {
  if (a.isCurrent !== b.isCurrent) return a.isCurrent ? -1 : 1
  if (a.memoryTotal !== b.memoryTotal) return b.memoryTotal - a.memoryTotal
  return latestActivity(b) - latestActivity(a) || a.label.localeCompare(b.label)
}

function latestActivity(cluster: MemoryGraphCluster): number {
  let latest = 0
  for (const memory of cluster.memories) latest = Math.max(latest, Date.parse(memory.updatedAt) || 0)
  for (const session of cluster.sessions) latest = Math.max(latest, Date.parse(session.modifiedAt) || 0)
  return latest
}
