import React from 'react'
import ReactDOM from 'react-dom/client'
import '@xterm/xterm/css/xterm.css'
import './theme/globals.css'
import { initializeAppZoom } from './lib/appZoom'
import { initializeTouchH5 } from './lib/touchH5'
import { runDesktopPersistenceMigrations } from './lib/persistenceMigrations'
import { initWorkspacePersistence } from './lib/workspace/persistenceBridge'
import { getDesktopHost } from './lib/desktopHost'
import { loadLocale } from './i18n'
import { initializeLocale } from './i18n/locale'
import { useSettingsStore } from './stores/settingsStore'
import { initializeChatAppearance } from './stores/chatAppearanceStore'

declare global {
  interface Window {
    __CC_HAHA_BOOTSTRAPPED__?: boolean
    __CC_HAHA_SHOW_STARTUP_ERROR__?: (reason: unknown) => void
  }
}

type DesktopBootstrapModules = [
  { App: React.ComponentType },
  { ErrorBoundary: React.ComponentType<{ children: React.ReactNode }> },
  { installClientDiagnosticsCapture: () => void },
  { initializeTheme: () => void },
]

export function isPetWindowLocation(search = window.location.search): boolean {
  return new URLSearchParams(search).get('petWindow') === '1'
}

/**
 * Whether this renderer is the one that owns workspace state.
 *
 * Every window — main and pet — loads this same entry. They share one
 * `localStorage` origin, and the workspace document is written whole rather
 * than merged per session, so a second writer would overwrite the main
 * window's state with whatever it hydrated at open time.
 */
export function isPrimaryWorkspaceWindow(search = window.location.search): boolean {
  const params = new URLSearchParams(search)
  return params.get('petWindow') !== '1'
}

function loadDesktopBootstrapModules() {
  const appModule = isPetWindowLocation()
    ? import('./features/pets/PetApp').then(({ PetApp }) => ({ App: PetApp }))
    : import('./App')
  return Promise.all([
    appModule,
    import('./components/ErrorBoundary'),
    import('./lib/diagnosticsCapture'),
    import('./stores/uiStore'),
  ])
}

if (isPetWindowLocation()) {
  document.documentElement.dataset.windowKind = 'pet'
}

/**
 * How long boot waits for the main process's answer about the locale. The
 * answer comes over IPC, and a main process busy starting the local server
 * once kept the window blank past the startup watchdog ("Desktop startup
 * failed"). Past this the app mounts in the locale it can read itself and
 * switches when the answer comes.
 */
export const LOCALE_BOOT_WAIT_MS = 1_500

/** Resolves when `promise` settles or after `ms`, whichever is first; never rejects. */
function settleWithin(promise: Promise<unknown>, ms: number): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms)
    void promise.catch(() => undefined).finally(() => {
      clearTimeout(timer)
      resolve()
    })
  })
}

export async function bootstrapDesktopApp(
  root: HTMLElement | null = document.getElementById('root'),
  loadModules: () => Promise<DesktopBootstrapModules> = loadDesktopBootstrapModules,
  initLocale: () => Promise<unknown> = () => initializeLocale(getDesktopHost().app),
  localeWaitMs: number = LOCALE_BOOT_WAIT_MS,
  loadLocaleTexts: () => Promise<unknown> = () => loadLocale(useSettingsStore.getState().locale),
) {
  try {
    await settleWithin(initLocale(), localeWaitMs)
    // The texts of the locale just resolved, when it is one that loads on
    // demand (zh-TW, jp, kr), alongside the app modules: the first frame is
    // already in that language. Same cap as the locale answer.
    const localeTexts = settleWithin(loadLocaleTexts(), localeWaitMs)
    const [{ App }, { ErrorBoundary }, { installClientDiagnosticsCapture }, { initializeTheme }] = await loadModules()
    await localeTexts
    initializeTheme()
    installClientDiagnosticsCapture()

    if (!root) {
      throw new Error('Desktop root element not found')
    }

    ReactDOM.createRoot(root).render(
      <React.StrictMode>
        <ErrorBoundary>
          <App />
        </ErrorBoundary>
      </React.StrictMode>,
    )
    window.__CC_HAHA_BOOTSTRAPPED__ = true
  } catch (error) {
    console.error('[desktop] Failed to bootstrap app', error)
    if (root) {
      if (window.__CC_HAHA_SHOW_STARTUP_ERROR__) {
        window.__CC_HAHA_SHOW_STARTUP_ERROR__(error)
      } else {
        root.textContent = error instanceof Error ? error.message : String(error)
      }
    }
  }
}

runDesktopPersistenceMigrations()
initializeChatAppearance()
// Strictly after the migrations: the hydrator trusts the shape the migration
// step just normalized rather than re-validating a possibly future schema.
if (isPrimaryWorkspaceWindow()) initWorkspacePersistence()
initializeTouchH5()
void initializeAppZoom()

void bootstrapDesktopApp()
