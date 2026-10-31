import { existsSync } from 'node:fs'
import path from 'node:path'

/**
 * STAR Code, the IDE built on Code-OSS, ships inside this app's installer and
 * runs as its own application window. The installer puts it under
 * `resources/star-code` (see `stage:star-code` and electron-builder's
 * `extraResources`); the server finds it through this variable, which it reads
 * in src/server/services/openTargetService.ts.
 */
export const BUNDLED_STAR_CODE_ENV = 'CC_HAHA_STAR_CODE_PATH'
/** Directory under `process.resourcesPath` that holds the bundled IDE. */
export const BUNDLED_STAR_CODE_DIR = 'star-code'

export function bundledStarCodeExecutable(resourcesPath: string, platform: NodeJS.Platform): string {
  const root = path.join(resourcesPath, BUNDLED_STAR_CODE_DIR)
  if (platform === 'win32') return path.join(root, 'STAR Code.exe')
  if (platform === 'darwin') return path.join(root, 'STAR Code.app')
  return path.join(root, 'star-code')
}

/**
 * Points the server at the bundled IDE when this is an installed build that
 * carries one. A development run has no bundle and keeps whatever STAR Code is
 * installed on the machine; an explicit value is left alone.
 */
/**
 * The IDE's title-bar "Agent" button brings this app back to the front. The IDE
 * inherits this variable from the server that launches it and starts this
 * executable again; the single-instance lock turns that into focusing the
 * existing window. Only an installed build has a stable executable to point
 * at: in development `process.execPath` is the bare Electron binary.
 */
export const STAR_AGENT_EXECUTABLE_ENV = 'STAR_AGENT_EXECUTABLE'

export function applyStarAgentExecutableEnv(
  env: NodeJS.ProcessEnv,
  options: { isPackaged: boolean; execPath: string },
): string | null {
  if (env[STAR_AGENT_EXECUTABLE_ENV]?.trim()) return env[STAR_AGENT_EXECUTABLE_ENV]!.trim()
  if (!options.isPackaged || !options.execPath) return null
  env[STAR_AGENT_EXECUTABLE_ENV] = options.execPath
  return options.execPath
}

export function applyBundledStarCodeEnv(
  env: NodeJS.ProcessEnv,
  options: { isPackaged: boolean; resourcesPath: string; platform: NodeJS.Platform; exists?: (target: string) => boolean },
): string | null {
  if (env[BUNDLED_STAR_CODE_ENV]?.trim()) return env[BUNDLED_STAR_CODE_ENV]!.trim()
  if (!options.isPackaged) return null
  const executable = bundledStarCodeExecutable(options.resourcesPath, options.platform)
  if (!(options.exists ?? existsSync)(executable)) return null
  env[BUNDLED_STAR_CODE_ENV] = executable
  return executable
}
