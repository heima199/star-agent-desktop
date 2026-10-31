import { AppShell } from './components/layout/AppShell'
import { useScheduledTaskDesktopNotifications } from './hooks/useScheduledTaskDesktopNotifications'
import { installDesktopNotificationNavigation } from './lib/desktopNotificationNavigation'
import { useEffect } from 'react'
import { RemoteAccessGate } from './pages/RemoteAccess'
import { isPublicAccessRuntime } from './lib/publicAccessRuntime'
import { useChatStore } from './stores/chatStore'
import { installHiddenSessionRelease } from './stores/hiddenSessionRelease'
import { installSessionTabLimit } from './stores/sessionTabLimit'
import { useMobileShellLayout } from './components/mobile/mobileShellLayout'
import { isDesktopRuntime } from './lib/desktopRuntime'
import { ModelPolicyProvider, STAR_APP_MODEL_POLICY } from './lib/modelPolicy'
import { useStarOnlyDefaultProvider } from './hooks/useStarOnlyDefaultProvider'

export function App() {
  // The STAR app offers its own models only; see lib/modelPolicy.
  return (
    <ModelPolicyProvider value={STAR_APP_MODEL_POLICY}>
      {isPublicAccessRuntime()
        ? <RemoteAccessGate><ConnectedApp /></RemoteAccessGate>
        : <ConnectedApp />}
    </ModelPolicyProvider>
  )
}

function ConnectedApp() {
  useScheduledTaskDesktopNotifications()
  useStarOnlyDefaultProvider()
  const shellLayout = useMobileShellLayout(isDesktopRuntime())
  useEffect(
    () => installHiddenSessionRelease(useChatStore, {
      scope: shellLayout === 'desktop' ? 'open-tabs' : 'active-tab',
    }),
    [shellLayout],
  )
  // Phones and tablets keep one page on screen; their tabs are only a way back.
  useEffect(
    () => (shellLayout === 'desktop' ? installSessionTabLimit() : undefined),
    [shellLayout],
  )
  useEffect(() => {
    let cleanup: (() => void) | undefined
    let cancelled = false
    installDesktopNotificationNavigation()
      .then((fn) => {
        if (cancelled) {
          fn()
        } else {
          cleanup = fn
        }
      })
      .catch(() => {})
    return () => {
      cancelled = true
      cleanup?.()
    }
  }, [])
  return <AppShell />
}
