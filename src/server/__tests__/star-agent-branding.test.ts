import { describe, expect, it } from 'bun:test'
import { readdirSync, readFileSync } from 'node:fs'
import { join, relative, sep } from 'node:path'

/**
 * The desktop app ships as STAR Agent. The name of the project it was forked
 * from may only remain where an older install has to be recognised: on a line
 * that says so (`legacy`), or right below such a line.
 */
const repoRoot = join(import.meta.dir, '..', '..', '..')
const FORMER_NAME = /claude[ _-]?code[ _-]?haha/i
const SOURCE_FILE = /\.(?:ts|tsx|js|mjs|cjs)$/
const SKIPPED_DIRS = new Set(['node_modules', '__tests__', 'fixtures', 'dist'])

/**
 * Protocol identifiers the IM platforms' registration endpoints receive as
 * `source`; the platforms may key integrations on them, so they stay until the
 * platforms confirm a new value. Nothing shows them to the user.
 */
const THIRD_PARTY_SOURCE_IDS = new Set([
  'adapters/feishu/registration.ts',
  'adapters/qq/qr-auth.ts',
  'adapters/wecom/qr-auth.ts',
])

function productionFiles(dir: string): string[] {
  const out: string[] = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (!SKIPPED_DIRS.has(entry.name)) out.push(...productionFiles(join(dir, entry.name)))
    } else if (SOURCE_FILE.test(entry.name) && !/\.test\.|\.spec\./.test(entry.name)) {
      out.push(join(dir, entry.name))
    }
  }
  return out
}

function formerNameLines(file: string): string[] {
  const lines = readFileSync(file, 'utf8').split('\n')
  return lines.flatMap((line, index) => {
    if (!FORMER_NAME.test(line)) return []
    if (/legacy/i.test(line) || /legacy/i.test(lines[index - 1] ?? '')) return []
    return [`${relative(repoRoot, file).split(sep).join('/')}:${index + 1}: ${line.trim()}`]
  })
}

describe('STAR Agent branding', () => {
  it('never names the former product in shipped server, CLI and adapter code', () => {
    const offenders = ['src', 'adapters']
      .flatMap(dir => productionFiles(join(repoRoot, dir)))
      .filter(file => !THIRD_PARTY_SOURCE_IDS.has(relative(repoRoot, file).split(sep).join('/')))
      .flatMap(formerNameLines)

    expect(offenders).toEqual([])
  })

  it('keeps the exceptions limited to registration source ids', () => {
    for (const file of THIRD_PARTY_SOURCE_IDS) {
      const lines = readFileSync(join(repoRoot, file), 'utf8').split('\n').filter(line => FORMER_NAME.test(line))
      expect(lines.length).toBeGreaterThan(0)
      for (const line of lines) expect(line).toMatch(/source/i)
    }
  })
})
