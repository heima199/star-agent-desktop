import type { App, BrowserWindow } from 'electron'
import { showMainWindow } from './windows'

/**
 * Only validation runs opt out, explicitly. Every other launch, installed or
 * development (`electron.exe ./electron-dist/main.cjs`, whose lock is keyed on
 * its own userData folder), is single-instance.
 */
export function isSingleInstanceLockDisabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.CC_HAHA_ELECTRON_DISABLE_SINGLE_INSTANCE_LOCK === '1'
}

/**
 * A second start (for example STAR Code's "Agent" button) quits right away and
 * the running instance shows and focuses its window instead.
 */
export function acquireSingleInstanceLock(
  app: App,
  getMainWindow: () => BrowserWindow | null,
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  if (isSingleInstanceLockDisabled(env)) {
    return true
  }

  const hasLock = app.requestSingleInstanceLock()
  if (!hasLock) {
    app.quit()
    return false
  }

  app.on('second-instance', () => {
    showMainWindow(getMainWindow(), app)
  })

  return true
}
