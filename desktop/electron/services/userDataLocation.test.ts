import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  applyUserDataLocation,
  describeUserDataLocation,
  LEGACY_USER_DATA_DIR_NAMES,
  nodeUserDataLocationFs,
  planUserDataLocation,
  type UserDataDirState,
  type UserDataLocationApp,
} from './userDataLocation'

const roots: string[] = []

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

function appDataFixture() {
  const appData = mkdtempSync(path.join(tmpdir(), 'star-agent-user-data-'))
  roots.push(appData)
  const write = (folder: string, file: string, content: string) => {
    mkdirSync(path.join(appData, folder), { recursive: true })
    writeFileSync(path.join(appData, folder, file), content)
  }
  return { appData, write }
}

function fakeApp(appData: string, overrides: Partial<{ name: string, customDir: boolean }> = {}) {
  const setPath = vi.fn()
  const app: UserDataLocationApp = {
    name: overrides.name ?? 'PRIVO STAR WORK',
    getPath: () => appData,
    setPath,
    commandLine: { hasSwitch: name => name === 'user-data-dir' && overrides.customDir === true },
  }
  return { app, setPath }
}

function states(map: Record<string, UserDataDirState>) {
  return (dir: string) => map[path.basename(dir)] ?? 'missing'
}

describe('planUserDataLocation', () => {
  const base = { appName: 'PRIVO STAR WORK', appDataDir: '/data', hasCustomUserDataDir: false }

  it('adopts the folder packaged builds used under the package name', () => {
    expect(planUserDataLocation({ ...base, stateOf: states({ 'claude-code-desktop': 'populated' }) })).toEqual({
      action: 'adopt',
      legacyDir: path.join('/data', 'claude-code-desktop'),
      targetDir: path.join('/data', 'PRIVO STAR WORK'),
      targetIsEmptyDir: false,
    })
  })

  it('adopts the STAR Agent folder of 1.1.x first, before older names', () => {
    expect(LEGACY_USER_DATA_DIR_NAMES).toEqual(['STAR Agent', 'claude-code-desktop', 'Claude Code Haha'])
    expect(planUserDataLocation({
      ...base,
      stateOf: states({ 'STAR Agent': 'populated', 'claude-code-desktop': 'populated' }),
    })).toEqual({
      action: 'adopt',
      legacyDir: path.join('/data', 'STAR Agent'),
      targetDir: path.join('/data', 'PRIVO STAR WORK'),
      targetIsEmptyDir: false,
    })
  })

  it('also recognises the former product name, after the package name', () => {
    expect(planUserDataLocation({ ...base, stateOf: states({ 'Claude Code Haha': 'populated' }) })).toMatchObject({
      action: 'adopt',
      legacyDir: path.join('/data', 'Claude Code Haha'),
    })
    expect(planUserDataLocation({
      ...base,
      stateOf: states({ 'Claude Code Haha': 'populated', 'claude-code-desktop': 'populated' }),
    })).toMatchObject({ legacyDir: path.join('/data', 'claude-code-desktop') })
  })

  it('treats an empty current folder as free', () => {
    expect(planUserDataLocation({
      ...base,
      stateOf: states({ 'PRIVO STAR WORK': 'empty', 'claude-code-desktop': 'populated' }),
    })).toMatchObject({ action: 'adopt', targetIsEmptyDir: true })
  })

  it('never merges into a current folder that is in use or unreadable', () => {
    for (const current of ['populated', 'unknown'] as const) {
      expect(planUserDataLocation({
        ...base,
        stateOf: states({ 'PRIVO STAR WORK': current, 'claude-code-desktop': 'populated' }),
      })).toEqual({ action: 'keep' })
    }
  })

  it('ignores legacy folders that are empty, unreadable or absent', () => {
    for (const legacy of ['empty', 'unknown', 'missing'] as const) {
      expect(planUserDataLocation({ ...base, stateOf: states({ 'claude-code-desktop': legacy }) })).toEqual({ action: 'keep' })
    }
  })

  it('leaves custom --user-data-dir runs and unbranded development runs alone', () => {
    const stateOf = states({ 'claude-code-desktop': 'populated' })
    expect(planUserDataLocation({ ...base, hasCustomUserDataDir: true, stateOf })).toEqual({ action: 'keep' })
    expect(planUserDataLocation({ ...base, appName: 'Electron', stateOf })).toEqual({ action: 'keep' })
  })
})

