import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { THEME_BACKGROUNDS } from '../theme/systemAppearance'

type Listener = (event: { matches: boolean }) => void

/**
 * The shipped index.html carries this meta; jsdom starts without it. It colors
 * the iOS status bar and the Android address bar, which under viewport-fit=cover
 * sit directly against the app's own background.
 */
function installThemeColorMeta() {
  document.querySelector('meta[name="theme-color"]')?.remove()
  const meta = document.createElement('meta')
  meta.setAttribute('name', 'theme-color')
  meta.setAttribute('content', '#000000')
  document.head.appendChild(meta)
}

function readThemeColor(): string | null {
  return document.querySelector('meta[name="theme-color"]')?.getAttribute('content') ?? null
}

/** jsdom ships no matchMedia; the theme layer treats its absence as light. */
function stubMatchMedia(prefersDark: boolean) {
  const listeners = new Set<Listener>()
  Object.defineProperty(window, 'matchMedia', {
    value: () => ({
      matches: prefersDark,
      media: '(prefers-color-scheme: dark)',
      addEventListener: (_type: string, listener: Listener) => listeners.add(listener),
      removeEventListener: (_type: string, listener: Listener) => listeners.delete(listener),
    }),
    configurable: true,
    writable: true,
  })
  return {
    emit: (matches: boolean) => {
      for (const listener of listeners) listener({ matches })
    },
  }
}

afterEach(() => {
  Reflect.deleteProperty(window as unknown as Record<string, unknown>, 'matchMedia')
  document.querySelector('meta[name="theme-color"]')?.remove()
})

describe('uiStore theme handling', () => {
  beforeEach(() => {
    vi.resetModules()
    window.localStorage.clear()
    document.documentElement.removeAttribute('data-theme')
    document.documentElement.style.colorScheme = ''
    installThemeColorMeta()
  })

  it('defaults new installs to the pure white theme', async () => {
    const { initializeTheme, useUIStore } = await import('./uiStore')

    expect(useUIStore.getState().theme).toBe('white')
    initializeTheme()
    expect(document.documentElement.getAttribute('data-theme')).toBe('white')
    expect(document.documentElement.style.colorScheme).toBe('light')
  })

  it('hydrates and applies the pure white theme as a light color scheme', async () => {
    window.localStorage.setItem('cc-haha-theme', 'white')

    const { initializeTheme, useUIStore } = await import('./uiStore')

    expect(useUIStore.getState().theme).toBe('white')
    initializeTheme()
    expect(document.documentElement.getAttribute('data-theme')).toBe('white')
    expect(document.documentElement.style.colorScheme).toBe('light')
  })

  it('toggles between the light and the dark palette', async () => {
    const { useUIStore } = await import('./uiStore')

    for (const expected of ['dark', 'white', 'dark', 'white']) {
      useUIStore.getState().toggleTheme()
      expect(useUIStore.getState().theme).toBe(expected)
      expect(document.documentElement.getAttribute('data-theme')).toBe(expected)
    }
  })

  it('folds the retired palettes onto the palette of their ground', async () => {
    // Older builds shipped six palettes. A retired key (a stale settings
    // write, another window still on an older build) lands on 浅色 or 深色,
    // and the color scheme follows the ground rather than the key's name.
    const { useUIStore } = await import('./uiStore')

    useUIStore.getState().setTheme('ink-blue')
    expect(useUIStore.getState().theme).toBe('dark')
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark')
    expect(document.documentElement.style.colorScheme).toBe('dark')

    useUIStore.getState().setTheme('celadon')
    expect(useUIStore.getState().theme).toBe('white')
    expect(document.documentElement.getAttribute('data-theme')).toBe('white')
    expect(document.documentElement.style.colorScheme).toBe('light')
  })

  // Under viewport-fit=cover the page runs under the status bar, so a stale
  // theme-color reads as a mismatched band above the header on every switch.
  it('repaints the browser chrome for both palettes', async () => {
    const { useUIStore } = await import('./uiStore')

    for (const theme of ['dark', 'white'] as const) {
      useUIStore.getState().setTheme(theme)
      expect(readThemeColor(), `${theme} left the browser chrome unpainted`).toBe(THEME_BACKGROUNDS[theme])
    }
  })

  it('applies a theme even when the document carries no theme-color meta', async () => {
    document.querySelector('meta[name="theme-color"]')?.remove()

    const { useUIStore } = await import('./uiStore')
    useUIStore.setState({ followSystemTheme: false })
    useUIStore.getState().setTheme('dark')

    expect(document.documentElement.getAttribute('data-theme')).toBe('dark')
  })
})

