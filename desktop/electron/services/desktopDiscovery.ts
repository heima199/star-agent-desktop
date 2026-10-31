import { mkdirSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import path from 'node:path'

/**
 * How STAR Code (the IDE shipped in the same installer) finds this app: its
 * title-bar "Agent" button reads this file and starts `executable` with `args`
 * in `cwd`. Starting it again while it runs only focuses the running window,
 * because the app is single-instance (see singleInstance.ts). The IDE side
 * parses it in void/src/vs/workbench/contrib/void/common/starAgentLocator.ts.
 */
export type DesktopDiscoveryRecord = {
  executable: string
  args: string[]
  cwd: string
  pid: number
  version: string
  updatedAt: number
}

/** `<CLAUDE_CONFIG_DIR or ~/.claude>/cc-haha/star/desktop-app.json`, next to the STAR session. */
export function desktopDiscoveryFile(env: NodeJS.ProcessEnv = process.env, homeDir: string = homedir()): string {
  const configDir = env.CLAUDE_CONFIG_DIR?.trim() || path.join(homeDir, '.claude')
  return path.join(configDir, 'cc-haha', 'star', 'desktop-app.json')
}

/** Debug switches whose value may follow as the next argument (`--remote-debugging-port 9352`). */
const DEBUG_SWITCHES_WITH_VALUE = new Set(['--remote-debugging-port', '--inspect-port'])

/**
 * Drops Chromium's `--remote-debugging-*` and Node's `--inspect*` switches: a
 * second start with them would compete for the same debugging port.
 */
export function stripDebugArgs(args: readonly string[]): string[] {
  const out: string[] = []
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]!
    if (/^--(remote-debugging-|inspect)/i.test(arg)) {
      if (DEBUG_SWITCHES_WITH_VALUE.has(arg.toLowerCase()) && /^\d+$/.test(args[index + 1] ?? '')) index += 1
      continue
    }
    out.push(arg)
  }
  return out
}

export type DesktopDiscoveryInput = {
  isPackaged: boolean
  /** `process.execPath`: the installed exe, or electron.exe in development. */
  execPath: string
  /** `process.argv`, the executable included. */
  argv: readonly string[]
  /** `process.cwd()`. */
  cwd: string
  pid: number
  version: string
  now?: number
}

/**
 * A development run is `electron.exe ./electron-dist/main.cjs` started in the
 * desktop folder, so it is started again from the same folder. An installed
 * build is started from its install folder, whatever folder launched it.
 */
export function buildDesktopDiscoveryRecord(input: DesktopDiscoveryInput): DesktopDiscoveryRecord {
  return {
    executable: input.execPath,
    args: stripDebugArgs(input.argv.slice(1)),
    cwd: input.isPackaged ? path.dirname(input.execPath) : input.cwd,
    pid: input.pid,
    version: input.version,
    updatedAt: input.now ?? Date.now(),
  }
}

export type DiscoveryFs = {
  mkdir(dir: string): void
  writeFile(file: string, content: string): void
  rename(from: string, to: string): void
  remove(file: string): void
}

const nodeDiscoveryFs: DiscoveryFs = {
  mkdir: dir => { mkdirSync(dir, { recursive: true }) },
  writeFile: (file, content) => writeFileSync(file, content, 'utf8'),
  rename: (from, to) => renameSync(from, to),
  remove: file => rmSync(file, { force: true }),
}

/**
 * Replaces the file atomically (temp file + rename), so the IDE never reads a
 * half-written one. Never throws: startup must not depend on it. Returns the
 * error code when the file could not be written, null on success.
 */
export function writeDesktopDiscoveryFile(
  record: DesktopDiscoveryRecord,
  file: string,
  fs: DiscoveryFs = nodeDiscoveryFs,
): string | null {
  const temp = `${file}.${record.pid}.tmp`
  try {
    fs.mkdir(path.dirname(file))
    fs.writeFile(temp, `${JSON.stringify(record, null, 2)}\n`)
    fs.rename(temp, file)
    return null
  } catch (error) {
    try {
      fs.remove(temp)
    } catch {
      // Nothing more to clean up.
    }
    const code = (error as NodeJS.ErrnoException | null)?.code
    return typeof code === 'string' ? code : 'error'
  }
}