describe('applyUserDataLocation', () => {
  it('moves the legacy folder with its content to the new name', () => {
    const f = appDataFixture()
    f.write('claude-code-desktop', 'app-mode.json', '{"mode":"default"}')
    f.write(path.join('claude-code-desktop', 'Local Storage'), 'state.ldb', 'ui-state')
    const { app, setPath } = fakeApp(f.appData)

    const result = applyUserDataLocation(app)

    expect(result).toEqual({
      kind: 'moved',
      from: path.join(f.appData, 'claude-code-desktop'),
      to: path.join(f.appData, 'PRIVO STAR WORK'),
    })
    expect(readFileSync(path.join(f.appData, 'PRIVO STAR WORK', 'app-mode.json'), 'utf8')).toBe('{"mode":"default"}')
    expect(readFileSync(path.join(f.appData, 'PRIVO STAR WORK', 'Local Storage', 'state.ldb'), 'utf8')).toBe('ui-state')
    expect(existsSync(path.join(f.appData, 'claude-code-desktop'))).toBe(false)
    expect(setPath).not.toHaveBeenCalled()
    expect(describeUserDataLocation(result)).toBe('[user-data] moved "claude-code-desktop" to "PRIVO STAR WORK"')
  })

  it('moves a 1.1.x STAR Agent folder (sign-in state, settings) to PRIVO STAR WORK on the first start of 1.2.0', () => {
    const f = appDataFixture()
    f.write('STAR Agent', 'app-mode.json', '{"mode":"default"}')
    f.write('STAR Agent', 'system-prefs.json', '{"closeToTray":true}')
    f.write(path.join('STAR Agent', 'Local Storage', 'leveldb'), '000003.log', 'renderer-state')
    // An older folder left behind must not win over the 1.1.x one
    f.write('claude-code-desktop', 'app-mode.json', '{"mode":"old"}')
    const { app, setPath } = fakeApp(f.appData)

    const result = applyUserDataLocation(app)

    expect(result).toEqual({ kind: 'moved', from: path.join(f.appData, 'STAR Agent'), to: path.join(f.appData, 'PRIVO STAR WORK') })
    expect(readFileSync(path.join(f.appData, 'PRIVO STAR WORK', 'system-prefs.json'), 'utf8')).toBe('{"closeToTray":true}')
    expect(readFileSync(path.join(f.appData, 'PRIVO STAR WORK', 'Local Storage', 'leveldb', '000003.log'), 'utf8')).toBe('renderer-state')
    expect(existsSync(path.join(f.appData, 'STAR Agent'))).toBe(false)
    expect(readFileSync(path.join(f.appData, 'claude-code-desktop', 'app-mode.json'), 'utf8')).toBe('{"mode":"old"}')
    expect(setPath).not.toHaveBeenCalled()

    // Second start: the folder is in place, nothing moves again
    expect(applyUserDataLocation(app)).toEqual({ kind: 'unchanged' })
  })

  it('replaces an empty current folder but never deletes one with content', () => {
    const f = appDataFixture()
    f.write('Claude Code Haha', 'system-prefs.json', '{}')
    mkdirSync(path.join(f.appData, 'PRIVO STAR WORK'))
    const { app } = fakeApp(f.appData)

    expect(applyUserDataLocation(app).kind).toBe('moved')
    expect(existsSync(path.join(f.appData, 'PRIVO STAR WORK', 'system-prefs.json'))).toBe(true)

    const g = appDataFixture()
    g.write('claude-code-desktop', 'app-mode.json', 'legacy')
    g.write('PRIVO STAR WORK', 'app-mode.json', 'current')
    const second = fakeApp(g.appData)
    expect(applyUserDataLocation(second.app)).toEqual({ kind: 'unchanged' })
    expect(readFileSync(path.join(g.appData, 'PRIVO STAR WORK', 'app-mode.json'), 'utf8')).toBe('current')
    expect(readFileSync(path.join(g.appData, 'claude-code-desktop', 'app-mode.json'), 'utf8')).toBe('legacy')
    expect(second.setPath).not.toHaveBeenCalled()
  })

  it('keeps using the legacy folder in place when it cannot be moved', () => {
    const f = appDataFixture()
    f.write('claude-code-desktop', 'app-mode.json', '{}')
    const { app, setPath } = fakeApp(f.appData)
    const busy = Object.assign(new Error('resource busy or locked'), { code: 'EBUSY' })

    const result = applyUserDataLocation(app, {
      ...nodeUserDataLocationFs,
      rename: () => { throw busy },
    })

    expect(result).toEqual({ kind: 'legacy-in-place', dir: path.join(f.appData, 'claude-code-desktop'), reason: 'EBUSY' })
    expect(setPath).toHaveBeenCalledWith('userData', path.join(f.appData, 'claude-code-desktop'))
    expect(existsSync(path.join(f.appData, 'claude-code-desktop', 'app-mode.json'))).toBe(true)
    expect(describeUserDataLocation(result)).toBe(
      '[user-data] using "claude-code-desktop" in place (EBUSY); the move is retried on the next launch',
    )
  })

  it('does nothing for a fresh install, a custom profile or a development run', () => {
    const fresh = appDataFixture()
    const freshRun = fakeApp(fresh.appData)
    expect(applyUserDataLocation(freshRun.app)).toEqual({ kind: 'unchanged' })
    expect(existsSync(path.join(fresh.appData, 'PRIVO STAR WORK'))).toBe(false)
    expect(describeUserDataLocation({ kind: 'unchanged' })).toBeNull()

    const f = appDataFixture()
    f.write('claude-code-desktop', 'app-mode.json', '{}')
    for (const overrides of [{ customDir: true }, { name: 'Electron' }]) {
      const { app, setPath } = fakeApp(f.appData, overrides)
      expect(applyUserDataLocation(app)).toEqual({ kind: 'unchanged' })
      expect(setPath).not.toHaveBeenCalled()
    }
    expect(existsSync(path.join(f.appData, 'claude-code-desktop', 'app-mode.json'))).toBe(true)
  })

  it('runs in main.ts before the single-instance lock and before any userData read', () => {
    const desktopDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
    const source = readFileSync(path.join(desktopDir, 'electron', 'main.ts'), 'utf8')
    const apply = source.indexOf('applyUserDataLocation(app)')
    expect(apply).toBeGreaterThan(-1)
    expect(apply).toBeLessThan(source.indexOf('acquireSingleInstanceLock(app, () => mainWindow)'))
    expect(apply).toBeLessThan(source.indexOf('registerIpcHandlers()\n'))
    expect(apply).toBeLessThan(source.indexOf('app.whenReady()'))
  })
})