describe('uiStore following the system appearance', () => {
  beforeEach(() => {
    vi.resetModules()
    window.localStorage.clear()
    document.documentElement.removeAttribute('data-theme')
    document.documentElement.style.colorScheme = ''
    installThemeColorMeta()
  })

  it('starts a fresh install on the dark theme when the OS is dark', async () => {
    // The reported bug: at night the app opened white and had to be switched
    // by hand every time.
    stubMatchMedia(true)

    const { initializeTheme, useUIStore, teardownTheme } = await import('./uiStore')

    expect(useUIStore.getState().followSystemTheme).toBe(true)
    expect(useUIStore.getState().theme).toBe('dark')

    initializeTheme()
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark')
    expect(document.documentElement.style.colorScheme).toBe('dark')
    teardownTheme()
  })

  it('leaves an existing install on its fixed theme', async () => {
    window.localStorage.setItem('cc-haha-theme', 'white')
    stubMatchMedia(true)

    const { useUIStore } = await import('./uiStore')

    expect(useUIStore.getState().followSystemTheme).toBe(false)
    expect(useUIStore.getState().theme).toBe('white')
  })

  it('repaints when the OS flips while the app is open', async () => {
    const media = stubMatchMedia(false)

    const { initializeTheme, useUIStore, teardownTheme } = await import('./uiStore')
    initializeTheme()
    expect(useUIStore.getState().theme).toBe('white')

    media.emit(true)
    expect(useUIStore.getState().theme).toBe('dark')
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark')

    media.emit(false)
    expect(useUIStore.getState().theme).toBe('white')
    expect(document.documentElement.getAttribute('data-theme')).toBe('white')
    teardownTheme()
  })

  it('ignores OS flips once the user opts out', async () => {
    const media = stubMatchMedia(false)

    const { initializeTheme, useUIStore, teardownTheme } = await import('./uiStore')
    initializeTheme()
    useUIStore.getState().setFollowSystemTheme(false)

    media.emit(true)
    expect(useUIStore.getState().theme).toBe('white')
    teardownTheme()
  })

  it('freezes the theme on screen when the switch is turned off', async () => {
    // Turning it off at night should keep the dark theme, not snap back to
    // the light half.
    stubMatchMedia(true)

    const { initializeTheme, useUIStore, teardownTheme } = await import('./uiStore')
    initializeTheme()
    expect(useUIStore.getState().theme).toBe('dark')

    useUIStore.getState().setFollowSystemTheme(false)
    expect(useUIStore.getState().theme).toBe('dark')
    expect(window.localStorage.getItem('cc-haha-theme')).toBe('dark')
    expect(window.localStorage.getItem('cc-haha-follow-system-theme')).toBe('0')
    teardownTheme()
  })

  it('applies a light pick at once under a dark OS and stops following it', async () => {
    // Each ground has exactly one palette, so a pick can only mean "show this
    // now". Leaving the switch on would make a click on 浅色 at night change
    // nothing on screen.
    const media = stubMatchMedia(true)

    const { initializeTheme, useUIStore, teardownTheme } = await import('./uiStore')
    initializeTheme()
    expect(useUIStore.getState().theme).toBe('dark')

    useUIStore.getState().setTheme('white')

    expect(useUIStore.getState().theme).toBe('white')
    expect(useUIStore.getState().followSystemTheme).toBe(false)
    expect(document.documentElement.getAttribute('data-theme')).toBe('white')
    expect(window.localStorage.getItem('cc-haha-theme')).toBe('white')
    expect(window.localStorage.getItem('cc-haha-follow-system-theme')).toBe('0')

    // The OS no longer drives it.
    media.emit(false)
    media.emit(true)
    expect(useUIStore.getState().theme).toBe('white')
    teardownTheme()
  })

  it('applies a dark pick at once under a light OS', async () => {
    stubMatchMedia(false)

    const { initializeTheme, useUIStore, teardownTheme } = await import('./uiStore')
    initializeTheme()
    expect(useUIStore.getState().theme).toBe('white')

    useUIStore.getState().setTheme('dark')

    expect(useUIStore.getState().theme).toBe('dark')
    expect(useUIStore.getState().followSystemTheme).toBe(false)
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark')
    expect(document.documentElement.style.colorScheme).toBe('dark')
    expect(window.localStorage.getItem('cc-haha-theme')).toBe('dark')
    teardownTheme()
  })

  it('treats picking the palette already on screen as an explicit choice too', async () => {
    // Under a light OS 浅色 is already applied; clicking it still means "keep
    // this", so tonight's OS flip must not repaint the app.
    const media = stubMatchMedia(false)

    const { initializeTheme, useUIStore, teardownTheme } = await import('./uiStore')
    initializeTheme()

    useUIStore.getState().setTheme('white')
    expect(useUIStore.getState().followSystemTheme).toBe(false)

    media.emit(true)
    expect(useUIStore.getState().theme).toBe('white')
    expect(document.documentElement.getAttribute('data-theme')).toBe('white')
    teardownTheme()
  })

  it('rehydrates an explicit pick after a restart', async () => {
    stubMatchMedia(false)

    const first = await import('./uiStore')
    first.initializeTheme()
    first.useUIStore.getState().setTheme('dark')
    first.teardownTheme()

    vi.resetModules()
    stubMatchMedia(false)
    const recreated = await import('./uiStore')

    expect(recreated.useUIStore.getState().followSystemTheme).toBe(false)
    expect(recreated.useUIStore.getState().theme).toBe('dark')
  })

  it('releases the switch when the theme is toggled by hand', async () => {
    const media = stubMatchMedia(false)

    const { initializeTheme, useUIStore, teardownTheme } = await import('./uiStore')
    initializeTheme()
    expect(useUIStore.getState().followSystemTheme).toBe(true)

    // white -> dark, the other palette.
    useUIStore.getState().toggleTheme()

    expect(useUIStore.getState().followSystemTheme).toBe(false)
    // Following the system, the second flip would bring back 浅色.
    media.emit(true)
    media.emit(false)
    expect(useUIStore.getState().theme).toBe('dark')
    teardownTheme()
  })

  it('drops the OS listener from a previous initialize', async () => {
    const media = stubMatchMedia(false)

    const { initializeTheme, useUIStore, teardownTheme } = await import('./uiStore')
    initializeTheme()
    teardownTheme()

    media.emit(true)
    expect(useUIStore.getState().theme).toBe('white')
  })

  it('does not revive the switch from a window whose store went stale', async () => {
    // The pet window is long-lived and runs the same bootstrap with its own
    // store over the shared localStorage. When the main window turns the
    // switch off, this window's in-memory copy still says "on" — acting on it
    // would write the user's choice straight back out.
    const media = stubMatchMedia(false)

    const { initializeTheme, useUIStore, teardownTheme } = await import('./uiStore')
    initializeTheme()
    expect(useUIStore.getState().followSystemTheme).toBe(true)

    // Another window opted out; only storage reflects it.
    window.localStorage.setItem('cc-haha-follow-system-theme', '0')

    media.emit(true)

    expect(window.localStorage.getItem('cc-haha-follow-system-theme')).toBe('0')
    expect(useUIStore.getState().theme).toBe('white')
    teardownTheme()
  })

  it('resolves both OS halves to the two palettes whatever an older build stored', async () => {
    // Older builds kept a palette per ground. Those keys survive the update,
    // but each ground now has exactly one palette.
    window.localStorage.setItem('cc-haha-theme', 'ink-blue')
    window.localStorage.setItem('cc-haha-follow-system-theme', '1')
    window.localStorage.setItem('cc-haha-light-theme', 'celadon')
    window.localStorage.setItem('cc-haha-dark-theme', 'ink-blue')
    const media = stubMatchMedia(true)

    const { initializeTheme, useUIStore, teardownTheme } = await import('./uiStore')
    initializeTheme()
    expect(useUIStore.getState().theme).toBe('dark')
    expect(useUIStore.getState().darkTheme).toBe('dark')
    // The first launch rewrites the retired values.
    expect(window.localStorage.getItem('cc-haha-dark-theme')).toBe('dark')
    expect(window.localStorage.getItem('cc-haha-light-theme')).toBe('white')

    media.emit(false)
    expect(useUIStore.getState().theme).toBe('white')
    expect(useUIStore.getState().lightTheme).toBe('white')
    expect(document.documentElement.getAttribute('data-theme')).toBe('white')
    teardownTheme()
  })

  it('catches up when another window changes the appearance', async () => {
    stubMatchMedia(false)

    const { initializeTheme, useUIStore, teardownTheme } = await import('./uiStore')
    initializeTheme()
    expect(useUIStore.getState().theme).toBe('white')

    // Another window picked 深色. A storage event is what the browser delivers
    // to the windows that did not perform the write.
    window.localStorage.setItem('cc-haha-theme', 'dark')
    window.localStorage.setItem('cc-haha-follow-system-theme', '0')
    window.dispatchEvent(new StorageEvent('storage', { key: 'cc-haha-theme' }))

    expect(useUIStore.getState().theme).toBe('dark')
    expect(useUIStore.getState().followSystemTheme).toBe(false)
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark')
    // The window that performed the write repaints through applyTheme; this one
    // only ever sees the storage event, so it needs the same repaint.
    expect(readThemeColor()).toBe(THEME_BACKGROUNDS.dark)
    teardownTheme()
  })

  it('ignores storage events for unrelated keys', async () => {
    stubMatchMedia(false)

    const { initializeTheme, useUIStore, teardownTheme } = await import('./uiStore')
    initializeTheme()

    window.localStorage.setItem('cc-haha-theme', 'dark')
    window.localStorage.setItem('cc-haha-follow-system-theme', '0')
    window.dispatchEvent(new StorageEvent('storage', { key: 'cc-haha-open-tabs' }))

    expect(useUIStore.getState().theme).toBe('white')
    teardownTheme()
  })
})

