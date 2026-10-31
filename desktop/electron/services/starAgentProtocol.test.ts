import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { acquireSingleInstanceLock } from './singleInstance'
import {
  devAppEntryArg,
  installStarAgentOpenUrlHandler,
  isStarAgentUrl,
  registerStarAgentProtocol,
  STAR_AGENT_PROTOCOL,
  starAgentProtocolRegistration,
  withoutStarAgentUrls,
} from './starAgentProtocol'

const require = createRequire(import.meta.url)
const manifest = require('../../package.json') as {
  build?: { protocols?: Array<{ name?: string, schemes?: string[] }> }
}

const PACKAGED_EXE = path.join('C:', 'Program Files', 'STAR Agent', 'STAR Agent.exe')
const ELECTRON_EXE = path.join('C:', 'repo', 'desktop', 'node_modules', 'electron', 'dist', 'electron.exe')
const DESKTOP_DIR = path.join('C:', 'repo', 'desktop')

/** Whether a command line (or a second start's argv) carries the URL. */
function hasStarAgentUrl(argv: readonly unknown[]) {
  return argv.some(isStarAgentUrl)
}

const registrationInput = {
  isPackaged: false,
  execPath: ELECTRON_EXE,
  argv: [ELECTRON_EXE, './electron-dist/main.cjs'],
  cwd: DESKTOP_DIR,
  singleInstanceLockDisabled: false,
  hasCustomUserDataDir: false,
}

describe('star-agent URL detection', () => {
  it('finds the URL alone or among other arguments', () => {
    expect(hasStarAgentUrl([PACKAGED_EXE, 'star-agent://focus'])).toBe(true)
    expect(hasStarAgentUrl([
      ELECTRON_EXE,
      '--allow-file-access-from-files',
      './electron-dist/main.cjs',
      'star-agent://open/some/path?folder=C%3A%5Cwork#x',
      '--original-process-start-time=1',
    ])).toBe(true)
    expect(hasStarAgentUrl(['star-agent:'])).toBe(true)
  })

  it('accepts any letter case of the scheme', () => {
    expect(isStarAgentUrl('STAR-AGENT://FOCUS')).toBe(true)
    expect(isStarAgentUrl('Star-Agent://x')).toBe(true)
    expect(hasStarAgentUrl([PACKAGED_EXE, 'sTaR-aGeNt:open'])).toBe(true)
  })

  it('rejects command lines without the URL and look-alike junk', () => {
    expect(hasStarAgentUrl([])).toBe(false)
    expect(hasStarAgentUrl([PACKAGED_EXE])).toBe(false)
    expect(hasStarAgentUrl([ELECTRON_EXE, './electron-dist/main.cjs', '--remote-debugging-port=9352'])).toBe(false)
    for (const junk of [
      'star-agent',
      'star-agentx://focus',
      'xstar-agent://focus',
      'star_agent://focus',
      '--star-agent://focus',
      ' star-agent://focus',
      '"star-agent://focus"',
      'https://example.com/star-agent://focus',
      'C:\\star-agent:\\file',
      '',
    ]) {
      expect(isStarAgentUrl(junk)).toBe(false)
    }
    expect(hasStarAgentUrl([42, null, undefined, {}, ['star-agent://x']])).toBe(false)
  })

  it('drops the URLs (and only them) from a command line', () => {
    expect(withoutStarAgentUrls([ELECTRON_EXE, './electron-dist/main.cjs', 'STAR-AGENT://x?y=1', '--flag'])).toEqual([
      ELECTRON_EXE,
      './electron-dist/main.cjs',
      '--flag',
    ])
  })
})

