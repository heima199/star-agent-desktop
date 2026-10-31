import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { App } from 'electron'

vi.mock('electron', () => ({
  powerSaveBlocker: { start: () => 1, stop: () => {}, isStarted: () => false },
}))

import { applySystemPrefs, DEFAULT_SYSTEM_PREFS, readSystemPrefs, updateSystemPrefs } from './systemPrefs'

const dirs: string[] = []

function fakeApp(isPackaged: boolean, stored?: Record<string, unknown>) {
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'star-prefs-'))
  dirs.push(userData)
  if (stored) fs.writeFileSync(path.join(userData, 'star-system-prefs.json'), JSON.stringify(stored), 'utf8')
  const setLoginItemSettings = vi.fn()
  const app = { isPackaged, getPath: () => userData, setLoginItemSettings } as unknown as App
  return { app, setLoginItemSettings, userData }
}

const loginItemsSupported = process.platform === 'win32' || process.platform === 'darwin'

describe('system prefs', () => {
  afterEach(() => {
    for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true })
  })

  // 开机自动启动 默认安装就开启.
  it('starts at login on a fresh install', () => {
    expect(DEFAULT_SYSTEM_PREFS.openAtLogin).toBe(true)
    const { app, setLoginItemSettings } = fakeApp(true)

    expect(readSystemPrefs(app)).toEqual({ openAtLogin: true, closeToTray: true, preventSleep: false })
    applySystemPrefs(app)
    if (loginItemsSupported) expect(setLoginItemSettings).toHaveBeenCalledWith({ openAtLogin: true })
    else expect(setLoginItemSettings).not.toHaveBeenCalled()
  })

  it('keeps a user who turned it off out of the login items', () => {
    const { app, setLoginItemSettings } = fakeApp(true, { openAtLogin: false, closeToTray: false })

    expect(readSystemPrefs(app)).toEqual({ openAtLogin: false, closeToTray: false, preventSleep: false })
    applySystemPrefs(app)
    if (loginItemsSupported) expect(setLoginItemSettings).toHaveBeenCalledWith({ openAtLogin: false })
  })

  it('never registers a dev run, which would point at the bare electron binary', () => {
    const { app, setLoginItemSettings } = fakeApp(false)

    applySystemPrefs(app)
    expect(readSystemPrefs(app).openAtLogin).toBe(true)
    expect(setLoginItemSettings).not.toHaveBeenCalled()
  })

  it('stores a change and reads it back for the same profile only', () => {
    const first = fakeApp(true)
    updateSystemPrefs(first.app, { openAtLogin: false })
    expect(JSON.parse(fs.readFileSync(path.join(first.userData, 'star-system-prefs.json'), 'utf8'))).toMatchObject({ openAtLogin: false })
    expect(readSystemPrefs(first.app).openAtLogin).toBe(false)

    // Another userData directory does not inherit the first one's cached choice.
    const second = fakeApp(true)
    expect(readSystemPrefs(second.app).openAtLogin).toBe(true)
  })
})
