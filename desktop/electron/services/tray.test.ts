import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { tmpdir } from 'node:os'
import { describe, expect, it, vi } from 'vitest'
import { installTray, resolveTrayIconPath, shouldInstallTray } from './tray'

function createElectronTrayMocks() {
  const handlers = new Map<string, () => void>()
  return {
    handlers,
    buildFromTemplate: vi.fn((template: unknown) => ({ template })),
    createFromPath: vi.fn((iconPath: string) => ({ iconPath })),
    tray: {
      setToolTip: vi.fn(),
      setContextMenu: vi.fn(),
      on: vi.fn((event: string, handler: () => void) => {
        handlers.set(event, handler)
      }),
      destroy: vi.fn(),
    },
    Tray: vi.fn(),
  }
}

describe('Electron tray service', () => {
  it('uses the existing desktop icon assets for the tray icon', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'electron-tray-'))
    try {
      const iconPath = path.join(root, 'src-tauri', 'icons', 'icon.png')
      mkdirSync(path.dirname(iconPath), { recursive: true })
      writeFileSync(iconPath, 'png')

      expect(resolveTrayIconPath(root)).toBe(iconPath)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('fails clearly when no tray icon exists', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'electron-tray-missing-'))
    try {
      expect(() => resolveTrayIconPath(root)).toThrow('Electron tray icon not found')
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('skips the status-bar tray on macOS and keeps it on Windows and Linux', () => {
    expect(shouldInstallTray('darwin')).toBe(false)
    expect(shouldInstallTray('win32')).toBe(true)
    expect(shouldInstallTray('linux')).toBe(true)
  })

  it('installs tray handlers that show the app, quit explicitly, and dispose cleanly', async () => {
    const root = mkdtempSync(path.join(tmpdir(), 'electron-tray-install-'))
    try {
      const trayMocks = createElectronTrayMocks()
      const iconPath = path.join(root, 'src-tauri', 'icons', 'icon.png')
      mkdirSync(path.dirname(iconPath), { recursive: true })
      writeFileSync(iconPath, 'png')
      const show = vi.fn()
      const quit = vi.fn()

      const controller = await installTray({
        app: { name: 'claude-code-desktop' } as never,
        desktopRoot: root,
        show,
        quit,
        electronRuntime: {
          Menu: {
            buildFromTemplate: trayMocks.buildFromTemplate,
          },
          Tray: trayMocks.Tray.mockImplementation(() => trayMocks.tray),
          nativeImage: {
            createFromPath: trayMocks.createFromPath,
          },
        } as never,
      })

      expect(trayMocks.createFromPath).toHaveBeenCalledWith(iconPath)
      expect(trayMocks.Tray).toHaveBeenCalledTimes(1)
      // The tooltip and menu carry the product name, not whatever app.name is.
      expect(trayMocks.tray.setToolTip).toHaveBeenCalledWith('PRIVO STAR WORK')
      expect(trayMocks.buildFromTemplate).toHaveBeenCalledTimes(1)

      const template = trayMocks.buildFromTemplate.mock.calls[0]?.[0] as Array<{ label?: string, click?: () => void, type?: string }>
      expect(template.map(item => item.label ?? item.type)).toEqual([
        '显示 PRIVO STAR WORK',
        'separator',
        '退出 PRIVO STAR WORK',
      ])

      template[0]?.click?.()
      template[2]?.click?.()
      trayMocks.handlers.get('click')?.()

      expect(show).toHaveBeenCalledTimes(2)
      expect(quit).toHaveBeenCalledTimes(1)

      controller.dispose()
      expect(trayMocks.tray.destroy).toHaveBeenCalledTimes(1)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('names the console product in the tooltip and menu, and renames it later', async () => {
    const root = mkdtempSync(path.join(tmpdir(), 'electron-tray-brand-'))
    try {
      const trayMocks = createElectronTrayMocks()
      const iconPath = path.join(root, 'src-tauri', 'icons', 'icon.png')
      mkdirSync(path.dirname(iconPath), { recursive: true })
      writeFileSync(iconPath, 'png')
      const controller = await installTray({
        app: {} as never,
        desktopRoot: root,
        show: vi.fn(),
        quit: vi.fn(),
        productName: 'PRIVO Agent',
        electronRuntime: {
          Menu: { buildFromTemplate: trayMocks.buildFromTemplate },
          Tray: trayMocks.Tray.mockImplementation(() => trayMocks.tray),
          nativeImage: { createFromPath: trayMocks.createFromPath },
        } as never,
      })
      const labels = (call: number) =>
        (trayMocks.buildFromTemplate.mock.calls[call]?.[0] as Array<{ label?: string }>).map(item => item.label).filter(Boolean)
      expect(trayMocks.tray.setToolTip).toHaveBeenLastCalledWith('PRIVO Agent')
      expect(labels(0)).toEqual(['显示 PRIVO Agent', '退出 PRIVO Agent'])

      controller.setProductName('Acme Agent')
      expect(trayMocks.tray.setToolTip).toHaveBeenLastCalledWith('Acme Agent')
      expect(labels(1)).toEqual(['显示 Acme Agent', '退出 Acme Agent'])

      // The same name again does not rebuild the menu.
      controller.setProductName('Acme Agent')
      expect(trayMocks.buildFromTemplate).toHaveBeenCalledTimes(2)
      controller.dispose()
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})