describe('star-agent protocol registration', () => {
  it('lets an installed build register itself with no path or arguments', () => {
    expect(starAgentProtocolRegistration({
      ...registrationInput,
      isPackaged: true,
      execPath: PACKAGED_EXE,
      argv: [PACKAGED_EXE, 'star-agent://focus'],
      cwd: path.join('C:', 'Windows', 'System32'),
    })).toEqual({ protocol: 'star-agent' })
  })

  it('makes a development run name electron.exe and its absolute app entry', () => {
    const expected = {
      protocol: 'star-agent',
      executable: ELECTRON_EXE,
      args: [path.resolve(DESKTOP_DIR, './electron-dist/main.cjs')],
    }
    expect(starAgentProtocolRegistration(registrationInput)).toEqual(expected)
    expect(starAgentProtocolRegistration({
      ...registrationInput,
      argv: [ELECTRON_EXE, '--remote-debugging-port', '9352', '--inspect=5858', './electron-dist/main.cjs', 'star-agent://x'],
    })).toEqual(expected)
  })

  it('finds the development entry behind switches, debug-port values and URLs', () => {
    expect(devAppEntryArg([ELECTRON_EXE, 'star-agent://x', '--remote-debugging-port', '9352', '.'])).toBe('.')
    expect(devAppEntryArg([ELECTRON_EXE, '--remote-debugging-port=9352', 'star-agent://x'])).toBeNull()
    expect(devAppEntryArg([ELECTRON_EXE])).toBeNull()
  })

  it('does not register a development run whose entry is unknown', () => {
    expect(starAgentProtocolRegistration({ ...registrationInput, argv: [ELECTRON_EXE, '--inspect'] })).toBeNull()
  })

  it('never registers runs a second start cannot reach', () => {
    for (const isPackaged of [true, false]) {
      expect(starAgentProtocolRegistration({ ...registrationInput, isPackaged, singleInstanceLockDisabled: true })).toBeNull()
      expect(starAgentProtocolRegistration({ ...registrationInput, isPackaged, hasCustomUserDataDir: true })).toBeNull()
    }
  })

  it('passes exactly the protocol for an installed build', () => {
    const app = { setAsDefaultProtocolClient: vi.fn(() => true) }
    expect(registerStarAgentProtocol(app, { protocol: STAR_AGENT_PROTOCOL })).toBe(true)
    expect(app.setAsDefaultProtocolClient).toHaveBeenCalledTimes(1)
    expect(app.setAsDefaultProtocolClient.mock.calls[0]).toEqual(['star-agent'])
  })

  it('passes electron.exe and the entry for a development run', () => {
    const app = { setAsDefaultProtocolClient: vi.fn(() => true) }
    const entry = path.resolve(DESKTOP_DIR, 'electron-dist', 'main.cjs')
    expect(registerStarAgentProtocol(app, { protocol: STAR_AGENT_PROTOCOL, executable: ELECTRON_EXE, args: [entry] })).toBe(true)
    expect(app.setAsDefaultProtocolClient.mock.calls[0]).toEqual(['star-agent', ELECTRON_EXE, [entry]])
  })

  it('reports a refused or failing registration without throwing', () => {
    const skipped = { setAsDefaultProtocolClient: vi.fn(() => true) }
    expect(registerStarAgentProtocol(skipped, null)).toBe(false)
    expect(skipped.setAsDefaultProtocolClient).not.toHaveBeenCalled()

    expect(registerStarAgentProtocol({ setAsDefaultProtocolClient: () => false }, { protocol: STAR_AGENT_PROTOCOL })).toBe(false)
    expect(registerStarAgentProtocol({
      setAsDefaultProtocolClient: () => { throw new Error('registry denied') },
    }, { protocol: STAR_AGENT_PROTOCOL })).toBe(false)
  })

  it('is declared for the installer under the same scheme', () => {
    const schemes = (manifest.build?.protocols ?? []).flatMap(protocol => protocol.schemes ?? [])
    expect(schemes).toEqual([STAR_AGENT_PROTOCOL])
  })
})

