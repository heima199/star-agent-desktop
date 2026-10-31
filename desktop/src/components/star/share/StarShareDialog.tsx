import { useEffect, useMemo, useRef, useState } from 'react'
import QRCode from 'qrcode'
import { Copy, Download, Eye, EyeOff, FileDown, FileText, Link2, Share } from 'lucide-react'

import { sessionsApi } from '@/api/sessions'
import { starApi, starErrorText } from '@/api/star'
import { Button } from '@/components/ui/Button'
import { Checkbox } from '@/components/ui/Checkbox'
import { Modal } from '@/components/ui/Modal'
import { mapHistoryMessagesToUiMessages, useChatStore } from '@/stores/chatStore'
import { useSessionStore } from '@/stores/sessionStore'
import { useStarBrand } from '@/stores/starBrandStore'
import { useStarStore } from '@/stores/starStore'
import { useTabStore } from '@/stores/tabStore'
import { useUIStore } from '@/stores/uiStore'
import type { UIMessage } from '@/types/chat'
import {
  DEFAULT_SHARE_OPTIONS,
  buildConversationMarkdown,
  buildShareTranscript,
  conversationStartedAt,
  exportFileName,
  shareTitle,
  type ShareContentOptions,
} from './conversationExport'
import {
  ShareImageCache,
  downloadBlob,
  renderLongImage,
  renderPdf,
  uploadableImage,
  type LongImageResult,
  type PdfProgress,
  type ShareDocument,
} from './conversationRender'

type Props = {
  open: boolean
  sessionId: string
  onClose: () => void
}

type Busy = 'copy' | 'save' | 'pdf' | 'markdown' | 'link' | 'share'

/** Toggling both options in a row should cost one re-render, not two. */
const PREVIEW_DEBOUNCE_MS = 300

function toast(type: 'success' | 'error' | 'info' | 'warning', message: string) {
  useUIStore.getState().addToast({ type, message })
}

function isAbort(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError'
}

/**
 * 「分享对话」: the conversation as a long image (copy, save, system share, or
 * a STAR link with its QR code), a paged PDF, or Markdown. Mounted only while
 * open (see StarShareButton).
 */
