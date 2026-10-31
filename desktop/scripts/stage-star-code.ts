#!/usr/bin/env bun
/**
 * Copies a STAR Code (Code-OSS) build into `build-resources/star-code`, where
 * electron-builder's `extraResources` picks it up: the installer then ships the
 * IDE next to this app, and the IDE button opens projects in that copy as its
 * own window (see electron/services/starCodeBundle.ts).
 *
 *   STAR_CODE_BUILD_DIR=<dir> bun run stage:star-code
 *   bun run stage:star-code --from <dir>
 *
 * `<dir>` is the output of the Code-OSS packaging task, e.g. `gulp
 * vscode-win32-x64` → `VSCode-win32-x64`. Without a build, a copy staged
 * earlier is shipped as is; with neither, packaging stops, so an installer
 * never goes out without the IDE by accident. Pass `--optional` to only warn
 * in that case (a build that intentionally ships without the IDE).
 */
import { cpSync, existsSync, rmSync, statSync } from 'node:fs'
import path from 'node:path'

export const STAR_CODE_BUILD_DIR_ENV = 'STAR_CODE_BUILD_DIR'

/** The file a usable build must contain, per platform. */
export function starCodeEntryName(platform: NodeJS.Platform): string {
  if (platform === 'win32') return 'STAR Code.exe'
  if (platform === 'darwin') return 'STAR Code.app'
  return 'star-code'
}

export function resolveStarCodeBuildDir(argv: string[], env: NodeJS.ProcessEnv): string | null {
  const flag = argv.indexOf('--from')
  const fromArg = flag >= 0 ? argv[flag + 1] : undefined
  const value = (fromArg ?? env[STAR_CODE_BUILD_DIR_ENV])?.trim()
  return value ? path.resolve(value) : null
}

export type StageResult =
  | { ok: true; from: string; to: string }
  /** No build given, but `to` already holds a staged build: packaging ships that one. */
  | { ok: true; reused: true; to: string }
  | { ok: false; error: string }

export function stageStarCode(options: {
  from: string | null
  to: string
  platform: NodeJS.Platform
  exists?: (target: string) => boolean
  isDirectory?: (target: string) => boolean
  copy?: (from: string, to: string) => void
  remove?: (target: string) => void
}): StageResult {
  const exists = options.exists ?? existsSync
  const isDirectory = options.isDirectory ?? ((target: string) => statSync(target).isDirectory())
  if (!options.from) {
    if (exists(path.join(options.to, starCodeEntryName(options.platform)))) {
      return { ok: true, reused: true, to: options.to }
    }
    return { ok: false, error: `no STAR Code build given: set ${STAR_CODE_BUILD_DIR_ENV} or pass --from <dir>` }
  }
  if (!exists(options.from) || !isDirectory(options.from)) {
    return { ok: false, error: `${options.from} is not a directory` }
  }
  const entry = path.join(options.from, starCodeEntryName(options.platform))
  if (!exists(entry)) {
    return { ok: false, error: `${entry} is missing; is ${options.from} a packaged STAR Code build?` }
  }
  ;(options.remove ?? ((target: string) => rmSync(target, { recursive: true, force: true })))(options.to)
  ;(options.copy ?? ((from: string, to: string) => cpSync(from, to, { recursive: true })))(options.from, options.to)
  return { ok: true, from: options.from, to: options.to }
}

if (import.meta.main) {
  const desktopRoot = path.resolve(import.meta.dir, '..')
  const optional = process.argv.includes('--optional')
  const result = stageStarCode({
    from: resolveStarCodeBuildDir(process.argv, process.env),
    to: path.join(desktopRoot, 'build-resources', 'star-code'),
    platform: process.platform,
  })
  if (result.ok && 'reused' in result) {
    const stagedAt = statSync(result.to).mtime.toLocaleString()
    console.log(`[stage-star-code] no new build given; shipping the copy already staged in ${result.to} (${stagedAt})`)
  } else if (result.ok) {
    console.log(`[stage-star-code] copied ${result.from} -> ${result.to}`)
  } else if (optional) {
    console.warn(`[stage-star-code] skipped: ${result.error}. The installer will not include the IDE.`)
  } else {
    console.error(`[stage-star-code] ${result.error}`)
    process.exit(1)
  }
}
