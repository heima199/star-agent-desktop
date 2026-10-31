import { readFileSync } from 'node:fs'
import path from 'node:path'

export type AppVersionInput = {
  isPackaged: boolean
  /** `app.getVersion()`. */
  appVersion: string
  /** The folder holding the app's package.json (the desktop folder in development). */
  appRoot: string
  readFile?: (file: string) => string
}

/**
 * The version this app reports: About page, update check and the discovery
 * file STAR Code reads. A packaged build carries it in its own metadata. A
 * development run starts the bare Electron binary with a script path, so
 * Electron never reads desktop/package.json and `app.getVersion()` is
 * Electron's own version; the package version is read from the app root then.
 */
export function resolveAppVersion(input: AppVersionInput): string {
  if (input.isPackaged) return input.appVersion
  try {
    const read = input.readFile ?? ((file: string) => readFileSync(file, 'utf8'))
    const pkg = JSON.parse(read(path.join(input.appRoot, 'package.json'))) as { version?: unknown }
    if (typeof pkg.version === 'string' && pkg.version.trim()) return pkg.version.trim()
  } catch {
    // No readable package.json next to the entry script: keep Electron's answer.
  }
  return input.appVersion
}