describe('opening a star-agent URL only focuses the window', () => {
  function openUrlApp() {
    let listener: ((event: { preventDefault(): void }, url: string) => void) | undefined
    const app = {
      on: vi.fn((event: 'open-url', handler: (event: { preventDefault(): void }, url: string) => void) => {
        if (event === 'open-url') listener = handler
      }),
    }
    const open = (url: string) => {
      const event = { preventDefault: vi.fn() }
      listener?.(event, url)
      return event
    }
    return { app, open }
  }

  it('macOS: focuses on open-url and ignores the path and query', () => {
    const { app, open } = openUrlApp()
    const focus = vi.fn()
    installStarAgentOpenUrlHandler(app, focus)
    expect(app.on).toHaveBeenCalledWith('open-url', expect.any(Function))

    const event = open('STAR-AGENT://open/C:/Windows/System32?cmd=calc.exe&folder=..%2F..')
    expect(event.preventDefault).toHaveBeenCalledTimes(1)
    expect(focus).toHaveBeenCalledTimes(1)
    expect(focus).toHaveBeenCalledWith()
  })

  it('macOS: leaves other URLs alone', () => {
    const { app, open } = openUrlApp()
    const focus = vi.fn()
    installStarAgentOpenUrlHandler(app, focus)

    for (const url of ['https://example.com/?star-agent://x', 'star-agentx://focus', 'file:///tmp/star-agent']) {
      expect(open(url).preventDefault).not.toHaveBeenCalled()
    }
    expect(focus).not.toHaveBeenCalled()
  })

  it('Windows/Linux: a second start carrying the URL only shows and focuses the running window', () => {
    let secondInstance: ((event: unknown, argv: string[], cwd: string) => void) | undefined
    const window = {
      isVisible: () => false,
      isMinimized: () => true,
      show: vi.fn(),
      restore: vi.fn(),
      focus: vi.fn(),
      loadURL: vi.fn(),
      webContents: { send: vi.fn() },
    }
    const app = {
      requestSingleInstanceLock: vi.fn(() => true),
      quit: vi.fn(),
      show: vi.fn(),
      on: vi.fn((_event: string, handler: typeof secondInstance) => { secondInstance = handler }),
    }

    expect(acquireSingleInstanceLock(app as never, () => window as never, {})).toBe(true)
    secondInstance?.({}, [PACKAGED_EXE, 'star-agent://open?folder=C%3A%5C&run=calc'], path.join('C:', 'Windows'))

    expect(window.show).toHaveBeenCalledTimes(1)
    expect(window.restore).toHaveBeenCalledTimes(1)
    expect(window.focus).toHaveBeenCalledTimes(1)
    expect(window.loadURL).not.toHaveBeenCalled()
    expect(window.webContents.send).not.toHaveBeenCalled()
    expect(app.quit).not.toHaveBeenCalled()
  })
})

describe('main-process wiring', () => {
  const source = readFileSync(path.join(__dirname, '..', 'main.ts'), 'utf8')

  it('handles open-url before ready, and only by focusing the main window', () => {
    const handler = source.indexOf('installStarAgentOpenUrlHandler(app, () => showMainWindow(mainWindow, app))')
    expect(handler).toBeGreaterThan(source.indexOf('if (!acquireSingleInstanceLock(app, () => mainWindow))'))
    expect(handler).toBeLessThan(source.indexOf('app.whenReady()'))
  })

  it('registers the protocol with the discovery file, for runs holding the lock', () => {
    const start = source.indexOf('function advertiseToStarCode() {')
    const end = source.indexOf('\nfunction ', start + 1)
    const body = source.slice(start, end)
    expect(body).toMatch(/^function advertiseToStarCode\(\) \{\n\s+if \(isSingleInstanceLockDisabled\(\)\) return/)
    expect(body).toContain('argv: withoutStarAgentUrls(process.argv)')
    expect(body).toContain("hasCustomUserDataDir: app.commandLine.hasSwitch('user-data-dir')")
    expect(body).toContain('registerStarAgentProtocol(app, registration)')
  })
})
