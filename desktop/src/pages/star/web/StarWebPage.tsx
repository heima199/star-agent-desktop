import { useEffect, useRef, useState } from 'react'
import { ArrowLeft, ArrowRight, ExternalLink, Globe, RotateCw, X } from 'lucide-react'
import { IconButton } from '@/components/ui/IconButton'
import { openExternal } from '../../../components/star/starPages'
import { openStarWeb } from '../../../components/star/starWeb'
import {
  WORKSPACE_BROWSER_INITIAL_SRC,
  WORKSPACE_BROWSER_PARTITION,
} from '../../../lib/workspace/browserGuestContract'
import { subscribeWorkspaceBrowserEvents, workspaceBrowserHost } from '../../../lib/workspace/browserHost'
import { useTabStore, type Tab } from '../../../stores/tabStore'

const ATTACH_TIMEOUT_MS = 10_000

type WebviewElement = HTMLElement & { getWebContentsId(): number }

type PageState = {
  url: string
  canGoBack: boolean
  canGoForward: boolean
  loading: boolean
}

type PageError = { message: string; url: string | null }

/**
 * Host page ids are per mount, so a page closed by an earlier mount (a retry,
 * or React's development double mount) can never answer for this one. The
 * time part keeps them apart across module instances (a hot update restarts
 * the count).
 */
let pageSequence = 0

function errorText(reason: unknown): string {
  return reason instanceof Error ? reason.message : String(reason)
}

/**
 * A 'star-web' tab: one site shown inside the app (the sidebar 推荐 entries).
 *
 * The page is a `<webview>` of the workspace browser's partition, adopted by
 * the same host and held to the same boundary: sandboxed, OS permissions
 * denied, no local API token, http(s) only, popups denied (they come back as
 * new tabs). The element is created here and lives exactly as long as this
 * component, which ContentRouter keeps mounted for the life of the tab, so
 * switching tabs keeps the page's state; closing the tab ends it.
 */
