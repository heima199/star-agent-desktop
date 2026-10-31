import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  buildDesktopDiscoveryRecord,
  desktopDiscoveryFile,
  stripDebugArgs,
  writeDesktopDiscoveryFile,
  type DiscoveryFs,
} from './desktopDiscovery'

const roots: string[] = []
function tempRoot() {
  const root = mkdtempSync(path.join(tmpdir(), 'desktop-discovery-'))
  roots.push(root)
  return root
}
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe('desktopDiscoveryFile', () => {
  it('lives next to the STAR session under CLAUDE_CONFIG_DIR', () => {
    expect(desktopDiscoveryFile({ CLAUDE_CONFIG_DIR: path.join('/data', 'cfg') }, '/home/me'))
      .toBe(path.join('/data', 'cfg', 'cc-haha', 'star', 'desktop-app.json'))
  })

  it('falls back to ~/.claude when CLAUDE_CONFIG_DIR is unset or blank', () => {
    const expected = path.join('/home/me', '.claude', 'cc-haha', 'star', 'desktop-app.json')
    expect(desktopDiscoveryFile({}, '/home/me')).toBe(expected)
    expect(desktopDiscoveryFile({ CLAUDE_CONFIG_DIR: '  ' }, '/home/me')).toBe(expected)
  })
})

describe('stripDebugArgs', () => {
  it('drops remote-debugging and inspector switches, with a separate port value', () => {
    expect(stripDebugArgs([
      '--remote-debugging-port=9352',
      '--inspect',
      '--inspect-brk=9229',
      '--remote-debugging-port', '9371',
      '--inspect-port', '9230',
      '--user-data-dir=C:\\profiles\\a',
      './electron-dist/main.cjs',
    ])).toEqual(['--user-data-dir=C:\\profiles\\a', './electron-dist/main.cjs'])
  })

  it('keeps a positional argument that follows a debug switch written with =', () => {
    expect(stripDebugArgs(['--remote-debugging-port=9352', '9352'])).toEqual(['9352'])
  })
})

describe('buildDesktopDiscoveryRecord', () => {
  it('starts a development run again as electron.exe ./electron-dist/main.cjs in the desktop folder', () => {
    const electron = path.join('C:\\repo', 'desktop', 'node_modules', 'electron', 'dist', 'electron.exe')
    const desktop = path.join('C:\\repo', 'desktop')
    expect(buildDesktopDiscoveryRecord({
      isPackaged: false,
      execPath: electron,
      argv: [electron, '--remote-debugging-port=9352', './electron-dist/main.cjs'],
      cwd: desktop,
      pid: 52268,
      version: '1.0.0',
      now: 1730000000000,
    })).toEqual({
      executable: electron,
      args: ['./electron-dist/main.cjs'],
      cwd: desktop,
      pid: 52268,
      version: '1.0.0',
      updatedAt: 1730000000000,
    })
  })

  it('starts an installed build from its install folder, whatever folder launched it', () => {
    const exe = path.join('C:\\Program Files', 'STAR Agent', 'STAR Agent.exe')
    const record = buildDesktopDiscoveryRecord({
      isPackaged: true,
      execPath: exe,
      argv: [exe],
      cwd: 'C:\\Windows\\System32',
      pid: 7,
      version: '1.0.0',
    })
    expect(record).toMatchObject({ executable: exe, args: [], cwd: path.dirname(exe), pid: 7, version: '1.0.0' })
    expect(record.updatedAt).toBeGreaterThan(0)
  })
})

describe('writeDesktopDiscoveryFile', () => {
  const record = (pid: number) => ({ executable: '/x/STAR Agent', args: [], cwd: '/x', pid, version: '1.0.0', updatedAt: pid })

  it('creates the folder, replaces the previous file and leaves no temp file', () => {
    const file = desktopDiscoveryFile({ CLAUDE_CONFIG_DIR: tempRoot() })

    expect(writeDesktopDiscoveryFile(record(1), file)).toBeNull()
    expect(writeDesktopDiscoveryFile(record(2), file)).toBeNull()

    expect(JSON.parse(readFileSync(file, 'utf8'))).toEqual(record(2))
    expect(readdirSync(path.dirname(file))).toEqual(['desktop-app.json'])
  })

  it('reports instead of throwing when the folder cannot be created', () => {
    const root = tempRoot()
    // A file where the cc-haha folder should be.
    writeFileSync(path.join(root, 'cc-haha'), 'not a folder')

    expect(writeDesktopDiscoveryFile(record(3), desktopDiscoveryFile({ CLAUDE_CONFIG_DIR: root }))).toMatch(/^E[A-Z]+$/)
  })

  it('removes its temp file when the rename fails', () => {
    const removed: string[] = []
    const fs: DiscoveryFs = {
      mkdir: () => undefined,
      writeFile: () => undefined,
      rename: () => { throw Object.assign(new Error('busy'), { code: 'EPERM' }) },
      remove: file => { removed.push(file) },
    }

    expect(writeDesktopDiscoveryFile(record(4), path.join('/cfg', 'desktop-app.json'), fs)).toBe('EPERM')
    expect(removed).toEqual([path.join('/cfg', 'desktop-app.json.4.tmp')])
  })
})

describe('main-process wiring', () => {
  const source = readFileSync(path.join(__dirname, '..', 'main.ts'), 'utf8')

  it('advertises the app after the main window exists, outside the lock opt-out', () => {
    expect(source).toMatch(/await createMainWindow\(\)\n\s+advertiseToStarCode\(\)/)
    expect(source).toMatch(/function advertiseToStarCode\(\) \{\n\s+if \(isSingleInstanceLockDisabled\(\)\) return/)
  })

  it('reports the package version over IPC', () => {
    expect(source).toContain('registerHandler(ELECTRON_IPC_CHANNELS.appGetVersion, () => appVersion())')
  })
})
