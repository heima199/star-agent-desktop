/**
 * Media task records, one JSON file per task under `<config>/cc-haha/star/tasks`.
 *
 * One file per task keeps writers from different processes (the desktop
 * server and a CLI-only MCP server) from overwriting each other; the desktop
 * lists the directory to show progress and the library.
 */

import * as fs from 'node:fs'
import * as path from 'node:path'
import { randomBytes } from 'node:crypto'

import { starConfigDir, writePrivateJson } from './starConfig.js'

export type StarMediaKind = 'image' | 'video'

export type StarMediaMode =
  | 'text2image'
  | 'image2image'
  | 'multi2image'
  | 'text2video'
  | 'image2video'
  | 'frames2video'
  | 'ref2video'
  | 'video2video'

export type StarMediaStatus = 'queued' | 'uploading' | 'submitting' | 'running' | 'downloading' | 'succeeded' | 'failed'

export type StarMediaOutput = {
  kind: StarMediaKind
  url: string
  file?: string
  name: string
}

export type StarMediaTask = {
  id: string
  kind: StarMediaKind
  mode: StarMediaMode
  model: string
  prompt: string
  params: Record<string, string | number>
  references: { images: string[]; videos: string[] }
  status: StarMediaStatus
  progress: number
  message: string
  remoteIds: string[]
  outputs: StarMediaOutput[]
  error?: string
  source: 'desktop' | 'agent'
  sessionId?: string
  saveDir?: string
  estimatedCredits?: number
  createdAt: number
  updatedAt: number
  finishedAt?: number
}

export function starTasksDir(): string {
  return path.join(starConfigDir(), 'tasks')
}

export function starOutputsDir(): string {
  return path.join(starConfigDir(), 'outputs')
}

export function newStarTaskId(): string {
  return `m${Date.now().toString(36)}${randomBytes(3).toString('hex')}`
}

const ID_RE = /^[a-z0-9]{6,40}$/

function taskPath(id: string): string {
  if (!ID_RE.test(id)) throw new Error('Invalid media task id')
  return path.join(starTasksDir(), `${id}.json`)
}

export function saveStarTask(task: StarMediaTask): StarMediaTask {
  const next = { ...task, updatedAt: Date.now() }
  writePrivateJson(taskPath(task.id), next)
  return next
}

export function readStarTask(id: string): StarMediaTask | null {
  try {
    return JSON.parse(fs.readFileSync(taskPath(id), 'utf-8')) as StarMediaTask
  } catch {
    return null
  }
}

export function listStarTasks(limit = 100): StarMediaTask[] {
  let names: string[]
  try {
    names = fs.readdirSync(starTasksDir()).filter(name => name.endsWith('.json'))
  } catch {
    return []
  }
  const tasks: StarMediaTask[] = []
  for (const name of names) {
    const task = readStarTask(name.slice(0, -5))
    if (task) tasks.push(task)
  }
  return tasks.sort((a, b) => b.createdAt - a.createdAt).slice(0, limit)
}

export function deleteStarTask(id: string, removeFiles = false): boolean {
  const task = readStarTask(id)
  if (!task) return false
  if (removeFiles) {
    for (const output of task.outputs) {
      if (output.file && output.file.startsWith(starOutputsDir())) {
        fs.rmSync(output.file, { force: true })
      }
    }
  }
  fs.rmSync(taskPath(id), { force: true })
  return true
}
