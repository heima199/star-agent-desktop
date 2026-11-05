import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { runInNewContext } from 'node:vm'
import { describe, expect, it, vi } from 'vitest'
import { applyHostArchEnv, applyWindowsAppUserModelId, applyWindowsTaskbarIdentity, HOST_ARCH_ENV, LEGACY_PRODUCT_NAMES, PRODUCT_NAME, resolveWindowsWindowIcon, WINDOWS_APP_USER_MODEL_ID } from './appIdentity'

describe('applyWindowsAppUserModelId', () => {
  it('sets the AppUserModelID on Windows so toast notifications are attributed to the app', () => {
    const setAppUserModelId = vi.fn()
    const result = applyWindowsAppUserModelId({ setAppUserModelId }, 'win32')
    expect(result).toBe(true)
    expect(setAppUserModelId).toHaveBeenCalledWith(WINDOWS_APP_USER_MODEL_ID)
  })

  it('is a no-op on macOS and Linux', () => {
    for (const platform of ['darwin', 'linux'] as const) {
      const setAppUserModelId = vi.fn()
      expect(applyWindowsAppUserModelId({ setAppUserModelId }, platform)).toBe(false)
      expect(setAppUserModelId).not.toHaveBeenCalled()
    }
  })

  it('keeps the AppUserModelID in sync with build.appId in package.json', () => {
    const packageJsonPath = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'package.json')
    const pkg = JSON.parse(readFileSync(packageJsonPath, 'utf8')) as { build?: { appId?: string } }
    expect(WINDOWS_APP_USER_MODEL_ID).toBe(pkg.build?.appId)
    expect(WINDOWS_APP_USER_MODEL_ID).toBe('cn.spkx.staragent')
  })
})

describe('PRIVO STAR WORK product identity', () => {
  const packageJsonPath = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'package.json')
  const pkg = JSON.parse(readFileSync(packageJsonPath, 'utf8')) as {
    productName?: string
    description?: string
    build?: {
      appId?: string
      productName?: string
      artifactName?: string
      publish?: unknown
      nsis?: { guid?: string }
      protocols?: { schemes?: string[] }[]
    }
  }

  it('names the app PRIVO STAR WORK for Electron at runtime and for electron-builder', () => {
    // Electron reads the top-level productName (build.productName is never seen at
    // runtime), and app.name decides the userData folder and the macOS app menu.
    expect(PRODUCT_NAME).toBe('PRIVO STAR WORK')
    expect(pkg.productName).toBe(PRODUCT_NAME)
    expect(pkg.build?.productName).toBe(PRODUCT_NAME)
    // No spaces in file names: the console and download links use them as-is.
    expect(pkg.build?.artifactName).toBe('PRIVO-STAR-WORK-${version}-${os}-${arch}.${ext}')
  })

  it('keeps the identifiers an upgrade from STAR Agent relies on', () => {
    // Taskbar pins and notifications are attributed to the appId, STAR Code opens
    // the app through star-agent://, and the NSIS guid (checked below) makes the
    // new installer replace the old install.
    expect(pkg.build?.appId).toBe('cn.spkx.staragent')
    expect(pkg.build?.protocols?.[0]?.schemes).toEqual(['star-agent'])
    expect(LEGACY_PRODUCT_NAMES[0]).toBe('STAR Agent')
  })

  it('never ships the former product name in package metadata', () => {
    expect(JSON.stringify(pkg)).not.toMatch(/claude[ _-]?code[ _-]?haha/i)
  })

  // The app numbers its own releases (1.1.0 onwards); the bundled STAR Code
  // IDE keeps its own version.
  it('ships a plain release version, at least 1.1.0', () => {
    const version = (pkg as { version?: string }).version ?? ''
    expect(version).toMatch(/^\d+\.\d+\.\d+$/)
    const [major = 0, minor = 0] = version.split('.').map(Number)
    expect(major > 1 || (major === 1 && minor >= 1)).toBe(true)
  })

  it('keeps the Windows install registration of the previous app id so an upgrade replaces it', () => {
    // electron-builder derives the NSIS registry/uninstall key from appId unless
    // `nsis.guid` is set. This is the key `com.claude-code-haha.desktop` produced;
    // without it the renamed installer would leave the old install and its
    // shortcuts behind next to the new one.
    expect(pkg.build?.nsis?.guid).toBe('f01cf2f0-8fe7-55b9-af4b-027bcf9c2cfe')
  })

  it('does not publish updates to a code host by default', () => {
    expect(pkg.build?.publish).toBeNull()
  })
})

