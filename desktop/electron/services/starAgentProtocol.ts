import path from 'node:path'
import { stripDebugArgs } from './desktopDiscovery'

/**
 * `star-agent://…` brings this app to the front, so STAR Code's "Agent" button
 * needs no install path. Any web page or document can open such a URL, so it is
 * untrusted input: only its scheme is looked at, and opening one only shows and
 * focuses the main window. Its path, query and everything else are ignored.
 */
export const STAR_AGENT_PROTOCOL = 'star-agent'

const STAR_AGENT_URL = /^star-agent:/i

/** True for a `star-agent:` URL in any letter case (URL schemes are case-insensitive). */
export function isStarAgentUrl(value: unknown): boolean {
  return typeof value === 'string' && STAR_AGENT_URL.test(value)
}

/**
 * Windows and Linux pass the URL on the command line: in `process.argv` of the
 * start it launched (which shows its window anyway), or in the argv of the
 * `second-instance` event (which only focuses, see singleInstance.ts). Chromium
 * may reorder that list and add switches, so every entry is checked. The
 * content is never stored or replayed.
 */
export function withoutStarAgentUrls(argv: readonly string[]): string[] {
  return argv.filter(arg => !isStarAgentUrl(arg))
}

/**
 * The app entry of a development run (`electron.exe [switches] ./electron-dist/main.cjs`):
 * the first argument that is neither a switch nor a URL.
 */
export function devAppEntryArg(argv: readonly string[]): string | null {
  return stripDebugArgs(argv.slice(1)).find(arg => !arg.startsWith('-') && !isStarAgentUrl(arg)) ?? null
}

export type StarAgentProtocolRegistration = {
  protocol: typeof STAR_AGENT_PROTOCOL
  /** Development runs only: electron.exe and the app entry it has to start. */
  executable?: string
  args?: string[]
}

export type StarAgentProtocolRegistrationInput = {
  isPackaged: boolean
  /** `process.execPath`: the installed exe, or electron.exe in development. */
  execPath: string
  /** `process.argv`, the executable included. */
  argv: readonly string[]
  /** `process.cwd()`, to resolve a relative development entry. */
  cwd: string
  /** Validation runs: a second start never reaches them, so they must not take the protocol. */
  singleInstanceLockDisabled: boolean
  /**
   * `--user-data-dir` runs (tests, smoke runs, separate profiles): the OS starts
   * the protocol handler without that switch, so it would never reach them either.
   */
  hasCustomUserDataDir: boolean
}

/**
 * What to pass to `app.setAsDefaultProtocolClient`, or null when this run must
 * not register. An installed build registers itself (Electron uses its exe). A
 * development run has to name electron.exe and the absolute app entry, otherwise
 * the OS would start bare Electron instead of this app.
 */
export function starAgentProtocolRegistration(input: StarAgentProtocolRegistrationInput): StarAgentProtocolRegistration | null {
  if (input.singleInstanceLockDisabled || input.hasCustomUserDataDir) return null
  if (input.isPackaged) return { protocol: STAR_AGENT_PROTOCOL }
  const entry = devAppEntryArg(input.argv)
  if (!entry) return null
  return { protocol: STAR_AGENT_PROTOCOL, executable: input.execPath, args: [path.resolve(input.cwd, entry)] }
}

export type ProtocolClientApp = {
  setAsDefaultProtocolClient(protocol: string, path?: string, args?: string[]): boolean
}

/** Never throws: startup must not depend on the OS accepting the registration. */
export function registerStarAgentProtocol(app: ProtocolClientApp, registration: StarAgentProtocolRegistration | null): boolean {
  if (!registration) return false
  try {
    return registration.executable
      ? app.setAsDefaultProtocolClient(registration.protocol, registration.executable, registration.args ?? [])
      : app.setAsDefaultProtocolClient(registration.protocol)
  } catch {
    return false
  }
}

export type OpenUrlApp = {
  on(event: 'open-url', listener: (event: { preventDefault(): void }, url: string) => void): unknown
}

/**
 * macOS delivers the URL through `open-url`, also for the start it launched, so
 * this has to be installed before `ready`. A `star-agent:` URL only calls
 * `focus`; other URLs are left alone.
 */
export function installStarAgentOpenUrlHandler(app: OpenUrlApp, focus: () => void): void {
  app.on('open-url', (event, url) => {
    if (!isStarAgentUrl(url)) return
    event.preventDefault()
    focus()
  })
}
