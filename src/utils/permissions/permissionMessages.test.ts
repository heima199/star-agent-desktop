import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import type { Tool, ToolPermissionContext } from '../../Tool.js'
import { getEmptyToolPermissionContext } from '../../Tool.js'
import {
  resetStateForTests,
  setCwdState,
  setOriginalCwd,
} from '../../bootstrap/state.js'
import {
  checkReadPermissionForTool,
  checkWritePermissionForTool,
  getResolvedWorkingDirPaths,
} from './filesystem.js'
import { createPermissionRequestMessage } from './permissions.js'
import { resetStarBrandNameCacheForTests, starBrandFile } from '../starBrand.js'

// Permission prompts are shown to the user, who talks to STAR: they must not
// name Claude (the fork's leftover "Claude requested permissions to …").

const pathTool = {
  name: 'PathTool',
  getPath(input: { file_path: string }) {
    return input.file_path
  },
} as unknown as Tool

// Synthetic paths that never exist: no real user state is read or written.
const workspace = resolve('/star-permission-messages/workspace')
const outside = resolve('/star-permission-messages/outside/notes.txt')

function clearWorkingDirCache(): void {
  ;(getResolvedWorkingDirPaths.cache as { clear?: () => void }).clear?.()
}

function permissionContext(): ToolPermissionContext {
  return { ...getEmptyToolPermissionContext(), mode: 'default' }
}

// The read check derives the bundled-skills folder from the build-time MACRO.VERSION.
const globals = globalThis as typeof globalThis & { MACRO?: Record<string, string> }
let originalMacro: Record<string, string> | undefined