// The console publishes one installer per chip; the local server names this
// machine's chip when it asks for the latest release.
describe('host chip for the update check', () => {
  it('hands the server the build arch', () => {
    const env: NodeJS.ProcessEnv = {}
    expect(applyHostArchEnv(env, { arch: 'x64' })).toBe('x64')
    expect(env[HOST_ARCH_ENV]).toBe('x64')
    expect(applyHostArchEnv({}, { arch: 'arm64', runningUnderARM64Translation: false })).toBe('arm64')
  })

  it('reports arm64 for an x64 build translated on an ARM machine, so the next update is native', () => {
    const env: NodeJS.ProcessEnv = {}
    expect(applyHostArchEnv(env, { arch: 'x64', runningUnderARM64Translation: true })).toBe('arm64')
    expect(env[HOST_ARCH_ENV]).toBe('arm64')
  })

  it('leaves an explicit value alone', () => {
    const env: NodeJS.ProcessEnv = { [HOST_ARCH_ENV]: 'x64' }
    expect(applyHostArchEnv(env, { arch: 'arm64', runningUnderARM64Translation: true })).toBe('x64')
    expect(env[HOST_ARCH_ENV]).toBe('x64')
  })

  it('runs in the main process before the local server starts', () => {
    const desktopDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
    const source = readFileSync(path.join(desktopDir, 'electron', 'main.ts'), 'utf8')
    const applied = source.indexOf('applyHostArchEnv(process.env, { arch: process.arch, runningUnderARM64Translation: app.runningUnderARM64Translation })')
    expect(applied).toBeGreaterThan(-1)
    expect(applied).toBeLessThan(source.indexOf('getDataMigration().recover()', applied))
  })
})

