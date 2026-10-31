import type { SessionListItem } from './session'

export type MemoryProject = {
  id: string
  label: string
  memoryDir: string
  exists: boolean
  fileCount: number
  isCurrent: boolean
}
export type MemoryFile = {
  path: string
  name: string
  bytes: number
  updatedAt: string
  type?: string
  description?: string
  title: string
  isIndex: boolean
}
export type MemoryFileDetail = {
  path: string
  content: string
  updatedAt: string
  bytes: number
}

/** GET /api/memory/graph — mirrors src/server/services/memoryGraph.ts. */
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
  workspaceState?: SessionListItem['workspaceState']
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
export type MemoryGraphData = {
  generatedAt: string
  userMemory: { exists: boolean; bytes: number; updatedAt: string | null }
  clusters: MemoryGraphCluster[]
}