describe('permission prompts name STAR', () => {
  // An empty config dir: no brand.json, so the default name; the real one is never read.
  const savedConfigDir = process.env.CLAUDE_CONFIG_DIR
  let configDir = ''

  beforeEach(() => {
    originalMacro = globals.MACRO
    globals.MACRO = { ...originalMacro, VERSION: originalMacro?.VERSION ?? '0.0.0-test' }
    configDir = mkdtempSync(join(tmpdir(), 'star-permission-messages-'))
    process.env.CLAUDE_CONFIG_DIR = configDir
    resetStarBrandNameCacheForTests()
    resetStateForTests()
    setOriginalCwd(workspace)
    setCwdState(workspace)
    clearWorkingDirCache()
  })

  afterEach(() => {
    resetStateForTests()
    clearWorkingDirCache()
    if (savedConfigDir === undefined) delete process.env.CLAUDE_CONFIG_DIR
    else process.env.CLAUDE_CONFIG_DIR = savedConfigDir
    resetStarBrandNameCacheForTests()
    rmSync(configDir, { recursive: true, force: true })
    if (originalMacro === undefined) delete globals.MACRO
    else globals.MACRO = originalMacro
  })

  it('asks for a tool without a rule in STAR\'s name', () => {
    expect(createPermissionRequestMessage('WebSearch')).toBe(
      "STAR requested permissions to use WebSearch, but you haven't granted it yet.",
    )
  })

  it('asks to read a file outside the working directory in STAR\'s name', () => {
    const result = checkReadPermissionForTool(pathTool, { file_path: outside }, permissionContext())

    expect(result.behavior).toBe('ask')
    expect(result.behavior === 'ask' ? result.message : '').toBe(
      `STAR requested permissions to read from ${outside}, but you haven't granted it yet.`,
    )
  })

  it('asks to write a file outside the working directory in STAR\'s name', () => {
    const result = checkWritePermissionForTool(pathTool, { file_path: outside }, permissionContext())

    expect(result.behavior).toBe('ask')
    expect(result.behavior === 'ask' ? result.message : '').toStartWith('STAR requested permissions to write to ')
    expect(result.behavior === 'ask' ? result.message : '').not.toContain('Claude')
  })

  it('leaves no prompt in the permission checks that names Claude', () => {
    for (const file of ['filesystem.ts', 'permissions.ts']) {
      const source = readFileSync(join(import.meta.dir, file), 'utf8')
      expect(source).not.toMatch(/[`'"]Claude (?:requested|wants)\b/)
    }
  })

  it('leaves no Claude in the tool permission prompts and notifications', () => {
    // The web tools' permission descriptions, the workflow prompt, and the
    // terminal permission dialogs / notification titles.
    const src = join(import.meta.dir, '..', '..')
    const files = [
      'tools/WebFetchTool/WebFetchTool.ts',
      'tools/WebSearchTool/WebSearchTool.ts',
      'tools/WorkflowTool/WorkflowTool.ts',
      'components/permissions/PermissionRequest.tsx',
      'components/permissions/EnterPlanModePermissionRequest/EnterPlanModePermissionRequest.tsx',
      'components/permissions/ExitPlanModePermissionRequest/ExitPlanModePermissionRequest.tsx',
    ]
    for (const file of files) {
      const source = readFileSync(join(src, file), 'utf8')
      expect(source).not.toMatch(/[`'">]\s*Claude(?: Code)? (?:requested|wants|needs)\b/)
      // The name follows the STAR console (brand.json), so no prompt spells STAR out.
      expect(source).not.toMatch(/[`'">]\s*STAR (?:requested|wants|needs)\b/)
    }
    for (const file of ['filesystem.ts', 'permissions.ts']) {
      expect(readFileSync(join(import.meta.dir, file), 'utf8')).not.toMatch(/[`'"]STAR (?:requested|wants)\b/)
    }
  })
})

// 「star需要跟随后台设置的名称来展示」: the prompts name the product the STAR
// console sets, which the local server caches in <config>/cc-haha/star/brand.json.
describe('permission prompts follow the console brand name', () => {
  const savedConfigDir = process.env.CLAUDE_CONFIG_DIR
  let configDir = ''

  beforeEach(() => {
    originalMacro = globals.MACRO
    globals.MACRO = { ...originalMacro, VERSION: originalMacro?.VERSION ?? '0.0.0-test' }
    configDir = mkdtempSync(join(tmpdir(), 'star-permission-brand-'))
    process.env.CLAUDE_CONFIG_DIR = configDir
    resetStarBrandNameCacheForTests()
    resetStateForTests()
    setOriginalCwd(workspace)
    setCwdState(workspace)
    clearWorkingDirCache()
  })

  afterEach(() => {
    resetStateForTests()
    clearWorkingDirCache()
    if (savedConfigDir === undefined) delete process.env.CLAUDE_CONFIG_DIR
    else process.env.CLAUDE_CONFIG_DIR = savedConfigDir
    resetStarBrandNameCacheForTests()
    rmSync(configDir, { recursive: true, force: true })
    if (originalMacro === undefined) delete globals.MACRO
    else globals.MACRO = originalMacro
  })

  function cacheBrand(name: string): void {
    const file = starBrandFile()
    mkdirSync(dirname(file), { recursive: true })
    writeFileSync(file, JSON.stringify({ name, updatedAt: Date.now() }))
    resetStarBrandNameCacheForTests()
  }

  it('says STAR until a name is cached', () => {
    expect(createPermissionRequestMessage('WebSearch')).toStartWith('STAR requested permissions to use WebSearch')
  })

  it('uses the cached console name in tool, read and write prompts', () => {
    cacheBrand('PRIVO')
    expect(createPermissionRequestMessage('WebSearch')).toBe(
      "PRIVO requested permissions to use WebSearch, but you haven't granted it yet.",
    )
    const read = checkReadPermissionForTool(pathTool, { file_path: outside }, permissionContext())
    expect(read.behavior === 'ask' ? read.message : '').toBe(
      `PRIVO requested permissions to read from ${outside}, but you haven't granted it yet.`,
    )
    const write = checkWritePermissionForTool(pathTool, { file_path: outside }, permissionContext())
    expect(write.behavior === 'ask' ? write.message : '').toStartWith('PRIVO requested permissions to write to ')
  })

  it('normalizes what the cache holds and ignores a broken file', () => {
    cacheBrand('  <PRIVO>  ')
    expect(createPermissionRequestMessage('X')).toStartWith('PRIVO requested')
    cacheBrand('MaxClaw')
    expect(createPermissionRequestMessage('X')).toStartWith('STAR requested')
    writeFileSync(starBrandFile(), '{ not json')
    resetStarBrandNameCacheForTests()
    expect(createPermissionRequestMessage('X')).toStartWith('STAR requested')
  })
})
