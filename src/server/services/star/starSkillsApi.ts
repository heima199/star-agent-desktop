/**
 * User skills installed from the STAR plugin market (`/api/star/skills/…`).
 * A skill is `<config>/skills/<id>/SKILL.md`, the folder Claude Code scans;
 * disabled skills move to `<config>/skills/.disabled/<id>` (two levels deep,
 * so they are not loaded) and removed ones to `<config>/skills/.trash`.
 *
 *   GET    skills                 installed + disabled user skills
 *   POST   skills/install         { id, content }   write SKILL.md
 *   POST   skills/:id/toggle      enable ⇄ disable
 *   DELETE skills/:id             move to .trash
 */

import * as fs from 'node:fs'
import * as path from 'node:path'

import { ApiError } from '../../middleware/errorHandler.js'
import { claudeConfigRoot } from './starConfig.js'

type InstalledSkill = { id: string; name: string; description: string; disabled: boolean; updatedAt: number }

const SKILL_ID = /^[a-z0-9][a-z0-9-]{1,63}$/

function skillsRoot(): string {
  return path.join(claudeConfigRoot(), 'skills')
}

function safeSkillId(value: unknown): string {
  const id = typeof value === 'string' ? value.trim().toLowerCase() : ''
  if (!SKILL_ID.test(id)) throw ApiError.badRequest('Invalid skill id')
  return id
}

function frontValue(markdown: string, key: string): string {
  const head = /^---\r?\n([\s\S]*?)\r?\n---/.exec(markdown)?.[1] ?? ''
  const line = new RegExp(`^${key}:\\s*(.*)$`, 'm').exec(head)?.[1]?.trim() ?? ''
  if (line === '|' || line === '>') {
    const block = new RegExp(`^${key}:\\s*[|>]\\r?\\n((?:[ \\t]+.*\\r?\\n?)+)`, 'm').exec(head)?.[1] ?? ''
    return block.replace(/\s+/g, ' ').trim()
  }
  return line.replace(/^["']|["']$/g, '')
}

function readSkills(dir: string, disabled: boolean): InstalledSkill[] {
  let names: string[] = []
  try {
    names = fs.readdirSync(dir, { withFileTypes: true }).filter(entry => entry.isDirectory() && !entry.name.startsWith('.')).map(entry => entry.name)
  } catch {
    return []
  }
  return names.flatMap(name => {
    const file = path.join(dir, name, 'SKILL.md')
    try {
      const markdown = fs.readFileSync(file, 'utf8')
      return [{
        id: name,
        name: frontValue(markdown, 'name') || name,
        description: frontValue(markdown, 'description').slice(0, 400),
        disabled,
        updatedAt: Math.floor(fs.statSync(file).mtimeMs),
      }]
    } catch {
      return []
    }
  })
}

export async function handleStarSkillsApi(req: Request, segments: string[]): Promise<Response> {
  const root = skillsRoot()
  const sub = segments[3]
  if (!sub && req.method === 'GET') {
    return Response.json({ root, skills: [...readSkills(root, false), ...readSkills(path.join(root, '.disabled'), true)] })
  }
  if (sub === 'install' && req.method === 'POST') {
    let body: Record<string, unknown>
    try {
      body = await req.json() as Record<string, unknown>
    } catch {
      throw ApiError.badRequest('Expected a JSON object')
    }
    const id = safeSkillId(body.id)
    const content = typeof body.content === 'string' ? body.content : ''
    if (!content.trim() || content.length > 400_000) throw ApiError.badRequest('Missing skill content')
    const disabledDir = path.join(root, '.disabled', id)
    if (fs.existsSync(disabledDir)) fs.rmSync(disabledDir, { recursive: true, force: true })
    fs.mkdirSync(path.join(root, id), { recursive: true })
    fs.writeFileSync(path.join(root, id, 'SKILL.md'), content, 'utf8')
    return Response.json({ ok: true, id, path: path.join(root, id, 'SKILL.md') })
  }
  if (sub) {
    const id = safeSkillId(decodeURIComponent(sub))
    const enabled = path.join(root, id)
    const disabled = path.join(root, '.disabled', id)
    if (segments[4] === 'toggle' && req.method === 'POST') {
      if (fs.existsSync(enabled)) {
        fs.mkdirSync(path.dirname(disabled), { recursive: true })
        fs.rmSync(disabled, { recursive: true, force: true })
        fs.renameSync(enabled, disabled)
        return Response.json({ ok: true, disabled: true })
      }
      if (fs.existsSync(disabled)) {
        fs.renameSync(disabled, enabled)
        return Response.json({ ok: true, disabled: false })
      }
      throw ApiError.notFound('Skill not found')
    }
    if (!segments[4] && req.method === 'DELETE') {
      const source = fs.existsSync(enabled) ? enabled : fs.existsSync(disabled) ? disabled : null
      if (!source) throw ApiError.notFound('Skill not found')
      const trash = path.join(root, '.trash')
      fs.mkdirSync(trash, { recursive: true })
      fs.renameSync(source, path.join(trash, `${Date.now()}-${id}`))
      return Response.json({ ok: true })
    }
  }
  throw ApiError.notFound('Unknown skills endpoint')
}