export function StarWebPage({ tab, active }: { tab: Tab; active: boolean }) {
  const tabId = tab.sessionId
  const startUrl = tab.webUrl ?? ''
  const followsTitle = tab.webFollowsTitle === true
  const stageRef = useRef<HTMLDivElement>(null)
  const pageIdRef = useRef<string | null>(null)
  const [attempt, setAttempt] = useState(0)
  const [ready, setReady] = useState(false)
  const [error, setError] = useState<PageError | null>(null)
  const [page, setPage] = useState<PageState>({ url: startUrl, canGoBack: false, canGoForward: false, loading: true })

  useEffect(() => {
    const stage = stageRef.current
    if (!stage || !startUrl) return
    pageSequence += 1
    const pageId = `star-web.${Date.now().toString(36)}.${pageSequence}`
    let cancelled = false
    let unsubscribe: (() => void) | null = null
    let attachTimer: ReturnType<typeof setTimeout> | undefined

    // Subscribed before the page is created, so its first state is not missed.
    // The workspace's own event bridge drops these events: no task owns this page.
    const subscribed = subscribeWorkspaceBrowserEvents((event) => {
      if (cancelled || event.tabId !== pageId) return
      switch (event.type) {
        case 'state':
          setPage({
            url: event.url || startUrl,
            canGoBack: event.canGoBack,
            canGoForward: event.canGoForward,
            loading: event.loading,
          })
          if (event.navigationOutcome === 'succeeded') setError(null)
          if (followsTitle && event.title) {
            const current = useTabStore.getState().tabs.find((item) => item.sessionId === tabId)
            if (current && current.title !== event.title) useTabStore.getState().updateTabTitle(tabId, event.title)
          }
          break
        case 'failed':
          setPage((current) => ({ ...current, loading: false }))
          setError({ message: event.errorDescription || `ERR ${event.errorCode}`, url: event.url || null })
          break
        case 'new-window':
          // A popup or `target=_blank` link opens as a tab of its own, so the
          // page that asked for it keeps its state. Only a page on screen
          // takes the focus along; a background page's popup waits in its tab.
          openStarWeb(event.url, { background: useTabStore.getState().activeTabId !== tabId })
          break
        case 'destroyed':
          if (event.reason === 'closed') {
            // The guest is gone; only a new page can show the site again.
            pageIdRef.current = null
            setReady(false)
          }
          setPage((current) => ({ ...current, loading: false }))
          setError({ message: event.reason === 'crashed' ? '页面崩溃了' : '页面已关闭', url: null })
          break
        default:
          break
      }
    }).then((dispose) => {
      if (cancelled) dispose()
      else unsubscribe = dispose
    })

    const webview = document.createElement('webview') as WebviewElement
    // What the host's attach policy requires, as for every workspace browser
    // page: the shared partition, starting from the blank document. The host
    // performs every real navigation.
    webview.setAttribute('partition', WORKSPACE_BROWSER_PARTITION)
    // Without it Chromium drops `window.open` before the host can turn it into a tab.
    webview.setAttribute('allowpopups', '')
    webview.setAttribute('src', WORKSPACE_BROWSER_INITIAL_SRC)
    Object.assign(webview.style, { display: 'flex', width: '100%', height: '100%', border: '0' })

    const attached = new Promise<number>((resolve, reject) => {
      // A guest id is readable from the first `dom-ready` on; it repeats on
      // every navigation, so only the first one counts.
      const onReady = () => {
        clearTimeout(attachTimer)
        webview.removeEventListener('dom-ready', onReady)
        try {
          resolve(webview.getWebContentsId())
        } catch (reason) {
          reject(reason instanceof Error ? reason : new Error(String(reason)))
        }
      }
      attachTimer = setTimeout(() => {
        webview.removeEventListener('dom-ready', onReady)
        reject(new Error('页面没有打开'))
      }, ATTACH_TIMEOUT_MS)
      webview.addEventListener('dom-ready', onReady)
    })
    stage.appendChild(webview)

    void Promise.all([attached, subscribed])
      .then(async ([webContentsId]) => {
        if (cancelled) return
        const result = await workspaceBrowserHost.create(pageId, { storageId: pageId, url: startUrl, webContentsId })
        if (cancelled) return
        if (!result.ok) throw new Error('当前环境不能在应用内打开网页')
        pageIdRef.current = pageId
        setReady(true)
      })
      .catch((reason: unknown) => {
        if (cancelled) return
        setPage((current) => ({ ...current, loading: false }))
        setError({ message: errorText(reason), url: null })
      })

    return () => {
      cancelled = true
      clearTimeout(attachTimer)
      unsubscribe?.()
      if (pageIdRef.current === pageId) pageIdRef.current = null
      // Close before the element goes, so the host never reports this page lost.
      void workspaceBrowserHost.close(pageId).catch(() => {})
      webview.remove()
    }
  }, [attempt, followsTitle, startUrl, tabId])

  // A drag that starts in the app (a tab, a resize handle) must keep its moves
  // and its release when the pointer crosses the page, which would otherwise
  // take them. A gesture that starts inside the page is never seen here.
  useEffect(() => {
    const stage = stageRef.current
    if (!stage) return
    const hold = () => { stage.style.pointerEvents = 'none' }
    const release = () => { stage.style.pointerEvents = '' }
    const onMove = (event: PointerEvent) => { if (event.buttons === 0) release() }
    document.addEventListener('pointerdown', hold, true)
    document.addEventListener('pointermove', onMove, true)
    window.addEventListener('pointerup', release, true)
    window.addEventListener('pointercancel', release, true)
    window.addEventListener('blur', release)
    return () => {
      document.removeEventListener('pointerdown', hold, true)
      document.removeEventListener('pointermove', onMove, true)
      window.removeEventListener('pointerup', release, true)
      window.removeEventListener('pointercancel', release, true)
      window.removeEventListener('blur', release)
    }
  }, [])

  const command = (run: (pageId: string) => Promise<unknown>) => {
    const pageId = pageIdRef.current
    if (!pageId) return
    void run(pageId).catch((reason: unknown) => setError({ message: errorText(reason), url: null }))
  }

  const retry = () => {
    const failedUrl = error?.url
    setError(null)
    if (!pageIdRef.current) {
      // No live page to retry in: build a new one.
      setReady(false)
      setPage({ url: startUrl, canGoBack: false, canGoForward: false, loading: true })
      setAttempt((value) => value + 1)
      return
    }
    command((pageId) => failedUrl
      ? workspaceBrowserHost.navigate(pageId, failedUrl)
      : workspaceBrowserHost.reload(pageId))
  }

  const address = page.url || startUrl

  return (
    <div
      aria-hidden={!active}
      {...(active ? {} : { inert: '' })}
      data-testid={`star-web-panel-${tabId}`}
      className={`absolute inset-0 flex min-h-0 flex-col overflow-hidden bg-[var(--color-surface)] ${
        active ? 'z-20' : 'invisible pointer-events-none z-0'
      }`}
    >
      <div className="flex h-10 shrink-0 items-center gap-1 border-b border-[var(--color-border)] px-2">
        <IconButton
          icon={<ArrowLeft size={15} strokeWidth={1.75} aria-hidden="true" />}
          label="后退"
          size="sm"
          tone="secondary"
          disabled={!ready || !page.canGoBack}
          onClick={() => command((pageId) => workspaceBrowserHost.goBack(pageId))}
        />
        <IconButton
          icon={<ArrowRight size={15} strokeWidth={1.75} aria-hidden="true" />}
          label="前进"
          size="sm"
          tone="secondary"
          disabled={!ready || !page.canGoForward}
          onClick={() => command((pageId) => workspaceBrowserHost.goForward(pageId))}
        />
        <IconButton
          icon={page.loading && ready
            ? <X size={15} strokeWidth={1.75} aria-hidden="true" />
            : <RotateCw size={14} strokeWidth={1.75} aria-hidden="true" />}
          label={page.loading && ready ? '停止' : '刷新'}
          size="sm"
          tone="secondary"
          disabled={!ready}
          onClick={() => command((pageId) => page.loading
            ? workspaceBrowserHost.stop(pageId)
            : workspaceBrowserHost.reload(pageId))}
        />
        <div
          className="ml-1 flex h-7 min-w-0 flex-1 items-center gap-1.5 rounded-full bg-[var(--color-surface-container-low)] px-3 text-[12px] text-[var(--color-text-secondary)]"
          title={address}
        >
          <Globe size={13} strokeWidth={1.75} className="shrink-0 text-[var(--color-text-tertiary)]" aria-hidden="true" />
          <span data-testid="star-web-address" className="min-w-0 truncate select-text">{address}</span>
        </div>
        <button
          type="button"
          onClick={() => openExternal(address)}
          className="ml-1 flex h-7 shrink-0 items-center gap-1.5 rounded-[var(--radius-md)] px-2 text-[12px] text-[var(--color-text-secondary)] transition-colors hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-text-primary)]"
        >
          <ExternalLink size={13} strokeWidth={1.75} aria-hidden="true" />
          在浏览器打开
        </button>
      </div>
      <div className="relative min-h-0 flex-1">
        <div ref={stageRef} data-testid="star-web-stage" className="absolute inset-0" />
        {page.loading && !error ? (
          <div className="pointer-events-none absolute inset-x-0 top-0 h-0.5 animate-pulse bg-[var(--color-brand)]" aria-hidden="true" />
        ) : null}
        {error ? (
          <div role="alert" className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-[var(--color-surface)] px-6 text-center">
            <Globe size={22} strokeWidth={1.6} className="text-[var(--color-text-tertiary)]" aria-hidden="true" />
            <div className="text-[14px] font-medium text-[var(--color-text-primary)]">页面打不开</div>
            <div className="max-w-[420px] break-all text-[12px] leading-5 text-[var(--color-text-tertiary)]">{error.message}</div>
            <div className="mt-2 flex items-center gap-2">
              <button
                type="button"
                onClick={retry}
                className="h-8 rounded-[var(--radius-md)] bg-[var(--color-surface-container-high)] px-3 text-[13px] text-[var(--color-text-primary)] hover:bg-[var(--color-surface-hover)]"
              >
                重试
              </button>
              <button
                type="button"
                onClick={() => openExternal(error.url ?? address)}
                className="h-8 rounded-[var(--radius-md)] px-3 text-[13px] text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-text-primary)]"
              >
                在浏览器打开
              </button>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  )
}
