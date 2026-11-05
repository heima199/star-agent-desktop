import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Archive, ArrowUp, Check, ChevronLeft, FolderOpen, History, ImagePlus, Loader2, Mail, MessageSquarePlus, PanelLeftClose, PanelLeftOpen, Plus, Shield, X } from 'lucide-react'
import { starApi, starErrorText, type DesignProject } from '@/api/star'
import { sessionsApi } from '@/api/sessions'
import { ApiError } from '@/api/client'
import type { SessionListItem } from '@/types/session'
import { Modal } from '@/components/ui/Modal'
import { BrandSeal } from '@/components/composite/BrandSeal'
import { getPermissionTitle } from '@/components/chat/permissionPresentation'
import { isExitPlanModeTool } from '@/components/chat/PlanModePreview'
import { useDismissable } from '@/hooks/useDismissable'
import { useTranslation } from '@/i18n'
import { getDesktopHost } from '@/lib/desktopHost'
import { ActiveSession } from '../../ActiveSession'
import { ComposerPlaceholderProvider, ComposerTrayProvider } from '@/components/chat/composerTray'
import { listPendingPermissions, useChatStore } from '../../../stores/chatStore'
import { showEmbeddedSession } from '../../../stores/hiddenSessionRelease'
import { useSessionStore } from '../../../stores/sessionStore'
import { useTrajectoryViewStore } from '../../../stores/trajectoryViewStore'
import { useUIStore } from '../../../stores/uiStore'
import { formatDate } from '../pages/StarPageShell'
import { DesignCanvas } from './DesignCanvas'
import { canMessageDesignAgent, designKind } from './designModel'
import { useStarStore } from '../../../stores/starStore'
import { getStarBrandName, useStarBrand } from '../../../stores/starBrandStore'

const toast = (type: 'success' | 'error' | 'info', message: string) => useUIStore.getState().addToast({ type, message })
const sentPrompts = new Set<string>()

/** The Design chat is for changing the design, not for code. `{brand}`: the console's product name. */
const DESIGN_COMPOSER_PLACEHOLDER = '告诉 {brand} 要怎么改这个设计，例如：标题换成金色、背景改成深蓝渐变'
/** The chat column's narrowest width: SessionChatSurface keeps its column at least this wide. */
const CHAT_MIN_WIDTH = 360
const CHAT_MAX_WIDTH = 680

function wrapFirstMessage(project: DesignProject, text: string): string {
  const kind = designKind(project.kind)
  return `${text}\n\n（${getStarBrandName()} Design：这是设计项目「${project.title}」，类型：${kind.label}，默认画板 ${project.width}×${project.height}。开始前先阅读 .star/brief.md 了解画板产出约定；所有画板写到 artboards/ 目录，右侧画布会实时显示。）`
}

