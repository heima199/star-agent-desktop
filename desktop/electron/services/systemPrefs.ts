import * as fs from 'node:fs'
import * as path from 'node:path'
import { powerSaveBlocker, type App } from 'electron'

/**
 * Desktop-level switches of the 通用 settings page: launch at login, close to
 * tray and keeping the computer awake. Stored next to the window state in
 * userData; the main process applies them at startup and on every change.
 */
export type SystemPrefs = {
  openAtLogin: boolean
  closeToTray: boolean
  preventSleep: boolean
}

export type SystemPrefsState = SystemPrefs & {
  /** Launch at login registers the installed executable; dev runs only store the choice. */
  openAtLoginSupported: boolean
}

/**
 * A fresh install starts at login (the installed app registers itself on its
 * first start); turning it off in 通用 is stored and wins from then on.
 */
export const DEFAULT_SYSTEM_PREFS: Readonly<SystemPrefs> = { openAtLogin: true, closeToTray: true, preventSleep: false }
const FILE_NAME = 'star-system-prefs.json'

/** Keyed by the prefs file, so a different userData directory never reads another one's values. */
let cached: { file: string; prefs: SystemPrefs } | null = null
let blockerId: number | null = null

function prefsFile(app: App): string {
  return path.join(app.getPath('userData'), FILE_NAME)
}

export function readSystemPrefs(app: App): SystemPrefs {
  const file = prefsFile(app)
  if (cached?.file === file) return cached.prefs
  let stored: Partial<SystemPrefs> = {}
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8')) as unknown
    if (parsed && typeof parsed === 'object') stored = parsed as Partial<SystemPrefs>
  } catch { /* first run or unreadable: defaults */ }
  const prefs: SystemPrefs = {
    openAtLogin: typeof stored.openAtLogin === 'boolean' ? stored.openAtLogin : DEFAULT_SYSTEM_PREFS.openAtLogin,
    closeToTray: typeof stored.closeToTray === 'boolean' ? stored.closeToTray : DEFAULT_SYSTEM_PREFS.closeToTray,
    preventSleep: typeof stored.preventSleep === 'boolean' ? stored.preventSleep : DEFAULT_SYSTEM_PREFS.preventSleep,
  }
  cached = { file, prefs }
  return prefs
}

function applyPreventSleep(enabled: boolean): void {
  if (enabled && blockerId === null) {
    blockerId = powerSaveBlocker.start('prevent-app-suspension')
  } else if (!enabled && blockerId !== null) {
    if (powerSaveBlocker.isStarted(blockerId)) powerSaveBlocker.stop(blockerId)
    blockerId = null
  }
}

function applyOpenAtLogin(app: App, enabled: boolean): void {
  // In a dev run this would register the bare electron.exe, so only the
  // installed app touches the login items.
  if (!app.isPackaged || (process.platform !== 'win32' && process.platform !== 'darwin')) return
  try {
    app.setLoginItemSettings({ openAtLogin: enabled })
  } catch (error) {
    console.error('[desktop] failed to update login item', error)
  }
}

export function applySystemPrefs(app: App): void {
  const prefs = readSystemPrefs(app)
  applyPreventSleep(prefs.preventSleep)
  applyOpenAtLogin(app, prefs.openAtLogin)
}

export function systemPrefsState(app: App): SystemPrefsState {
  return { ...readSystemPrefs(app), openAtLoginSupported: app.isPackaged }
}

export function updateSystemPrefs(app: App, patch: Partial<SystemPrefs>): SystemPrefsState {
  const next: SystemPrefs = { ...readSystemPrefs(app) }
  if (typeof patch.openAtLogin === 'boolean') next.openAtLogin = patch.openAtLogin
  if (typeof patch.closeToTray === 'boolean') next.closeToTray = patch.closeToTray
  if (typeof patch.preventSleep === 'boolean') next.preventSleep = patch.preventSleep
  const file = prefsFile(app)
  cached = { file, prefs: next }
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.writeFileSync(file, JSON.stringify(next, null, 2), 'utf8')
  } catch (error) {
    console.error('[desktop] failed to save system prefs', error)
  }
  if (typeof patch.preventSleep === 'boolean') applyPreventSleep(next.preventSleep)
  if (typeof patch.openAtLogin === 'boolean') applyOpenAtLogin(app, next.openAtLogin)
  return systemPrefsState(app)
}