export function StarShareDialog({ open, sessionId, onClose }: Props) {
  const brand = useStarBrand()
  const replying = useChatStore((state) => (state.sessions[sessionId]?.chatState ?? 'idle') !== 'idle')
  const sessionTitle = useSessionStore((state) => state.sessions.find((session) => session.id === sessionId)?.title)
  const workDir = useSessionStore((state) => state.sessions.find((session) => session.id === sessionId)?.workDir ?? null)
  const tabTitle = useTabStore((state) => state.tabs.find((tab) => tab.sessionId === sessionId)?.title)
  const title = shareTitle(sessionTitle || tabTitle)

  const [messages, setMessages] = useState<UIMessage[] | null>(null)
  const [options, setOptions] = useState<ShareContentOptions>(DEFAULT_SHARE_OPTIONS)
  const [previewOptions, setPreviewOptions] = useState<ShareContentOptions>(DEFAULT_SHARE_OPTIONS)
  const [images, setImages] = useState<ShareImageCache | null>(null)
  const [preview, setPreview] = useState<{ url: string; result: LongImageResult } | null>(null)
  const [previewStatus, setPreviewStatus] = useState<'rendering' | 'ready' | 'error'>('rendering')
  const [busy, setBusy] = useState<Busy | null>(null)
  const [pdfProgress, setPdfProgress] = useState<PdfProgress | null>(null)
  const [link, setLink] = useState<{ url: string; qr: string } | null>(null)
  const [showLink, setShowLink] = useState(false)
  const busyRef = useRef(false)
  const previewUrlRef = useRef<string | null>(null)
  const exportAbortRef = useRef<AbortController | null>(null)

  // Created in an effect so a StrictMode remount gets a fresh cache instead of a disposed one.
  useEffect(() => {
    const cache = new ShareImageCache()
    setImages(cache)
    return () => {
      cache.dispose()
      exportAbortRef.current?.abort()
      if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current)
      previewUrlRef.current = null
    }
  }, [])

  // The transcript as it stands once the reply is over. A windowed session has
  // only its newest rows in memory, so the full history is read for it.
  useEffect(() => {
    if (!open || replying) return
    let cancelled = false
    const state = useChatStore.getState().sessions[sessionId]
    const loaded = state?.messages ?? []
    if (state && !state.historyWindowed) {
      setMessages(loaded)
      return
    }
    setMessages(null)
    void sessionsApi.getFullHistory(sessionId).then(
      (history) => {
        if (!cancelled) setMessages(mapHistoryMessagesToUiMessages(history.messages))
      },
      () => {
        if (cancelled) return
        setMessages(loaded)
        if (loaded.length) toast('warning', '没能读取完整对话，分享内容只包含已加载的部分')
        else toast('error', '读取对话失败，请稍后再试')
      },
    )
    return () => {
      cancelled = true
    }
  }, [open, replying, sessionId])

  useEffect(() => {
    if (options === previewOptions) return
    const timer = window.setTimeout(() => setPreviewOptions(options), PREVIEW_DEBOUNCE_MS)
    return () => window.clearTimeout(timer)
  }, [options, previewOptions])

  const startedAt = useMemo(() => (messages ? conversationStartedAt(messages) : null), [messages])
  const previewDocument = useMemo<ShareDocument | null>(
    () => (messages ? { sessionId, workDir, title, rounds: buildShareTranscript(messages, previewOptions), startedAt } : null),
    [messages, previewOptions, sessionId, workDir, title, startedAt],
  )

  useEffect(() => {
    if (!images || !previewDocument || replying || !previewDocument.rounds.length) return
    const controller = new AbortController()
    setPreviewStatus('rendering')
    renderLongImage(previewDocument, images, { signal: controller.signal }).then(
      (result) => {
        if (controller.signal.aborted) return
        const url = URL.createObjectURL(result.blob)
        // The old picture stays on screen until the new one replaces it.
        if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current)
        previewUrlRef.current = url
        setPreview({ url, result })
        setPreviewStatus('ready')
      },
      (error: unknown) => {
        if (controller.signal.aborted || isAbort(error)) return
        setPreviewStatus('error')
      },
    )
    return () => controller.abort()
  }, [images, previewDocument, replying])

  // A link and its QR code belong to the picture they were made from.
  useEffect(() => {
    setLink(null)
    setShowLink(false)
  }, [previewDocument])

  const shareFile = useMemo(
    () => (preview ? new File([preview.result.blob], exportFileName(title, new Date(), 'png'), { type: 'image/png' }) : null),
    [preview, title],
  )
  const canShareFiles = useMemo(() => {
    if (!shareFile || typeof navigator.canShare !== 'function') return false
    try {
      return navigator.canShare({ files: [shareFile] })
    } catch {
      return false
    }
  }, [shareFile])

  const loading = messages === null && !replying
  const empty = previewDocument !== null && previewDocument.rounds.length === 0
  // What Copy, Save, Share and the link hand out must be the picture of the current options.
  const imageReady = !replying && !empty && previewStatus === 'ready' && options === previewOptions && preview !== null
  const exportReady = !replying && messages !== null && !empty
  const locked = busy !== null
  const truncation = imageReady && preview?.result.truncated ? preview.result : null

  const run = (kind: Busy, task: () => Promise<void>) => {
    if (busyRef.current) return
    busyRef.current = true
    setBusy(kind)
    void task()
      .catch(() => toast('error', '操作失败，请稍后再试'))
      .finally(() => {
        busyRef.current = false
        setBusy(null)
      })
  }

  const exportRounds = () => (messages ? buildShareTranscript(messages, options) : [])

  const copyImage = () => run('copy', async () => {
    const blob = preview?.result.blob
    if (!blob) return
    try {
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })])
      toast('success', '图片已复制')
    } catch {
      toast('error', '复制图片失败，可以改用「保存图片」或「导出 PDF」')
    }
  })

  const saveImage = () => run('save', async () => {
    const blob = preview?.result.blob
    if (!blob) return
    try {
      downloadBlob(blob, exportFileName(title, new Date(), 'png'))
    } catch {
      toast('error', '保存图片失败，请稍后再试')
    }
  })

  const exportPdf = () => run('pdf', async () => {
    const rounds = exportRounds()
    if (!images || !rounds.length) {
      toast('warning', '这段对话还没有可以导出的内容')
      return
    }
    const controller = new AbortController()
    exportAbortRef.current = controller
    setPdfProgress({ page: 0, total: 0 })
    try {
      const { blob, pages } = await renderPdf(
        { sessionId, workDir, title, rounds, startedAt },
        images,
        setPdfProgress,
        { signal: controller.signal },
      )
      downloadBlob(blob, exportFileName(title, new Date(), 'pdf'))
      toast('success', `PDF 已导出，共 ${pages} 页`)
    } catch (error) {
      if (!isAbort(error)) toast('error', 'PDF 导出失败，请稍后再试')
    } finally {
      if (exportAbortRef.current === controller) exportAbortRef.current = null
      setPdfProgress(null)
    }
  })

  const exportMarkdown = () => run('markdown', async () => {
    const rounds = exportRounds()
    if (!rounds.length) {
      toast('warning', '这段对话还没有可以导出的内容')
      return
    }
    try {
      const now = new Date()
      const markdown = buildConversationMarkdown({ title, rounds, generatedAt: now })
      downloadBlob(new Blob([markdown], { type: 'text/markdown;charset=utf-8' }), exportFileName(title, now, 'md'))
    } catch {
      toast('error', '导出 Markdown 失败，请稍后再试')
    }
  })

  const createLink = () => run('link', async () => {
    const blob = preview?.result.blob
    if (!blob) return
    const star = useStarStore.getState()
    const status = star.status ?? await star.refreshStatus()
    if (!status?.signedIn) {
      toast('info', `登录 ${brand.name} 后才能生成分享链接`)
      useStarStore.getState().openLogin()
      return
    }
    try {
      const upload = await uploadableImage(blob)
      const url = await starApi.uploadReference(upload, 'image', exportFileName(title, new Date(), 'jpg'))
      const qr = await QRCode.toDataURL(url, { margin: 1, width: 200 })
      setLink({ url, qr })
      setShowLink(false)
    } catch (error) {
      toast('error', `生成分享链接失败：${starErrorText(error)}`)
    }
  })

  const copyLink = async () => {
    if (!link) return
    try {
      await navigator.clipboard.writeText(link.url)
      toast('success', '链接已复制')
    } catch {
      toast('error', '复制链接失败，请稍后再试')
    }
  }

  const systemShare = () => run('share', async () => {
    if (!shareFile) return
    try {
      await navigator.share({ files: [shareFile], title })
    } catch (error) {
      // Closing the share sheet rejects with AbortError; that is a choice, not a failure.
      if (!isAbort(error)) toast('error', '系统分享失败，可以改用「保存图片」')
    }
  })

  const placeholder = replying
    ? '回复完成后再分享'
    : loading
      ? '正在读取对话…'
      : empty
        ? '这段对话还没有可以分享的内容'
        : previewStatus === 'error'
          ? '长图生成失败'
          : '正在生成长图…'
  const visiblePreview = !replying && !loading && !empty ? preview : null
  const progressPercent = pdfProgress && pdfProgress.total > 0
    ? Math.min(100, Math.round(((pdfProgress.page - 1) / pdfProgress.total) * 100))
    : 0

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="分享对话"
      width={760}
      typography="interface"
      footer={
        <>
          {canShareFiles ? (
            <Button variant="ghost" size="base" onClick={systemShare} disabled={!imageReady || locked} loading={busy === 'share'} icon={<Share size={14} strokeWidth={1.75} aria-hidden="true" />}>
              系统分享
            </Button>
          ) : null}
          <Button variant="secondary" size="base" onClick={exportMarkdown} disabled={!exportReady || locked} loading={busy === 'markdown'} icon={<FileText size={14} strokeWidth={1.75} aria-hidden="true" />}>
            导出 Markdown
          </Button>
          <Button variant="secondary" size="base" onClick={exportPdf} disabled={!exportReady || locked} loading={busy === 'pdf'} icon={<FileDown size={14} strokeWidth={1.75} aria-hidden="true" />}>
            导出 PDF
          </Button>
          <Button variant="secondary" size="base" onClick={saveImage} disabled={!imageReady || locked} loading={busy === 'save'} icon={<Download size={14} strokeWidth={1.75} aria-hidden="true" />}>
            保存图片
          </Button>
          <Button variant="primary" size="base" onClick={copyImage} disabled={!imageReady || locked} loading={busy === 'copy'} icon={<Copy size={14} strokeWidth={1.75} aria-hidden="true" />}>
            复制图片
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4" data-testid="star-share-dialog">
        <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
          <Checkbox
            label="包含工具调用"
            checked={options.includeTools}
            disabled={locked}
            onChange={(event) => {
              const includeTools = event.target.checked
              setOptions((current) => ({ ...current, includeTools }))
            }}
          />
          <Checkbox
            label="包含思考过程"
            checked={options.includeThinking}
            disabled={locked}
            onChange={(event) => {
              const includeThinking = event.target.checked
              setOptions((current) => ({ ...current, includeThinking }))
            }}
          />
          {previewDocument && !empty ? (
            <span className="ml-auto text-[12px] text-[var(--color-text-tertiary)]">
              {previewDocument.rounds.length} 轮对话{visiblePreview && !imageReady && previewStatus !== 'error' ? ' · 正在更新预览…' : ''}
            </span>
          ) : null}
        </div>

        <div className="max-h-[52vh] min-h-[240px] overflow-y-auto rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-surface-container-low)]">
          {visiblePreview ? (
            <img
              src={visiblePreview.url}
              alt="长图预览"
              className={`block w-full transition-opacity duration-150 ${imageReady ? '' : 'opacity-60'}`}
            />
          ) : (
            <div className="flex min-h-[240px] items-center justify-center p-6 text-center text-[13px] text-[var(--color-text-tertiary)]">
              {placeholder}
            </div>
          )}
        </div>

        {previewStatus === 'error' && !replying && !empty ? (
          <div role="alert" className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-[var(--radius-md)] bg-[var(--color-error-container)] px-3 py-2 text-[13px] text-[var(--color-on-error-container)]">
            <span>长图生成失败，对话可能太长了，请改用 PDF 导出完整内容</span>
            <Button variant="link" size="sm" onClick={exportPdf} disabled={!exportReady || locked}>导出 PDF</Button>
          </div>
        ) : truncation ? (
          <div role="status" className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-[var(--radius-md)] bg-[var(--color-warning-container)] px-3 py-2 text-[13px] text-[var(--color-on-warning-container)]">
            <span>
              {truncation.partial
                ? '对话较长，长图只包含第 1 轮的部分内容；完整内容请导出 PDF'
                : `对话较长，长图只包含前 ${truncation.rounds} 轮；完整内容请导出 PDF`}
            </span>
            <Button variant="link" size="sm" onClick={exportPdf} disabled={!exportReady || locked}>导出 PDF</Button>
          </div>
        ) : null}

        {pdfProgress ? (
          <div role="status" aria-live="polite" className="flex flex-col gap-1.5">
            <span className="text-[12px] text-[var(--color-text-secondary)]">
              {pdfProgress.page > 0 ? `正在生成第 ${pdfProgress.page} / ${pdfProgress.total} 页…` : '正在准备 PDF…'}
            </span>
            <div className="h-1 overflow-hidden rounded-full bg-[var(--color-surface-container)]">
              <div className="h-full rounded-full bg-[var(--color-brand)] transition-[width] duration-300" style={{ width: `${progressPercent}%` }} />
            </div>
          </div>
        ) : null}

        <section aria-label="分享链接" className="flex flex-wrap items-center gap-4 rounded-[var(--radius-lg)] border border-[var(--color-border)] p-4">
          {link ? (
            <>
              <img
                src={link.qr}
                alt="分享二维码"
                width={120}
                height={120}
                className="h-[120px] w-[120px] shrink-0 rounded-[var(--radius-sm)] border border-[var(--color-border)]"
              />
              <div className="flex min-w-0 flex-1 flex-col gap-2">
                <div className="text-[13px] font-medium text-[var(--color-text-primary)]">扫码查看长图，或复制链接发给对方</div>
                <div className="text-[12px] text-[var(--color-text-tertiary)]">拿到链接的人都能查看这张长图</div>
                <div className="flex flex-wrap gap-2">
                  <Button variant="secondary" size="sm" onClick={() => void copyLink()} icon={<Copy size={13} strokeWidth={1.75} aria-hidden="true" />}>
                    复制链接
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    aria-pressed={showLink}
                    onClick={() => setShowLink((value) => !value)}
                    icon={showLink ? <EyeOff size={13} strokeWidth={1.75} aria-hidden="true" /> : <Eye size={13} strokeWidth={1.75} aria-hidden="true" />}
                  >
                    {showLink ? '隐藏链接' : '显示链接'}
                  </Button>
                </div>
                {showLink ? (
                  <input
                    readOnly
                    value={link.url}
                    aria-label="分享链接地址"
                    onFocus={(event) => event.currentTarget.select()}
                    className="h-8 w-full min-w-0 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface-container-low)] px-2.5 text-[12px] text-[var(--color-text-secondary)] outline-none focus-visible:border-[var(--color-border-focus)]"
                  />
                ) : null}
              </div>
            </>
          ) : (
            <>
              <div className="min-w-0 flex-1">
                <div className="text-[13px] font-medium text-[var(--color-text-primary)]">分享链接</div>
                <div className="mt-0.5 text-[12px] text-[var(--color-text-tertiary)]">长图会上传到 {brand.name}，拿到链接的人都能查看</div>
              </div>
              <Button
                variant="secondary"
                size="base"
                onClick={createLink}
                disabled={!imageReady || locked}
                loading={busy === 'link'}
                icon={<Link2 size={14} strokeWidth={1.75} aria-hidden="true" />}
              >
                生成分享链接
              </Button>
            </>
          )}
        </section>
      </div>
    </Modal>
  )
}