describe('uiStore settings tab persistence', () => {
  beforeEach(() => {
    vi.resetModules()
    window.localStorage.clear()
  })

  it('hydrates the last selected Settings tab after the renderer store is recreated', async () => {
    const first = await import('./uiStore')

    first.useUIStore.getState().setActiveSettingsTab('general')

    expect(window.localStorage.getItem('cc-haha-active-settings-tab')).toBe('general')

    vi.resetModules()
    const recreated = await import('./uiStore')

    expect(recreated.useUIStore.getState().activeSettingsTab).toBe('general')
  })

  it('persists the pets Settings tab', async () => {
    const first = await import('./uiStore')

    first.useUIStore.getState().setActiveSettingsTab('pets')

    expect(window.localStorage.getItem('cc-haha-active-settings-tab')).toBe('pets')

    vi.resetModules()
    const recreated = await import('./uiStore')

    expect(recreated.useUIStore.getState().activeSettingsTab).toBe('pets')
  })

  it('ignores an invalid persisted Settings tab', async () => {
    window.localStorage.setItem('cc-haha-active-settings-tab', 'not-a-settings-tab')

    const { useUIStore } = await import('./uiStore')

    expect(useUIStore.getState().activeSettingsTab).toBe('providers')
  })

  it('lands a stale persisted Trace entry on General, where the capture toggle moved', async () => {
    window.localStorage.setItem('cc-haha-active-settings-tab', 'trace')

    const { useUIStore } = await import('./uiStore')

    expect(useUIStore.getState().activeSettingsTab).toBe('general')
  })
})

