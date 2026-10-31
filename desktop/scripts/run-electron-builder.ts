#!/usr/bin/env bun
/**
 * Runs electron-builder with package.json's config, plus the STAR update feed
 * when STAR_UPDATE_URL is set (see electron/services/starUpdateFeed.ts). The
 * feed lands in the packaged app-update.yml and latest*.yml is written next to
 * the installers. Without the variable the build ships no updater config and
 * the app never checks for updates online.
 */
import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { starUpdatePublishArgs } from '../electron/services/starUpdateFeed'

export function electronBuilderArgs(argv: readonly string[], env: NodeJS.ProcessEnv = process.env): string[] {
  return [...argv, ...starUpdatePublishArgs(env)]
}

if (import.meta.main) {
  const desktopDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
  const cli = path.join(desktopDir, 'node_modules', 'electron-builder', 'out', 'cli', 'cli.js')
  const argv = process.argv.slice(2)
  const args = electronBuilderArgs(argv)
  console.log(args.length > argv.length
    ? '[run-electron-builder] STAR update feed configured; publishing update metadata for it'
    : '[run-electron-builder] no STAR_UPDATE_URL; building without online updates')
  const result = spawnSync('node', [cli, ...args], { cwd: desktopDir, stdio: 'inherit' })
  if (result.error) console.error(`[run-electron-builder] could not start electron-builder: ${result.error.message}`)
  process.exit(result.status ?? 1)
}
