import { readdirSync, renameSync, rmdirSync, statSync } from 'node:fs'
import path from 'node:path'
import { PRODUCT_NAME } from './appIdentity'

/**
 * Folder names earlier builds used for Electron's userData (window state,
 * app-mode.json, Local Storage, preferences), in the order they are tried.
 * Electron names that folder after package.json's top-level `productName`,
 * falling back to `name`.
 * - "STAR Agent": 1.0.0–1.1.x, before the rename to PRIVO STAR WORK (1.2.0).
 *   Every current user has this one, so it comes first.
 * - "claude-code-desktop": before productName moved to the top level of
 *   package.json it only lived under `build`, which Electron never reads, so
 *   packaged builds used the package name.
 * - "Claude Code Haha": the former product name, which the installer and
 *   electron-builder's uninstaller assumed.
 */
export const LEGACY_USER_DATA_DIR_NAMES = ['STAR Agent', 'claude-code-desktop', 'Claude Code Haha'] as const

/** `unknown`: it exists but could not be inspected (permissions, I/O error). */
export type UserDataDirState = 'missing' | 'empty' | 'populated' | 'unknown'

export type UserDataLocationInput = {
  /** `app.name`, already derived from package.json by Electron. */
  appName: string
  /** `app.getPath('appData')`. */
  appDataDir: string
  /** True when the run was given `--user-data-dir`. */
  hasCustomUserDataDir: boolean
  stateOf: (dir: string) => UserDataDirState
  productName?: string
  legacyNames?: readonly string[]
}

export type UserDataLocationPlan =
  | { action: 'keep' }
  | { action: 'adopt', legacyDir: string, targetDir: string, targetIsEmptyDir: boolean }

/**
 * Decides whether this launch should take over the userData folder an older
 * build left under its former name. Pure: all file-system knowledge comes in
 * through `stateOf`.
 */
export function planUserDataLocation(input: UserDataLocationInput): UserDataLocationPlan {
  const productName = input.productName ?? PRODUCT_NAME
  // A run given --user-data-dir (tests, smoke runs, separate profiles) owns its
  // folder, and an unbranded development run (app.name is "Electron") does not
  // use the product folder at all. Neither may move user data around.
  if (input.hasCustomUserDataDir || input.appName !== productName) return { action: 'keep' }

  const targetDir = path.join(input.appDataDir, productName)
  const targetState = input.stateOf(targetDir)
  // The current folder is in use (or cannot be inspected): never merge into it.
  if (targetState === 'populated' || targetState === 'unknown') return { action: 'keep' }

  for (const name of input.legacyNames ?? LEGACY_USER_DATA_DIR_NAMES) {
    if (name.toLowerCase() === productName.toLowerCase()) continue
    const legacyDir = path.join(input.appDataDir, name)
    if (input.stateOf(legacyDir) === 'populated') {
      return { action: 'adopt', legacyDir, targetDir, targetIsEmptyDir: targetState === 'empty' }
    }
  }
  return { action: 'keep' }
}

export type UserDataLocationResult =
  | { kind: 'unchanged' }
  | { kind: 'moved', from: string, to: string }
  | { kind: 'legacy-in-place', dir: string, reason: string }

export type UserDataLocationApp = {
  name: string
  getPath(name: 'appData'): string
  setPath(name: 'userData', value: string): void
  commandLine: { hasSwitch(name: string): boolean }
}

export type UserDataLocationFs = {
  stateOf(dir: string): UserDataDirState
  /** Must refuse to delete a directory that has content. */
  removeEmptyDir(dir: string): void
  rename(from: string, to: string): void
}

export const nodeUserDataLocationFs: UserDataLocationFs = {
  stateOf(dir) {
    try {
      // Something other than a directory in the way is left alone.
      if (!statSync(dir).isDirectory()) return 'unknown'
      return readdirSync(dir).length === 0 ? 'empty' : 'populated'
    } catch (error) {
      return (error as NodeJS.ErrnoException | null)?.code === 'ENOENT' ? 'missing' : 'unknown'
    }
  },
  // Non-recursive: rmdir fails on anything that is not empty.
  removeEmptyDir: dir => rmdirSync(dir),
  rename: (from, to) => renameSync(from, to),
}

/**
 * Must run before anything reads userData, the single-instance lock included
 * (Chromium keys it on that folder). Calling `app.getPath('userData')` first
 * would create an empty current folder, which is why an empty one still counts
 * as free.
 */
export function applyUserDataLocation(
  app: UserDataLocationApp,
  fs: UserDataLocationFs = nodeUserDataLocationFs,
): UserDataLocationResult {
  const plan = planUserDataLocation({
    appName: app.name,
    appDataDir: app.getPath('appData'),
    hasCustomUserDataDir: app.commandLine.hasSwitch('user-data-dir'),
    stateOf: dir => fs.stateOf(dir),
  })
  if (plan.action === 'keep') return { kind: 'unchanged' }

  try {
    if (plan.targetIsEmptyDir) fs.removeEmptyDir(plan.targetDir)
    fs.rename(plan.legacyDir, plan.targetDir)
    return { kind: 'moved', from: plan.legacyDir, to: plan.targetDir }
  } catch (error) {
    // Usually a file an older copy still holds open. Use the old folder in place
    // for this run; the move is tried again on the next launch.
    app.setPath('userData', plan.legacyDir)
    const code = (error as NodeJS.ErrnoException | null)?.code
    return { kind: 'legacy-in-place', dir: plan.legacyDir, reason: typeof code === 'string' ? code : 'error' }
  }
}

/** A host diagnostic line; folder names only, so no user path ends up in logs. */
export function describeUserDataLocation(result: UserDataLocationResult): string | null {
  if (result.kind === 'moved') {
    return `[user-data] moved "${path.basename(result.from)}" to "${path.basename(result.to)}"`
  }
  if (result.kind === 'legacy-in-place') {
    return `[user-data] using "${path.basename(result.dir)}" in place (${result.reason}); the move is retried on the next launch`
  }
  return null
}