describe('uiStore new-session draft navigation', () => {
  // An empty draft is only a seed: "New session" in another project has to
  // land there. It used to keep the first project, which was usually the
  // project-less draft made at launch before the tabs were restored.
  it('moves an empty draft to the requested project in place', async () => {
    vi.resetModules()
    const { useUIStore } = await import('./uiStore')
    useUIStore.getState().startNewSessionDraft('/workspace/first')
    const draft = useUIStore.getState().newSessionDraft!
    expect(draft).toMatchObject({ workDir: '/workspace/first', hasContent: false })

    useUIStore.getState().startNewSessionDraft('/workspace/other')
    // Same revision: the composer is moved, not remounted, so its mode and
    // permission picks survive.
    expect(useUIStore.getState().newSessionDraft).toEqual({ ...draft, workDir: '/workspace/other' })

    // No target (a page with no chat of its own) returns to the draft as it is.
    useUIStore.getState().startNewSessionDraft()
    expect(useUIStore.getState().newSessionDraft?.workDir).toBe('/workspace/other')
    useUIStore.setState({ newSessionDraft: null })
  })

  it('keeps the project of a draft holding unsent content', async () => {
    vi.resetModules()
    const { useUIStore } = await import('./uiStore')
    useUIStore.getState().startNewSessionDraft('/workspace/first')
    const { revision } = useUIStore.getState().newSessionDraft!
    useUIStore.getState().setNewSessionDraftContent(revision, true)
    const draft = useUIStore.getState().newSessionDraft
    expect(draft).toMatchObject({ workDir: '/workspace/first', hasContent: true })

    useUIStore.getState().startNewSessionDraft('/workspace/other')
    expect(useUIStore.getState().newSessionDraft).toBe(draft)

    // Emptied again, it follows the next request.
    useUIStore.getState().setNewSessionDraftContent(revision, false)
    useUIStore.getState().startNewSessionDraft('/workspace/other')
    expect(useUIStore.getState().newSessionDraft).toMatchObject({ workDir: '/workspace/other', revision })
    useUIStore.setState({ newSessionDraft: null })
  })

  it('ignores a content report from a composer of an older draft', async () => {
    vi.resetModules()
    const { useUIStore } = await import('./uiStore')
    useUIStore.getState().startNewSessionDraft('/workspace/first')
    const first = useUIStore.getState().newSessionDraft!
    // Successful first send consumes this draft. The next request is a new chat.
    useUIStore.setState({ newSessionDraft: null })
    useUIStore.getState().startNewSessionDraft('/workspace/next')
    const next = useUIStore.getState().newSessionDraft!
    expect(next.workDir).toBe('/workspace/next')
    expect(next.revision).not.toBe(first.revision)

    useUIStore.getState().setNewSessionDraftContent(first.revision, true)
    expect(useUIStore.getState().newSessionDraft).toBe(next)
    useUIStore.setState({ newSessionDraft: null })
  })
})
