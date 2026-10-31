import { useMemo, useRef, useState } from 'react'
import { AppWindow, Camera, Loader2 } from 'lucide-react'
import { withSnapshotBridge, type McpHtmlUi } from '@/lib/mcpHtmlUi'
import { renderHtmlSnapshot, requestFrameSnapshot } from '@/lib/mcpUiSnapshot'
import type { TranslationKey } from '../../i18n'
import { useChatStore } from '../../stores/chatStore'
import { useUIStore } from '../../stores/uiStore'
import { useChatSessionId } from './chatSessionContext'

type Translate = (key: TranslationKey, values?: Record<string, string | number>) => string

const headButton = 'inline-flex shrink-0 items-center gap-1 rounded-[var(--radius-sm)] px-1.5 py-0.5 text-[12px] text-[var(--color-text-tertiary)] transition-colors hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-text-primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-border-focus)] disabled:opacity-60'

/**
 * An MCP tool's HTML interface, live in the conversation. The frame runs the
 * page's scripts (it is meant to be worked) but has no same-origin access, so
 * it cannot read the app, its storage or the user's files, and it may not
 * navigate the window or open others.
 *
 * 添加快照到对话 puts a picture of the view as it is now (after the user
 * worked it) into this conversation's composer, like a pasted image.
 */
export function McpHtmlView({ ui, t }: { ui: McpHtmlUi; t: Translate }) {
  const [open, setOpen] = useState(true)
  const [capturing, setCapturing] = useState(false)
  const frameRef = useRef<HTMLIFrameElement>(null)
  const sessionId = useChatSessionId()
  const srcDoc = useMemo(() => withSnapshotBridge(ui.html), [ui.html])
  const title = t('tool.mcpUi.title')

  const addSnapshot = async () => {
    const frame = frameRef.current
    if (!frame || !sessionId || capturing) return
    setCapturing(true)
    try {
      // The page as the user left it; the tool's own page when it cannot answer.
      const live = await requestFrameSnapshot(frame)
      const width = frame.clientWidth || 800
      const height = Math.max(frame.clientHeight || 420, live?.height ?? 0)
      const image = await renderHtmlSnapshot(live?.html ?? ui.html, width, height)
      useChatStore.getState().queueComposerPrefill(sessionId, {
        text: '',
        mode: 'append',
        attachments: [{ type: 'image', name: 'mcp-ui-snapshot.png', mimeType: 'image/png', data: image }],
      })
      useUIStore.getState().addToast({ type: 'success', message: t('tool.mcpUi.snapshotAdded') })
    } catch {
      useUIStore.getState().addToast({ type: 'error', message: t('tool.mcpUi.snapshotFailed') })
    } finally {
      setCapturing(false)
    }
  }

  return (
    <div data-mcp-html-view="" className="overflow-hidden rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface-container-lowest)]">
      <div className="flex min-h-8 items-center gap-2 border-b border-[var(--color-border)] px-3 py-1.5 text-[12px] text-[var(--color-text-secondary)]">
        <AppWindow size={13} strokeWidth={1.75} aria-hidden="true" className="shrink-0 text-[var(--color-text-tertiary)]" />
        <span className="shrink-0 font-medium text-[var(--color-text-primary)]">{title}</span>
        {ui.uri ? <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-[var(--color-text-tertiary)]" title={ui.uri}>{ui.uri}</span> : <span className="flex-1" />}
        {open && sessionId ? (
          <button type="button" disabled={capturing} onClick={() => void addSnapshot()} className={headButton}>
            {capturing
              ? <Loader2 size={12} strokeWidth={1.75} aria-hidden="true" className="animate-spin" />
              : <Camera size={12} strokeWidth={1.75} aria-hidden="true" />}
            {capturing ? t('tool.mcpUi.snapshotting') : t('tool.mcpUi.addSnapshot')}
          </button>
        ) : null}
        <button
          type="button"
          aria-expanded={open}
          onClick={() => setOpen(value => !value)}
          className={headButton}
        >
          {open ? t('tool.mcpUi.hide') : t('tool.mcpUi.show')}
        </button>
      </div>
      {open ? (
        <>
          {/* resize-y on the wrapper: a frame cannot be resized itself. */}
          <div className="h-[420px] min-h-[160px] resize-y overflow-hidden bg-white">
            <iframe
              ref={frameRef}
              title={title}
              srcDoc={srcDoc}
              sandbox="allow-scripts allow-forms"
              referrerPolicy="no-referrer"
              className="block h-full w-full border-0"
            />
          </div>
          <p className="px-3 py-1.5 text-[11px] text-[var(--color-text-tertiary)]">{t('tool.mcpUi.hint')}</p>
        </>
      ) : null}
    </div>
  )
}
