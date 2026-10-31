import { existsSync } from 'node:fs'
import path from 'node:path'
import type { App, Tray } from 'electron'
import { PRODUCT_NAME } from './appIdentity'

type ElectronTrayRuntime = Pick<typeof import('electron'), 'Menu' | 'Tray' | 'nativeImage'>

export type TrayController = {
  tray: Tray
  /** Rename the tooltip and the 显示 / 退出 entries (the STAR console's product name). */
  setProductName(name: string): void
  dispose(): void
}

export function resolveTrayIconPath(desktopRoot: string): string {
  const candidates = [
    path.join(desktopRoot, 'src-tauri', 'icons', 'icon.png'),
    path.join(desktopRoot, 'public', 'app-icon.png'),
    path.join(desktopRoot, 'dist', 'app-icon.png'),
  ]
  const resolved = candidates.find(candidate => existsSync(candidate))
  if (!resolved) {
    throw new Error(`Electron tray icon not found under ${desktopRoot}`)
  }
  return resolved
}

export function shouldInstallTray(platform = process.platform): boolean {
  return platform !== 'darwin'
}

export async function installTray({
  desktopRoot,
  show,
  quit,
  electronRuntime,
  productName = PRODUCT_NAME,
}: {
  app: App
  desktopRoot: string
  show: () => void
  quit: () => void
  electronRuntime?: ElectronTrayRuntime
  /** "X Agent" with X the console's name (brandName.ts); PRODUCT_NAME by default. */
  productName?: string
}): Promise<TrayController> {
  const { Menu, Tray, nativeImage } = electronRuntime ?? await import('electron')
  const icon = nativeImage.createFromPath(resolveTrayIconPath(desktopRoot))
  const tray = new Tray(icon)
  let current = ''
  const setProductName = (name: string) => {
    const label = name.trim() || PRODUCT_NAME
    if (label === current) return
    current = label
    tray.setToolTip(label)
    tray.setContextMenu(Menu.buildFromTemplate([
      { label: `显示 ${label}`, click: show },
      { type: 'separator' },
      { label: `退出 ${label}`, click: quit },
    ]))
  }
  setProductName(productName)
  tray.on('click', show)

  return {
    tray,
    setProductName,
    dispose() {
      tray.destroy()
    },
  }
}