export function DesignWorkspace({ projectId, initialPrompt, onBack }: { projectId: string; initialPrompt?: string; onBack: () => void }) {
  const brand = useStarBrand()
  const [project, setProject] = useState<DesignProject | null>(null)
  // The chat this window shows instead of the project's saved one: a stand-in
  // for a saved chat it cannot find, or '' for a new chat not sent yet.
  const [chatOverride, setChatOverride] = useState<string | null>(null)
  const [chatOpen, setChatOpen] = useState(true)
  const [chatWidth, setChatWidth] = useState(420)
  const [historyOpen, setHistoryOpen] = useState(false)
  const [history, setHistory] = useState<SessionListItem[] | null>(null)
  const historyRef = useRef<HTMLDivElement>(null)
  useDismissable({ open: historyOpen, refs: [historyRef], onDismiss: () => setHistoryOpen(false) })
  const [libraryOpen, setLibraryOpen] = useState(false)
  const [feedbackOpen, setFeedbackOpen] = useState(false)
  const [draft, setDraft] = useState('')
  const [sending, setSending] = useState(false)
  const projectRef = useRef<DesignProject | null>(null)
  projectRef.current = project
  const sessionId = chatOverride ?? project?.sessionId ?? ''
  const sessionRef = useRef(sessionId)
  sessionRef.current = sessionId
  const running = useChatStore(s => (sessionId ? (s.sessions[sessionId]?.chatState ?? 'idle') !== 'idle' : false))
  // null while the STAR status is loading.
  const starSignedIn = useStarStore(s => (s.status ? s.status.signedIn : null))

  // The chat column is not a tab. Unregistered, its session reads as hidden:
  // it loses its socket and transcript when a turn ends, and the replies to the
  // next message (and any approval it asks for) never reach this column.
  useLayoutEffect(() => (sessionId ? showEmbeddedSession(sessionId) : undefined), [sessionId])

  const onBackRef = useRef(onBack)
  onBackRef.current = onBack
  const load = useCallback(async () => {
    try {
      const { project: next } = await starApi.designProject(projectId)
      setProject(current => (current && JSON.stringify(current) === JSON.stringify(next) ? current : next))
      return next
    } catch (error) {
      // A project reopened after a reload may have been deleted since: back to
      // the Design home instead of spinning on "打开设计项目…".
      if (error instanceof ApiError && error.status === 404) {
        onBackRef.current()
        return null
      }
      toast('error', starErrorText(error))
      return null
    }
  }, [projectId])

  // The project names its chat. One this window cannot find (deleted, or kept
  // by another STAR window with its own data folder) is stood in for by the
  // newest chat that ran in the project folder, without rewriting the project:
  // clearing it here used to unlink the chat for every other window too.
  useEffect(() => {
    let cancelled = false
    void load().then(async next => {
      if (cancelled || !next) return
      if (next.sessionId) {
        try {
          await sessionsApi.getSummary(next.sessionId)
          return
        } catch (error) {
          if (!(error instanceof ApiError && error.status === 404)) return
        }
      }
      const latest = await sessionsApi.listProjectHistory({ projectRoot: next.dir, limit: 1 })
        .then(result => result.sessions[0]?.id ?? '')
        .catch(() => '')
      if (cancelled) return
      if (next.sessionId) {
        setChatOverride(latest)
      } else if (latest) {
        // Unlinked, with a chat in its folder (an older build cleared the link): link it again.
        const { project: linked } = await starApi.patchDesignProject(next.id, { sessionId: latest })
        if (!cancelled) setProject(linked)
      }
    })
    return () => { cancelled = true }
  }, [load])

  // The agent writes boards while it runs; poll faster then.
  useEffect(() => {
    const timer = window.setInterval(() => { if (document.visibilityState === 'visible') void load() }, running ? 2000 : 6000)
    return () => window.clearInterval(timer)
  }, [load, running])

  const send = useCallback(async (text: string) => {
    const current = projectRef.current
    if (!current || !text.trim()) return
    // Signed out, the sign-in opens and the draft stays as typed.
    if (!(await canMessageDesignAgent())) return
    setSending(true)
    try {
      let id = sessionRef.current
      let wrapped = text
      if (!id) {
        id = await useSessionStore.getState().createSession(current.dir, { permissionMode: 'acceptEdits' })
        const { project: next } = await starApi.patchDesignProject(current.id, { sessionId: id })
        setProject(next)
        setChatOverride(null)
        wrapped = wrapFirstMessage(next, text)
      }
      useChatStore.getState().connectToSession(id)
      const chat = useChatStore.getState()
      // Board actions can arrive mid-reply: the message waits its turn in the
      // queue, as one typed into the composer does, instead of cutting in.
      if ((chat.sessions[id]?.chatState ?? 'idle') !== 'idle') chat.queueUserMessage(id, { content: wrapped, displayContent: text })
      else chat.sendMessage(id, wrapped, [], { displayContent: text })
      setDraft('')
    } catch (error) {
      toast('error', starErrorText(error))
    }
    setSending(false)
  }, [])

  useEffect(() => {
    if (!project || !initialPrompt || project.sessionId) return
    // The first message waits for the sign-in, and goes out once it is done.
    if (starSignedIn === false) return
    const key = `${project.id}\0${initialPrompt}`
    if (sentPrompts.has(key)) return
    sentPrompts.add(key)
    void send(initialPrompt)
  }, [initialPrompt, project, send, starSignedIn])

  // 历史对话 lists the chats that ran in the project folder, read on each open.
  const projectDir = project?.dir ?? ''
  useEffect(() => {
    if (!historyOpen || !projectDir) return
    let cancelled = false
    setHistory(null)
    sessionsApi.listProjectHistory({ projectRoot: projectDir, limit: 30 })
      .then(result => { if (!cancelled) setHistory(result.sessions) })
      .catch(() => { if (!cancelled) setHistory([]) })
    return () => { cancelled = true }
  }, [historyOpen, projectDir])

  const openChat = async (id: string) => {
    setHistoryOpen(false)
    const current = projectRef.current
    if (!current) return
    try {
      const { project: next } = await starApi.patchDesignProject(current.id, { sessionId: id })
      setProject(next)
      setChatOverride(null)
    } catch (error) {
      toast('error', starErrorText(error))
    }
  }

  const chatRef = useRef<HTMLDivElement>(null)
  const waiting = useChatStore(s => (sessionId ? listPendingPermissions(s.sessions[sessionId]).length : 0))
  // The request card is the chat's last row; in this narrow column it can sit
  // below the fold, or under 轨迹, while the reply only shows 处理中.
  const showRequest = () => {
    if (!sessionId) return
    setChatOpen(true)
    useTrajectoryViewStore.getState().setMode(sessionId, 'chat')
    // After the column and the 对话 view have rendered; a timer, not a frame,
    // so it also lands when the window is in the background.
    window.setTimeout(() => {
      const list = chatRef.current?.querySelector<HTMLElement>('.chat-scroll-area')
      list?.scrollTo({ top: list.scrollHeight })
    }, 60)
  }

  const startResize = (event: React.PointerEvent) => {
    const startX = event.clientX
    const startWidth = chatWidth
    // Never narrower than the chat column itself: below it the header switch
    // and the composer's right edge were cut off instead of reflowing.
    const move = (next: PointerEvent) => setChatWidth(Math.min(CHAT_MAX_WIDTH, Math.max(CHAT_MIN_WIDTH, startWidth + next.clientX - startX)))
    const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up) }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  const attach = async (files: FileList) => {
    if (!project) return
    const names: string[] = []
    for (const file of Array.from(files)) {
      try {
        names.push((await starApi.uploadDesignAsset(project.id, file, file.name)).path)
      } catch (error) {
        toast('error', starErrorText(error))
      }
    }
    if (names.length) {
      setDraft(current => `${current}${current ? '\n' : ''}参考素材：${names.join('、')}`)
      void load()
    }
  }

  if (!project) return <div className="flex h-full items-center justify-center text-[13px] text-[var(--color-text-tertiary)]"><Loader2 size={16} className="mr-2 animate-spin" aria-hidden="true" />打开设计项目…</div>
  const kind = designKind(project.kind)

  return (
    <div className="flex h-full min-h-0 bg-[var(--color-surface)]">
      {chatOpen ? (
        <aside className="relative flex h-full shrink-0 flex-col border-r border-[var(--color-border)]" style={{ width: chatWidth }}>
          <header className="flex h-11 shrink-0 items-center gap-1 border-b border-[var(--color-border)] px-2">
            <button type="button" aria-label="返回 Design 首页" onClick={onBack} className="rounded p-1 text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-hover)]"><ChevronLeft size={16} aria-hidden="true" /></button>
            <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-[var(--color-text-primary)]" title={project.title}>{project.title}</span>
            {/* A new chat stays a draft until its first message: leaving before
                sending keeps the project on the chat it had. */}
            <button type="button" aria-label="新对话" title="为这个项目开始新对话" onClick={() => setChatOverride('')} className="rounded p-1 text-[var(--color-text-tertiary)] hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-text-primary)]"><MessageSquarePlus size={15} aria-hidden="true" /></button>
            <div ref={historyRef} className="relative">
              <button type="button" aria-label="历史对话" title="这个项目的历史对话" aria-expanded={historyOpen} onClick={() => setHistoryOpen(open => !open)} className={`rounded p-1 hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-text-primary)] ${historyOpen ? 'text-[var(--color-text-primary)]' : 'text-[var(--color-text-tertiary)]'}`}><History size={15} aria-hidden="true" /></button>
              {historyOpen ? (
                <div role="menu" aria-label="历史对话" className="absolute right-0 top-8 z-[var(--z-dropdown)] w-[280px] rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-surface-container-lowest)] p-1 shadow-[var(--shadow-dropdown)]">
                  {history === null ? <div className="flex items-center gap-2 px-2.5 py-2 text-[12px] text-[var(--color-text-tertiary)]"><Loader2 size={13} className="animate-spin" aria-hidden="true" />加载中…</div>
                    : history.length === 0 ? <div className="px-2.5 py-2 text-[12px] text-[var(--color-text-tertiary)]">这个项目还没有对话</div>
                      : <div className="max-h-[320px] overflow-y-auto">{history.map(item => (
                        <button key={item.id} type="button" role="menuitem" onClick={() => void openChat(item.id)} className="flex w-full items-center gap-2 rounded-[var(--radius-sm)] px-2.5 py-1.5 text-left hover:bg-[var(--color-surface-hover)]">
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-[12px] text-[var(--color-text-primary)]">{item.title || '未命名对话'}</span>
                            <span className="block text-[11px] text-[var(--color-text-tertiary)]">{formatDate(item.modifiedAt)} · {item.messageCount} 条消息</span>
                          </span>
                          {item.id === sessionId ? <Check size={13} className="shrink-0 text-[var(--color-text-secondary)]" aria-label="当前对话" /> : null}
                        </button>
                      ))}</div>}
                </div>
              ) : null}
            </div>
            <button type="button" aria-label="收起对话" onClick={() => setChatOpen(false)} className="rounded p-1 text-[var(--color-text-tertiary)] hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-text-primary)]"><PanelLeftClose size={15} aria-hidden="true" /></button>
          </header>
          {sessionId ? (
            <>
              <DesignApprovalBar sessionId={sessionId} onShow={showRequest} />
              {/* The narrow chat column gives its composer a second strip for the
                  folder and permission controls, so the input row is not crammed. */}
              <div ref={chatRef} className="relative min-h-0 flex-1 overflow-hidden" data-testid="design-chat"><div className="absolute inset-0 flex min-h-0 flex-col"><ComposerTrayProvider value><ComposerPlaceholderProvider value={brand.format(DESIGN_COMPOSER_PLACEHOLDER)}><ActiveSession sessionId={sessionId} active /></ComposerPlaceholderProvider></ComposerTrayProvider></div></div>
            </>
          ) : (
            <div className="flex min-h-0 flex-1 flex-col">
              <div className="flex flex-1 flex-col items-center justify-center gap-3 px-6 text-center">
                <BrandSeal size="md" />
                <div className="text-[14px] text-[var(--color-text-secondary)]">Hi，接下来如何开始创作？</div>
                <div className="text-[12px] text-[var(--color-text-tertiary)]">{kind.label} · {project.width}×{project.height}{project.systemId ? ` · 设计系统 ${project.systemId}` : ''}</div>
              </div>
              <div className="m-3 rounded-[var(--radius-xl)] border border-[var(--color-border)] bg-[var(--color-surface-container-lowest)] p-2">
                <textarea value={draft} onChange={event => setDraft(event.target.value)} rows={4} placeholder="描述你想要的设计，例如：一张科技峰会的竖版海报，主色深蓝，标题「未来已来」"
                  onKeyDown={event => { if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); void send(draft) } }}
                  className="w-full resize-none bg-transparent px-1.5 text-[13px] leading-6 text-[var(--color-text-primary)] outline-none placeholder:text-[var(--color-text-tertiary)]" />
                <div className="flex items-center gap-1">
                  <label aria-label="添加参考图" title="添加参考图" className="cursor-pointer rounded p-1.5 text-[var(--color-text-tertiary)] hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-text-primary)]"><ImagePlus size={15} aria-hidden="true" /><input type="file" multiple accept="image/*" className="hidden" onChange={event => { if (event.target.files?.length) void attach(event.target.files); event.target.value = '' }} /></label>
                  <span className="flex-1" />
                  <button type="button" aria-label="发送" disabled={!draft.trim() || sending} onClick={() => void send(draft)} className="flex h-8 w-8 items-center justify-center rounded-full bg-[var(--color-btn-primary-bg)] text-[var(--color-btn-primary-fg)] disabled:opacity-40">{sending ? <Loader2 size={15} className="animate-spin" aria-hidden="true" /> : <ArrowUp size={15} aria-hidden="true" />}</button>
                </div>
              </div>
            </div>
          )}
          <div role="separator" aria-orientation="vertical" onPointerDown={startResize} className="resize-line absolute -right-1 top-0 z-20 h-full w-2 cursor-col-resize" />
        </aside>
      ) : null}
      <section className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-11 shrink-0 items-center gap-1 border-b border-[var(--color-border)] px-2">
          {!chatOpen ? <button type="button" aria-label="展开对话" onClick={() => setChatOpen(true)} className="rounded p-1.5 text-[var(--color-text-tertiary)] hover:bg-[var(--color-surface-hover)]"><PanelLeftOpen size={15} aria-hidden="true" /></button> : null}
          {!chatOpen && waiting > 0 ? (
            <button type="button" onClick={showRequest} className="inline-flex h-7 shrink-0 items-center gap-1 rounded-[var(--radius-md)] bg-[var(--color-warning-container)] px-2 text-[12px] text-[var(--color-on-warning-container)]">
              <Shield size={13} aria-hidden="true" />等你确认
            </button>
          ) : null}
          <button type="button" aria-label="文件库" title="文件库" onClick={() => setLibraryOpen(open => !open)} className={`rounded p-1.5 ${libraryOpen ? 'bg-[var(--color-surface-container-high)] text-[var(--color-text-primary)]' : 'text-[var(--color-text-tertiary)] hover:bg-[var(--color-surface-hover)]'}`}><Archive size={15} aria-hidden="true" /></button>
          <span className="mx-1 h-4 w-px bg-[var(--color-border)]" />
          <button type="button" aria-label="新建设计" title="新建设计" onClick={onBack} className="rounded p-1.5 text-[var(--color-text-tertiary)] hover:bg-[var(--color-surface-hover)]"><Plus size={15} aria-hidden="true" /></button>
          <span className="min-w-0 flex-1 truncate px-2 text-center text-[12px] text-[var(--color-text-tertiary)]">{project.title} · {kind.label} · {project.width}×{project.height}{project.style ? ` · ${project.style}` : ''}{waiting > 0 ? ' · 等你确认' : running ? ` · ${brand.name} 正在创作…` : ''}</span>
          <button type="button" aria-label="打开项目文件夹" title="打开项目文件夹" onClick={() => void getDesktopHost().shell.openPath(project.dir)} className="rounded p-1.5 text-[var(--color-text-tertiary)] hover:bg-[var(--color-surface-hover)]"><FolderOpen size={15} aria-hidden="true" /></button>
          <button type="button" aria-label="用户反馈" title="用户反馈" onClick={() => setFeedbackOpen(true)} className="rounded p-1.5 text-[var(--color-text-tertiary)] hover:bg-[var(--color-surface-hover)]"><Mail size={15} aria-hidden="true" /></button>
        </header>
        <div className="min-h-0 flex-1">
          <DesignCanvas project={project} onProject={setProject} onAskAgent={text => void send(text)} libraryOpen={libraryOpen} />
        </div>
      </section>
      <FeedbackDialog open={feedbackOpen} onClose={() => setFeedbackOpen(false)} />
    </div>
  )
}

