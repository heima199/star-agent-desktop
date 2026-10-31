import React from 'react'
import '@testing-library/jest-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, screen } from '@testing-library/react'

const mocks = vi.hoisted(() => ({
  runDesktopPersistenceMigrations: vi.fn(),
}))

vi.mock('./lib/persistenceMigrations', () => ({
  runDesktopPersistenceMigrations: mocks.runDesktopPersistenceMigrations,
}))

vi.mock('@xterm/xterm/css/xterm.css', () => ({}))
vi.mock('./theme/globals.css', () => ({}))

vi.mock('./App', () => ({
  App: () => <div>Auto boot app</div>,
}))

vi.mock('./components/ErrorBoundary', () => ({
  ErrorBoundary: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}))

vi.mock('./lib/diagnosticsCapture', () => ({
  installClientDiagnosticsCapture: vi.fn(),
}))

vi.mock('./stores/uiStore', () => ({
  initializeTheme: vi.fn(),
}))

describe('desktop bootstrap', () => {
  afterEach(() => {
    cleanup()
    document.body.innerHTML = ''
    delete window.__CC_HAHA_BOOTSTRAPPED__
    delete window.__CC_HAHA_SHOW_STARTUP_ERROR__
    vi.restoreAllMocks()
    vi.clearAllMocks()
  })

  it('runs startup migrations and renders the app without top-level await', async () => {
    document.body.innerHTML = '<div id="root"></div>'

    await act(async () => {
      await import('./main')
      await Promise.resolve()
    })

    expect(await screen.findByText('Auto boot app')).toBeInTheDocument()
    expect(mocks.runDesktopPersistenceMigrations).toHaveBeenCalledTimes(1)
    expect(window.__CC_HAHA_BOOTSTRAPPED__).toBe(true)
  })

  it('recognizes only the dedicated pet window query', async () => {
    const { isPetWindowLocation } = await import('./main')

    expect(isPetWindowLocation('?petWindow=1')).toBe(true)
    expect(isPetWindowLocation('?petWindow=0')).toBe(false)
  })

  it('surfaces bootstrap failures in the root element', async () => {
    const { bootstrapDesktopApp } = await import('./main')
    const root = document.createElement('div')
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})

    await bootstrapDesktopApp(root, async () => {
      throw new Error('bootstrap failed')
    })

    expect(root.textContent).toBe('bootstrap failed')
    expect(consoleError).toHaveBeenCalledWith('[desktop] Failed to bootstrap app', expect.any(Error))
  })

  // zh-TW, jp and kr load on demand: their texts come in alongside the app
  // modules, before the first frame, and a slow or failed load never holds
  // the window blank past the same cap as the locale answer.
  it('mounts the app once the resolved locale texts are in, without waiting forever for them', async () => {
    const { bootstrapDesktopApp } = await import('./main')
    const modules = async () => [
      { App: () => <div>Locale texts app</div> },
      { ErrorBoundary: ({ children }: { children: React.ReactNode }) => <>{children}</> },
      { installClientDiagnosticsCapture: () => {} },
      { initializeTheme: () => {} },
    ] as never
    let finishTexts: () => void = () => {}
    const texts = vi.fn(() => new Promise<void>((resolve) => { finishTexts = resolve }))
    const root = document.createElement('div')
    document.body.appendChild(root)
    let booted = false
    let boot: Promise<void> = Promise.resolve()
    await act(async () => {
      boot = bootstrapDesktopApp(root, modules, async () => 'kr', 1_000, texts).then(() => { booted = true })
      await new Promise((resolve) => setTimeout(resolve, 20))
    })
    expect(texts).toHaveBeenCalledTimes(1)
    expect(booted).toBe(false)
    expect(root.textContent).toBe('')
    await act(async () => {
      finishTexts()
      await boot
    })
    expect(root.textContent).toBe('Locale texts app')

    const second = document.createElement('div')
    document.body.appendChild(second)
    await act(async () => {
      await bootstrapDesktopApp(second, modules, async () => 'jp', 10, () => new Promise(() => {}))
    })
    expect(second.textContent).toBe('Locale texts app')
  })

  // The locale answer comes from the main process; a busy one must not keep
  // the window blank until the startup watchdog calls the boot a failure.
  it('mounts the app when the locale answer is late, or fails', async () => {
    const { bootstrapDesktopApp } = await import('./main')
    const modules = async () => [
      { App: () => <div>Late locale app</div> },
      { ErrorBoundary: ({ children }: { children: React.ReactNode }) => <>{children}</> },
      { installClientDiagnosticsCapture: () => {} },
      { initializeTheme: () => {} },
    ] as never
    const root = document.createElement('div')
    document.body.appendChild(root)

    await act(async () => {
      await bootstrapDesktopApp(root, modules, () => new Promise(() => {}), 10)
    })
    expect(await screen.findByText('Late locale app')).toBeInTheDocument()

    const second = document.createElement('div')
    document.body.appendChild(second)
    await act(async () => {
      await bootstrapDesktopApp(second, modules, () => Promise.reject(new Error('ipc closed')), 1_000)
    })
    expect(second.textContent).toBe('Late locale app')
  })

  it('delegates bootstrap failures to the HTML startup watchdog when available', async () => {
    const { bootstrapDesktopApp } = await import('./main')
    const root = document.createElement('div')
    const showStartupError = vi.fn()
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    window.__CC_HAHA_SHOW_STARTUP_ERROR__ = showStartupError

    await bootstrapDesktopApp(root, async () => {
      throw new Error('module failed')
    })

    expect(showStartupError).toHaveBeenCalledWith(expect.any(Error))
    expect(root.textContent).toBe('')
    expect(consoleError).toHaveBeenCalledWith('[desktop] Failed to bootstrap app', expect.any(Error))
  })
})
