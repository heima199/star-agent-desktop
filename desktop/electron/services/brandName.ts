import { readFileSync, unwatchFile, watchFile } from 'node:fs'
import { homedir } from 'node:os'
import path from 'node:path'
import {
  formatStarBrand,
  normalizeStarBrandName,
  STAR_BRAND_DEFAULT,
  starBrandProductName,
} from '../../src/lib/starBrand'

/**
 * The product name set in the STAR console, for the tray, the window title and
 * desktop notifications. The local server fetches it and caches it in
 * brand.json (src/server/services/star/starBrand.ts); this host only reads that
 * file, at startup and whenever it changes. PRODUCT_NAME (appIdentity.ts) stays
 * the OS identity: executable, shortcuts, AppUserModelId, relaunch name.
 */

/** `<CLAUDE_CONFIG_DIR or ~/.claude>/cc-haha/star/brand.json`, next to the STAR session. */
export function brandNameFile(env: NodeJS.ProcessEnv = process.env, homeDir: string = homedir()): string {
  const configDir = env.CLAUDE_CONFIG_DIR?.trim() || path.join(homeDir, '.claude')
  return path.join(configDir, 'cc-haha', 'star', 'brand.json')
}

/** The cached name, normalized; STAR when the file is missing or unreadable. */
export function readBrandName(file: string, read: (file: string) => string = name => readFileSync(name, 'utf8')): string {
  try {
    const parsed: unknown = JSON.parse(read(file))
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? normalizeStarBrandName((parsed as Record<string, unknown>).name)
      : STAR_BRAND_DEFAULT
  } catch {
    return STAR_BRAND_DEFAULT
  }
}

/** "X Agent": the tray tooltip and its 显示 / 退出 entries. */
export function brandAgentName(brand: string): string {
  return starBrandProductName(brand, 'Agent')
}

/** The main window's title: the name itself, as the page title (STAR) was. */
export function brandWindowTitle(brand: string): string {
  return brand.trim() || STAR_BRAND_DEFAULT
}

const BRAND_WORD = /(?<![A-Za-z0-9_\-./])STAR(?![A-Za-z0-9_-])/g

/**
 * A notification text with the console's name: `{brand}`, `{brandAgent}`,
 * `{brandCode}`, and the brand word STAR the renderer's titles still spell
 * out (「STAR 需要你的确认」). Identifiers such as STAR_X or STAR-DEBUG stay.
 */
export function brandNotificationText(text: string, brand: string): string {
  const name = brandWindowTitle(brand)
  const formatted = formatStarBrand(text, name)
  return name === STAR_BRAND_DEFAULT ? formatted : formatted.replace(BRAND_WORD, name)
}

export type BrandNameSource = {
  current(): string
  /** Read the file again (window focus); calls onChange when the name differs. */
  refresh(): void
  dispose(): void
}

type WatchFile = (file: string, options: { interval: number, persistent: boolean }, listener: () => void) => unknown
type UnwatchFile = (file: string, listener: () => void) => void

/** Reads brand.json now and follows it with a cheap stat poll. */
export function watchBrandName({
  file,
  onChange,
  read,
  watch = watchFile as unknown as WatchFile,
  unwatch = unwatchFile as unknown as UnwatchFile,
  intervalMs = 10_000,
}: {
  file: string
  onChange: (name: string) => void
  read?: (file: string) => string
  watch?: WatchFile
  unwatch?: UnwatchFile
  intervalMs?: number
}): BrandNameSource {
  let name = readBrandName(file, read)
  const refresh = () => {
    const next = readBrandName(file, read)
    if (next === name) return
    name = next
    onChange(next)
  }
  const listener = () => refresh()
  try {
    watch(file, { interval: intervalMs, persistent: false }, listener)
  } catch {
    // No watcher: focus still refreshes the name.
  }
  return {
    current: () => name,
    refresh,
    dispose: () => {
      try {
        unwatch(file, listener)
      } catch {
        // Already gone.
      }
    },
  }
}