/** STAR's own tools by their names in the 创作 menu (see starMcpTools on the server). */
const STAR_TOOL_LABELS: Record<string, string> = {
  star_text_to_image: '文生图',
  star_image_to_image: '图生图',
  star_text_to_video: '文生视频',
  star_image_to_video: '图生视频',
  star_video_to_video: '视频参考生成视频',
  star_vision: '多模态识图',
  star_extract_file: '文件识别',
  star_web_search: '联网搜索',
  star_academic_search: '学术论文搜索',
  star_read_url: '网页阅读',
}

function requestTitle(toolName: string, fallback: () => string): string {
  const starTool = /^mcp__plugin_star-[a-z]+_star__(\w+)$/.exec(toolName)?.[1]
  return starTool ? `${getStarBrandName()} 想用「${STAR_TOOL_LABELS[starTool] ?? starTool}」继续创作` : fallback()
}

/**
 * What the design chat is waiting on, pinned above the conversation. A tool
 * request is answered here; a question or a plan needs its full card, so the
 * bar only leads to it.
 */
function DesignApprovalBar({ sessionId, onShow }: { sessionId: string; onShow: () => void }) {
  const t = useTranslation()
  const brand = useStarBrand()
  // The stored record, not a fresh list: a stable value for the selector.
  const request = useChatStore(s => listPendingPermissions(s.sessions[sessionId])[0] ?? null)
  const count = useChatStore(s => listPendingPermissions(s.sessions[sessionId]).length)
  const respond = useChatStore(s => s.respondToPermission)
  if (!request) return null
  const question = request.toolName === 'AskUserQuestion'
  const card = question || isExitPlanModeTool(request.toolName)
  const title = question ? `${brand.name} 有问题需要你回答` : card ? `${brand.name} 的计划等你确认`
    : requestTitle(request.toolName, () => getPermissionTitle(request.toolName, request.input, t, request.displayName))
  const quiet = 'h-6 shrink-0 whitespace-nowrap rounded-[var(--radius-sm)] px-2 text-[12px] hover:bg-[var(--color-surface-hover)]'
  return (
    <div role="status" data-testid="design-approval-bar" className="flex shrink-0 items-center gap-1 border-b border-[var(--color-border)] bg-[var(--color-warning-container)] py-1.5 pl-3 pr-2 text-[12px] text-[var(--color-on-warning-container)]">
      <Shield size={13} className="shrink-0" aria-hidden="true" />
      {/* The title leads to the full card in the chat, with the tool's input. */}
      <button type="button" onClick={onShow} title={`${title}（查看详情）`} className="min-w-0 flex-1 truncate text-left hover:underline">{title}{count > 1 ? `（${count} 项）` : ''}</button>
      {card ? (
        <button type="button" onClick={onShow} className={`${quiet} font-medium`}>去处理</button>
      ) : (
        <>
          <button type="button" onClick={() => respond(sessionId, request.requestId, false)} className={quiet}>{t('permission.deny')}</button>
          <button type="button" onClick={() => respond(sessionId, request.requestId, true, { rule: 'always' })} className={quiet}>{t('permission.allowForSession')}</button>
          <button type="button" onClick={() => respond(sessionId, request.requestId, true)} className="h-6 shrink-0 whitespace-nowrap rounded-[var(--radius-sm)] bg-[var(--color-btn-primary-bg)] px-2.5 text-[12px] font-medium text-[var(--color-btn-primary-fg)]">{t('permission.allow')}</button>
        </>
      )}
    </div>
  )
}