describe('Windows window and pinned taskbar identity', () => {
  function fixture() {
    const root = mkdtempSync(path.join(tmpdir(), 'electron-app-identity-'))
    const desktopRoot = path.join(root, 'resources', 'app.asar')
    const resourcesPath = path.join(root, 'resources')
    const executablePath = path.join(root, 'PRIVO STAR WORK.exe')
    const externalIcon = path.join(resourcesPath, 'app-icon.ico')
    const bundledIcon = path.join(desktopRoot, 'src-tauri', 'icons', 'icon.ico')
    const write = (file: string) => {
      mkdirSync(path.dirname(file), { recursive: true })
      writeFileSync(file, 'icon')
    }
    return { root, desktopRoot, resourcesPath, executablePath, externalIcon, bundledIcon, write }
  }

  it('uses the real resource icon for a packaged Windows window and pin', () => {
    const f = fixture()
    try {
      f.write(f.externalIcon)
      f.write(f.bundledIcon)
      const window = { setAppDetails: vi.fn() }
      expect(resolveWindowsWindowIcon(f, 'win32')).toBe(f.externalIcon)
      expect(applyWindowsTaskbarIdentity(window, { ...f, isPackaged: true }, 'win32')).toBe(true)
      expect(window.setAppDetails).toHaveBeenCalledWith({
        appId: WINDOWS_APP_USER_MODEL_ID,
        appIconPath: f.externalIcon,
        appIconIndex: 0,
        relaunchCommand: `"${f.executablePath}"`,
        relaunchDisplayName: 'PRIVO STAR WORK',
      })
    } finally {
      rmSync(f.root, { recursive: true, force: true })
    }
  })

  it('falls back to the bundled window icon while keeping ASAR paths away from the Windows shell', () => {
    const f = fixture()
    try {
      f.write(f.bundledIcon)
      const window = { setAppDetails: vi.fn() }
      expect(resolveWindowsWindowIcon(f, 'win32')).toBe(f.bundledIcon)
      applyWindowsTaskbarIdentity(window, { ...f, isPackaged: true }, 'win32')
      expect(window.setAppDetails.mock.calls[0]?.[0].appIconPath).toBe(f.executablePath)
    } finally {
      rmSync(f.root, { recursive: true, force: true })
    }
  })

  it('leaves pin relaunch metadata alone for development runs and other platforms', () => {
    const f = fixture()
    try {
      f.write(f.bundledIcon)
      const window = { setAppDetails: vi.fn() }
      expect(resolveWindowsWindowIcon(f, 'win32')).toBe(f.bundledIcon)
      expect(applyWindowsTaskbarIdentity(window, { ...f, isPackaged: false }, 'win32')).toBe(false)
      for (const platform of ['darwin', 'linux'] as const) {
        expect(resolveWindowsWindowIcon(f, platform)).toBeUndefined()
        expect(applyWindowsTaskbarIdentity(window, { ...f, isPackaged: true }, platform)).toBe(false)
      }
      expect(window.setAppDetails).not.toHaveBeenCalled()
    } finally {
      rmSync(f.root, { recursive: true, force: true })
    }
  })

  it('does not fail startup when an icon is absent', () => {
    const f = fixture()
    try {
      const window = { setAppDetails: vi.fn() }
      expect(resolveWindowsWindowIcon(f, 'win32')).toBeUndefined()
      expect(() => applyWindowsTaskbarIdentity(window, { ...f, isPackaged: true }, 'win32')).not.toThrow()
      expect(window.setAppDetails.mock.calls[0]?.[0].appIconPath).toBe(f.executablePath)
    } finally {
      rmSync(f.root, { recursive: true, force: true })
    }
  })

  it('applies both identities to the actual main-window construction before it is shown', async () => {
    const f = fixture()
    try {
      f.write(f.externalIcon)
      const desktopDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
      const source = readFileSync(path.join(desktopDir, 'electron', 'main.ts'), 'utf8')
      const start = source.indexOf('async function createMainWindow()')
      const end = source.indexOf('  // Before any guest can exist:', start)
      const window = { setAppDetails: vi.fn() }
      const BrowserWindow = vi.fn(function (_options: unknown) { return window })
      const context = {
        app: { isPackaged: true },
        process: { resourcesPath: f.resourcesPath, execPath: f.executablePath, platform: 'win32' },
        appRoot: () => f.desktopRoot,
        mainWindow: null,
        screen: { getAllDisplays: () => [] },
        readWindowState: () => null,
        windowOptionsFromState: () => ({}),
        windowChromeOptionsForPlatform: () => ({}),
        resolveStartupWindowBackground: () => '#ffffff',
        preloadPath: () => 'preload.cjs',
        MIN_WINDOW_WIDTH: 400,
        MIN_WINDOW_HEIGHT: 300,
        BrowserWindow,
        resolveWindowsWindowIcon: (paths: Parameters<typeof resolveWindowsWindowIcon>[0]) => resolveWindowsWindowIcon(paths, 'win32'),
        applyWindowsTaskbarIdentity: (host: Parameters<typeof applyWindowsTaskbarIdentity>[0], paths: Parameters<typeof applyWindowsTaskbarIdentity>[1]) => applyWindowsTaskbarIdentity(host, paths, 'win32'),
        createMainWindow: undefined as undefined | (() => Promise<unknown>),
      }
      await runInNewContext(`${source.slice(start, end)}\n}`, context)
      await context.createMainWindow!()
      expect(BrowserWindow.mock.calls[0]?.[0]).toMatchObject({ show: false, icon: f.externalIcon })
      expect(window.setAppDetails.mock.calls[0]?.[0]).toMatchObject({ appId: WINDOWS_APP_USER_MODEL_ID, appIconPath: f.externalIcon })
    } finally {
      rmSync(f.root, { recursive: true, force: true })
    }
  })
})
