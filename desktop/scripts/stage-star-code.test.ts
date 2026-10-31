import path from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { resolveStarCodeBuildDir, STAR_CODE_BUILD_DIR_ENV, stageStarCode, starCodeEntryName } from './stage-star-code'

const BUILD = path.resolve('fixture', 'VSCode-win32-x64')
const OUT = path.resolve('fixture', 'build-resources', 'star-code')

describe('stage-star-code', () => {
  it('takes the build from --from before the environment', () => {
    expect(resolveStarCodeBuildDir(['bun', 'stage', '--from', BUILD], { [STAR_CODE_BUILD_DIR_ENV]: '/elsewhere' })).toBe(BUILD)
    expect(resolveStarCodeBuildDir(['bun', 'stage'], { [STAR_CODE_BUILD_DIR_ENV]: BUILD })).toBe(BUILD)
    expect(resolveStarCodeBuildDir(['bun', 'stage'], {})).toBeNull()
  })

  it('replaces the staged copy with a packaged build', () => {
    const copy = vi.fn()
    const remove = vi.fn()
    const result = stageStarCode({
      from: BUILD,
      to: OUT,
      platform: 'win32',
      exists: target => target === BUILD || target === path.join(BUILD, 'STAR Code.exe'),
      isDirectory: () => true,
      copy,
      remove,
    })
    expect(result).toEqual({ ok: true, from: BUILD, to: OUT })
    expect(remove).toHaveBeenCalledWith(OUT)
    expect(copy).toHaveBeenCalledWith(BUILD, OUT)
  })

  it('refuses a folder that is not a STAR Code build, and touches nothing', () => {
    const copy = vi.fn()
    const remove = vi.fn()
    const result = stageStarCode({ from: BUILD, to: OUT, platform: 'win32', exists: target => target === BUILD, isDirectory: () => true, copy, remove })
    expect(result.ok).toBe(false)
    expect(!result.ok && result.error).toContain('STAR Code.exe')
    expect(stageStarCode({ from: null, to: OUT, platform: 'win32', copy, remove }).ok).toBe(false)
    expect(copy).not.toHaveBeenCalled()
    expect(remove).not.toHaveBeenCalled()
  })

  it('without a build, keeps a copy that is already staged and touches nothing', () => {
    const copy = vi.fn()
    const remove = vi.fn()
    const result = stageStarCode({
      from: null,
      to: OUT,
      platform: 'win32',
      exists: target => target === path.join(OUT, 'STAR Code.exe'),
      copy,
      remove,
    })
    expect(result).toEqual({ ok: true, reused: true, to: OUT })
    expect(copy).not.toHaveBeenCalled()
    expect(remove).not.toHaveBeenCalled()
  })

  it('knows each platform entry point', () => {
    expect(starCodeEntryName('win32')).toBe('STAR Code.exe')
    expect(starCodeEntryName('darwin')).toBe('STAR Code.app')
    expect(starCodeEntryName('linux')).toBe('star-code')
  })
})
