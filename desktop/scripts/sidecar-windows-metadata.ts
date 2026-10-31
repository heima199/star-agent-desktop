import { readFileSync } from 'node:fs'
import path from 'node:path'

/**
 * The Windows version resource of the compiled sidecar. Windows shows it in
 * the firewall prompt the first time the local server listens ("Allow
 * <title> from <publisher> on public and private networks?"), in Task Manager
 * and in the file properties, so it names the app this sidecar ships with,
 * the same way `STAR Agent.exe` does: productName, author, version and icon
 * all come from desktop/package.json. Without an icon, Bun embeds its own
 * runtime icon instead.
 */
export type SidecarWindowsMetadata = {
  title: string
  publisher: string
  description: string
  version: string
  copyright: string
  /** Absolute path to the application ICO (`build.win.icon`). */
  icon: string
}

type DesktopManifest = {
  version?: unknown
  author?: unknown
  build?: { productName?: unknown; win?: { icon?: unknown } }
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function authorName(author: unknown): string {
  if (typeof author === 'string') return author.replace(/\s*[<(].*$/, '').trim()
  if (author && typeof author === 'object') return text((author as { name?: unknown }).name)
  return ''
}

/** Four numeric parts, as the Windows version resource requires (`1.0.0` -> `1.0.0.0`). */
export function windowsFileVersion(version: string): string {
  const parts = (version.split(/[-+]/)[0] ?? '')
    .split('.')
    .map(part => Number.parseInt(part, 10))
    .map(part => (Number.isFinite(part) && part >= 0 ? Math.min(part, 65535) : 0))
  while (parts.length < 4) parts.push(0)
  return parts.slice(0, 4).join('.')
}

export function sidecarWindowsMetadata(
  manifest: DesktopManifest,
  desktopRoot: string,
  year: number = new Date().getFullYear(),
): SidecarWindowsMetadata {
  const productName = text(manifest.build?.productName)
  const publisher = authorName(manifest.author)
  const icon = text(manifest.build?.win?.icon)
  if (!productName || !publisher || !icon) {
    throw new Error('[build-sidecars] desktop/package.json needs build.productName, author and build.win.icon for the sidecar metadata')
  }
  return {
    title: productName,
    publisher,
    // The firewall prompt shows the description as the program name; the
    // user just started the app, so it reads as the app asking.
    description: productName,
    version: windowsFileVersion(text(manifest.version) || '0.0.0'),
    copyright: `Copyright © ${year} ${publisher}`,
    icon: path.resolve(desktopRoot, icon),
  }
}

export function readSidecarWindowsMetadata(desktopRoot: string): SidecarWindowsMetadata {
  const manifest = JSON.parse(readFileSync(path.join(desktopRoot, 'package.json'), 'utf8')) as DesktopManifest
  return sidecarWindowsMetadata(manifest, desktopRoot)
}
