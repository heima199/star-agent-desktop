/**
 * Vendors the AI design resources of open-design (Apache-2.0,
 * https://github.com/nexu-io/open-design) into `desktop/public/open-design`,
 * which ships inside dist/ and is read by the STAR Design API.
 *
 *   bun scripts/sync-open-design.ts <path-to-open-design-checkout>
 *   (or set OPEN_DESIGN_SRC)
 *
 * Only the parts the desktop uses are copied: design templates (SKILL.md +
 * example.html), skills (SKILL.md), design systems (DESIGN.md), craft rules
 * and the image / video prompt templates. Big asset bundles are skipped.
 */

import * as fs from 'node:fs'
import * as path from 'node:path'

const source = process.argv[2] || process.env.OPEN_DESIGN_SRC
if (!source || !fs.existsSync(path.join(source, 'design-templates'))) {
  console.error('usage: bun scripts/sync-open-design.ts <open-design checkout>')
  process.exit(1)
}
const target = path.resolve(import.meta.dir, '..', 'public', 'open-design')
const MAX_EXAMPLE_BYTES = 1_500_000

type Front = Record<string, unknown>

/** Front matter subset used by open-design: scalars, `|` blocks, lists, one nested map. */
function frontMatter(markdown: string): Front {
  const match = /^---\r?\n([\s\S]*?)\r?\n---/.exec(markdown)
  if (!match) return {}
  const result: Front = {}
  const lines = match[1]!.split(/\r?\n/)
  let key = ''
  let mode: 'none' | 'block' | 'list' | 'map' = 'none'
  let block: string[] = []
  const flush = () => {
    if (mode === 'block' && key) result[key] = block.join(' ').replace(/\s+/g, ' ').trim()
    block = []
  }
  const unquote = (value: string) => value.trim().replace(/^["']|["']$/g, '')
  for (const line of lines) {
    const top = /^([A-Za-z_][\w-]*):\s*(.*)$/.exec(line)
    if (top) {
      flush()
      key = top[1]!
      const value = top[2]!.trim()
      if (value === '|' || value === '>' || value === '|-' || value === '>-') {
        mode = 'block'
      } else if (value === '') {
        mode = 'list'
        result[key] = []
      } else {
        mode = 'none'
        result[key] = unquote(value)
      }
      continue
    }
    if (mode === 'block') {
      block.push(line.trim())
    } else if (mode === 'list' || mode === 'map') {
      const item = /^\s+-\s+(.*)$/.exec(line)
      const nested = /^\s+([A-Za-z_][\w-]*):\s*(.*)$/.exec(line)
      if (item && Array.isArray(result[key])) {
        (result[key] as string[]).push(unquote(item[1]!))
      } else if (nested) {
        if (mode === 'list') {
          result[key] = {}
          mode = 'map'
        }
        (result[key] as Record<string, string>)[nested[1]!] = unquote(nested[2]!)
      }
    }
  }
  flush()
  return result
}

function text(value: unknown, max = 600): string {
  return typeof value === 'string' ? value.slice(0, max) : ''
}

function list(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string').slice(0, 16) : []
}

function copy(from: string, to: string): void {
  fs.mkdirSync(path.dirname(to), { recursive: true })
  fs.copyFileSync(from, to)
}

fs.rmSync(target, { recursive: true, force: true })
fs.mkdirSync(target, { recursive: true })

// ── templates
const templates: Front[] = []
for (const dir of fs.readdirSync(path.join(source, 'design-templates'), { withFileTypes: true })) {
  if (!dir.isDirectory()) continue
  const from = path.join(source, 'design-templates', dir.name)
  const skill = path.join(from, 'SKILL.md')
  if (!fs.existsSync(skill)) continue
  const markdown = fs.readFileSync(skill, 'utf8')
  const meta = frontMatter(markdown)
  const od = (meta.od && typeof meta.od === 'object' ? meta.od : {}) as Record<string, string>
  const example = path.join(from, 'example.html')
  const hasExample = fs.existsSync(example) && fs.statSync(example).size <= MAX_EXAMPLE_BYTES
  copy(skill, path.join(target, 'templates', dir.name, 'SKILL.md'))
  if (hasExample) copy(example, path.join(target, 'templates', dir.name, 'example.html'))
  const deck = dir.name.startsWith('html-ppt') || /deck|ppt|pitch-book/.test(dir.name) || od.mode === 'deck'
  templates.push({
    id: dir.name,
    name: text(meta.en_name) || text(meta.name) || dir.name,
    zhName: text(meta.zh_name),
    description: text(meta.en_description) || text(meta.description),
    zhDescription: text(meta.zh_description),
    tags: list(meta.tags),
    mode: deck ? 'deck' : (od.mode || 'prototype'),
    featured: Number(od.featured) || 0,
    hasExample,
  })
}

// ── skills
const skills: Front[] = []
for (const dir of fs.readdirSync(path.join(source, 'skills'), { withFileTypes: true })) {
  if (!dir.isDirectory()) continue
  const skill = path.join(source, 'skills', dir.name, 'SKILL.md')
  if (!fs.existsSync(skill)) continue
  const meta = frontMatter(fs.readFileSync(skill, 'utf8'))
  const od = (meta.od && typeof meta.od === 'object' ? meta.od : {}) as Record<string, string>
  copy(skill, path.join(target, 'skills', dir.name, 'SKILL.md'))
  skills.push({
    id: dir.name,
    name: text(meta.en_name) || text(meta.name) || dir.name,
    zhName: text(meta.zh_name),
    description: text(meta.en_description) || text(meta.description),
    zhDescription: text(meta.zh_description),
    tags: list(meta.tags),
    mode: od.mode || '',
  })
}

// ── design systems
const systems: Front[] = []
for (const dir of fs.readdirSync(path.join(source, 'design-systems'), { withFileTypes: true })) {
  if (!dir.isDirectory() || dir.name.startsWith('_')) continue
  const design = path.join(source, 'design-systems', dir.name, 'DESIGN.md')
  if (!fs.existsSync(design)) continue
  const markdown = fs.readFileSync(design, 'utf8')
  copy(design, path.join(target, 'systems', dir.name, 'DESIGN.md'))
  const title = /^#\s+(.+)$/m.exec(markdown)?.[1]?.replace(/^Design System (Inspired by|for)\s+/i, '').trim() || dir.name
  const colors = [...new Set((markdown.match(/#[0-9a-fA-F]{6}\b/g) ?? []).map(color => color.toLowerCase()))].slice(0, 6)
  systems.push({
    id: dir.name,
    name: title,
    category: /^>\s*Category:\s*(.+)$/m.exec(markdown)?.[1]?.trim() ?? '',
    summary: /^>\s*(?!Category:)(.+)$/m.exec(markdown)?.[1]?.trim().slice(0, 240) ?? '',
    colors,
  })
}

// ── craft rules
const craft: Front[] = []
for (const name of fs.readdirSync(path.join(source, 'craft'))) {
  if (!name.endsWith('.md') || name === 'README.md' || name === 'FUTURE_SECTIONS.md') continue
  const markdown = fs.readFileSync(path.join(source, 'craft', name), 'utf8')
  copy(path.join(source, 'craft', name), path.join(target, 'craft', name))
  craft.push({ id: name.replace(/\.md$/, ''), title: /^#\s+(.+)$/m.exec(markdown)?.[1]?.trim() ?? name })
}

// ── prompt templates (placeholders collapse to their defaults)
const prompts: Record<string, Front[]> = { image: [], video: [] }
for (const surface of ['image', 'video']) {
  const dir = path.join(source, 'prompt-templates', surface)
  if (!fs.existsSync(dir)) continue
  for (const name of fs.readdirSync(dir).filter(file => file.endsWith('.json'))) {
    try {
      const item = JSON.parse(fs.readFileSync(path.join(dir, name), 'utf8')) as Record<string, unknown>
      const sourceInfo = (item.source && typeof item.source === 'object' ? item.source : {}) as Record<string, string>
      prompts[surface]!.push({
        id: text(item.id, 120) || name.replace(/\.json$/, ''),
        title: text(item.title, 200),
        summary: text(item.summary, 400),
        category: text(item.category, 80),
        tags: list(item.tags),
        aspect: text(item.aspect, 20),
        prompt: text(item.prompt, 12_000).replace(/\{argument name="[^"]*" default="([^"]*)"\}/g, '$1'),
        previewImageUrl: text(item.previewImageUrl, 1000),
        previewVideoUrl: text(item.previewVideoUrl, 1000),
        author: text(sourceInfo.author, 120),
        license: text(sourceInfo.license, 40),
        url: text(sourceInfo.url, 1000),
      })
    } catch { /* skip malformed */ }
  }
  fs.mkdirSync(path.join(target, 'prompts'), { recursive: true })
  fs.writeFileSync(path.join(target, 'prompts', `${surface}.json`), JSON.stringify({ items: prompts[surface] }), 'utf8')
}

if (fs.existsSync(path.join(source, 'LICENSE'))) copy(path.join(source, 'LICENSE'), path.join(target, 'LICENSE'))
fs.writeFileSync(
  path.join(target, 'NOTICE.md'),
  '# open-design resources\n\nDesign templates, skills, design systems, craft rules and prompt templates in this folder come from\n[open-design](https://github.com/nexu-io/open-design) (Apache-2.0, see LICENSE). Prompt templates keep their own\nsource and license fields. Regenerate with `bun scripts/sync-open-design.ts <checkout>`.\n',
  'utf8',
)
const byFeatured = (a: Front, b: Front) => (Number(b.featured) || 0) - (Number(a.featured) || 0) || String(a.id).localeCompare(String(b.id))
fs.writeFileSync(
  path.join(target, 'index.json'),
  JSON.stringify({
    source: 'open-design',
    license: 'Apache-2.0',
    syncedAt: Date.now(),
    templates: templates.sort(byFeatured),
    skills: skills.sort((a, b) => String(a.id).localeCompare(String(b.id))),
    systems: systems.sort((a, b) => String(a.name).localeCompare(String(b.name))),
    craft,
    prompts: { image: prompts.image!.length, video: prompts.video!.length },
  }),
  'utf8',
)
let bytes = 0
const walk = (dir: string) => {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) walk(full)
    else bytes += fs.statSync(full).size
  }
}
walk(target)
console.log(`open-design synced: ${templates.length} templates, ${skills.length} skills, ${systems.length} systems, ${craft.length} craft, ${prompts.image!.length}+${prompts.video!.length} prompts, ${(bytes / 1024 / 1024).toFixed(1)} MB → ${target}`)