export function FeedbackDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [text, setText] = useState('')
  const [images, setImages] = useState<string[]>([])
  const [busy, setBusy] = useState(false)
  const add = async (files: FileList | File[]) => {
    for (const file of Array.from(files).slice(0, 4)) {
      try {
        const url = await starApi.uploadReference(file, 'image', file.name)
        setImages(current => [...current, url].slice(0, 6))
      } catch (error) {
        toast('error', starErrorText(error))
      }
    }
  }
  const submit = async () => {
    setBusy(true)
    try {
      await starApi.feedback({ category: 'other', message: `[Design] ${text.trim()}${images.length ? `\n\n截图：\n${images.join('\n')}` : ''}` })
      toast('success', '感谢反馈，我们会尽快处理')
      setText('')
      setImages([])
      onClose()
    } catch (error) {
      toast('error', starErrorText(error))
    }
    setBusy(false)
  }
  return (
    <Modal open={open} onClose={onClose} title="用户反馈" width={520}
      footer={<div className="flex w-full justify-end gap-2"><button type="button" onClick={onClose} className="h-8 rounded-[var(--radius-md)] border border-[var(--color-border)] px-3 text-[13px]">取消</button><button type="button" disabled={!text.trim() || busy} onClick={() => void submit()} className="h-8 rounded-[var(--radius-md)] bg-[var(--color-btn-primary-bg)] px-3 text-[13px] font-medium text-[var(--color-btn-primary-fg)] disabled:opacity-50">提交反馈</button></div>}>
      <div className="space-y-3 text-[13px] text-[var(--color-text-secondary)]">
        <div>使用过程中遇到了什么问题？</div>
        <textarea value={text} onChange={event => setText(event.target.value)} onPaste={event => { const files = Array.from(event.clipboardData.files); if (files.length) void add(files) }} rows={5} placeholder="欢迎说说你的想法" className="w-full rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface-container-lowest)] px-3 py-2 outline-none" />
        <div>你还可以上传或粘贴图片进行反馈。</div>
        <div className="flex flex-wrap gap-2">
          {images.map(url => (
            <span key={url} className="relative h-16 w-16 overflow-hidden rounded-[var(--radius-md)] border border-[var(--color-border)]">
              <img src={url} alt="" className="h-full w-full object-cover" />
              <button type="button" aria-label="移除" onClick={() => setImages(current => current.filter(item => item !== url))} className="absolute right-0.5 top-0.5 rounded-full bg-black/60 p-0.5 text-white"><X size={10} aria-hidden="true" /></button>
            </span>
          ))}
          <label className="flex h-16 w-16 cursor-pointer items-center justify-center rounded-[var(--radius-md)] bg-[var(--color-surface-container)] text-[var(--color-text-tertiary)] hover:text-[var(--color-text-primary)]"><Plus size={18} aria-hidden="true" /><input type="file" multiple accept="image/*" className="hidden" onChange={event => { if (event.target.files?.length) void add(event.target.files); event.target.value = '' }} /></label>
        </div>
      </div>
    </Modal>
  )
}
