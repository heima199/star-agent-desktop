import { existsSync } from 'node:fs'
import path from 'node:path'
import type { BrowserWindow } from 'electron'

export type AppUserModelIdHost = {
  setAppUserModelId(id: string): void
}

// Must stay in sync with build.appId in desktop/package.json. Windows attributes
// toast notifications (and taskbar pinning) to this AppUserModelID; without an
// explicit call, notifications from a dev/unpackaged run can silently fail to show.
export const WINDOWS_APP_USER_MODEL_ID = 'cn.spkx.staragent'

// Must stay in sync with productName in desktop/package.json: the name the OS shows
// for this app (executable, shortcuts, tray, taskbar pin, macOS app menu).
export const PRODUCT_NAME = 'STAR Agent'

/**
 * The machine's chip, for the local server: it names it to the STAR console
 * when asking for the latest release, so an x64 PC gets the x64 installer and
 * an ARM one the arm64 installer. An x64 build running translated on an ARM
 * machine (Rosetta on Apple silicon, emulation on Windows on ARM) reports
 * arm64, so its next update is the native build.
 */
export const HOST_ARCH_ENV = 'CC_HAHA_HOST_ARCH'

export function applyHostArchEnv(
  env: NodeJS.ProcessEnv,
  host: { arch: string, runningUnderARM64Translation?: boolean },
): string {
  const explicit = env[HOST_ARCH_ENV]?.trim()
  if (explicit) return explicit
  const arch = host.runningUnderARM64Translation ? 'arm64' : host.arch
  env[HOST_ARCH_ENV] = arch
  return arch
}

export function applyWindowsAppUserModelId(
  app: AppUserModelIdHost,
  platform: NodeJS.Platform = process.platform,
  appUserModelId: string = WINDOWS_APP_USER_MODEL_ID,
): boolean {
  if (platform !== 'win32') return false
  app.setAppUserModelId(appUserModelId)
  return true
}

type WindowsIconPaths = {
  desktopRoot: string
  resourcesPath: string
}

// BrowserWindow can read the bundled icon through Electron's ASAR-aware file
// APIs, but Explorer cannot. Keep a real ICO beside app.asar for new taskbar pins.
export function resolveWindowsWindowIcon(
  paths: WindowsIconPaths,
  platform: NodeJS.Platform = process.platform,
): string | undefined {
  if (platform !== 'win32') return undefined
  return [
    path.join(paths.resourcesPath, 'app-icon.ico'),
    path.join(paths.desktopRoot, 'src-tauri', 'icons', 'icon.ico'),
  ].find(candidate => existsSync(candidate))
}

export function applyWindowsTaskbarIdentity(
  window: Pick<BrowserWindow, 'setAppDetails'>,
  paths: WindowsIconPaths & { isPackaged: boolean, executablePath: string },
  platform: NodeJS.Platform = process.platform,
): boolean {
  // A development launch targets electron.exe and needs the entry script and
  // dev-server environment. Do not turn its button into a production shortcut.
  if (platform !== 'win32' || !paths.isPackaged) return false
  const externalIcon = path.join(paths.resourcesPath, 'app-icon.ico')
  window.setAppDetails({
    appId: WINDOWS_APP_USER_MODEL_ID,
    appIconPath: existsSync(externalIcon) ? externalIcon : paths.executablePath,
    appIconIndex: 0,
    relaunchCommand: `"${paths.executablePath}"`,
    relaunchDisplayName: PRODUCT_NAME,
  })
  return true
}
