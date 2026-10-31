import { useMemo, useState } from 'react'
import { Copy, FolderOpen, MessageSquarePlus, MessagesSquare, RefreshCw, SearchX } from 'lucide-react'
import type { StarMediaTask } from '@/api/star'
import { ImageGalleryModal } from '@/components/chat/ImageGalleryModal'
import type { GalleryImage } from '@/components/chat/conversationImageGallery'
import { seedStarComposer } from '@/components/star/starComposerSeed'
import { Button } from '@/components/ui/Button'
import { FileTypeIcon } from '@/components/ui/FileTypeIcon'
import { IconButton } from '@/components/ui/IconButton'
import { SearchField } from '@/components/ui/SearchField'
import { copyTextToClipboard } from '@/lib/clipboard'
import { getDesktopHost } from '@/lib/desktopHost'
import { getServerBaseUrl } from '@/lib/desktopRuntime'
import { filesystemImageUrl, localFileUrl } from '@/lib/handlePreviewLink'
import { openLocalFileWithSystem, reportOpenFailure } from '@/lib/systemFileOpen'
import { useAuthedImageFallback } from '@/lib/useAuthedImageFallback'
import { workspaceOpen } from '@/lib/workspace/openTarget'
import { useSessionStore } from '@/stores/sessionStore'
import { useStarBrand } from '@/stores/starBrandStore'
import { useTabStore } from '@/stores/tabStore'
import { useUIStore } from '@/stores/uiStore'
import { starStudioTabTitle } from '@/components/star/starTabs'
import { useInfiniteScroll } from '../starFeed'
import { formatStarTime, StarOutputThumb, StarOutputViewer } from '../starMedia'
import { EmptyHint, ErrorRow, LoadingRow, PillTabs, StarPageShell, useLoad } from '../pages/StarPageShell'
import {
  RECENT_SESSION_LIMIT,
  countProducedFiles,
  loadProducedFiles,
  parentDirectory,
  searchProducedFiles,
  type ProducedFile,
  type ProducedFileFilter,
} from './producedFiles'

const FILTERS: readonly { id: ProducedFileFilter; label: string }[] = [
  { id: 'all', label: '全部' },
  { id: 'image', label: '图片' },
  { id: 'video', label: '视频' },
  { id: 'web', label: '网页' },
  { id: 'document', label: '文档' },
]

/** Cards shown before the next step; STAR thumbnails download their file, so the grid grows on scroll. */
const PAGE_SIZE = 48

const THUMB = 'relative flex aspect-[4/3] w-full items-center justify-center overflow-hidden rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface-container)]'
const ACTION = 'inline-flex h-7 shrink-0 items-center gap-1 rounded-[var(--radius-md)] px-2 text-[12px] text-[var(--color-text-secondary)] transition-colors hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-text-primary)]'

const toast = (type: 'success' | 'error', message: string) => useUIStore.getState().addToast({ type, message })

function sourceLabel(file: ProducedFile): string {
  if (file.session?.title) return `来自「${file.session.title}」`
  return file.sessionId ? '来自对话' : `来自 ${starStudioTabTitle()}`
}

function openConversation(file: ProducedFile): void {
  if (file.session) useSessionStore.getState().openHistoricalSession(file.session)
  else if (file.sessionId) useTabStore.getState().openTab(file.sessionId, '对话')
}

/** A local picture by path; a file the server will not serve shows its type instead. */
function LocalImage({ path }: { path: string }) {
  const [failed, setFailed] = useState(false)
  const image = useAuthedImageFallback(filesystemImageUrl(getServerBaseUrl(), path), () => setFailed(true))
  if (failed) return <FileTypeIcon path={path} size={40} />
  return <img src={image.src} onError={image.onError} alt="" loading="lazy" className="h-full w-full object-cover" />
}

function FileThumb({ file, onOpen }: { file: ProducedFile; onOpen: () => void }) {
  if (file.star) return <StarOutputThumb task={file.star.task} index={file.star.index} onOpen={onOpen} className="aspect-[4/3] w-full" />
  return (
    <button type="button" onClick={onOpen} title={file.name} className={THUMB}>
      {file.kind === 'image' ? <LocalImage path={file.path} /> : <FileTypeIcon path={file.path} size={40} />}
    </button>
  )
}

function FileCard({ file, canReveal, onOpen }: { file: ProducedFile; canReveal: boolean; onOpen: () => void }) {
  const time = file.time ? ` · ${formatStarTime(file.time)}` : ''
  const copyPath = () => {
    void copyTextToClipboard(file.path).then(copied => toast(copied ? 'success' : 'error', copied ? '路径已复制' : '复制失败'))
  }
  const reveal = () => {
    const folder = parentDirectory(file.path)
    void getDesktopHost().shell.openPath(folder).catch(() => reportOpenFailure(folder))
  }
  return (
    <article data-testid="my-file-card" className="flex min-w-0 flex-col gap-2 rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-surface-container-lowest)] p-2">
      <FileThumb file={file} onOpen={onOpen} />
      <div className="min-w-0 px-1">
        <button type="button" onClick={onOpen} title={file.path} className="block w-full truncate text-left text-[13px] font-medium text-[var(--color-text-primary)] hover:text-[var(--color-text-accent)]">
          {file.name}
        </button>
        <div className="mt-0.5 truncate text-[11px] text-[var(--color-text-tertiary)]" title={`${sourceLabel(file)}${time}`}>{sourceLabel(file)}{time}</div>
      </div>
      <div className="flex min-w-0 items-center gap-0.5">
        <button type="button" onClick={onOpen} className={ACTION}>打开</button>
        <button type="button" onClick={() => seedStarComposer('', { files: [{ path: file.path, name: file.name }] })} className={ACTION}>
          <MessageSquarePlus size={13} strokeWidth={1.75} aria-hidden="true" />添加到对话
        </button>
        <span className="ml-auto flex shrink-0 items-center">
          {file.sessionId ? <IconButton size="xs" tone="muted" label="打开原对话" icon={<MessagesSquare size={13} strokeWidth={1.75} aria-hidden="true" />} onClick={() => openConversation(file)} /> : null}
          <IconButton size="xs" tone="muted" label="复制路径" icon={<Copy size={13} strokeWidth={1.75} aria-hidden="true" />} onClick={copyPath} />
          {canReveal ? <IconButton size="xs" tone="muted" label="在文件夹中显示" icon={<FolderOpen size={13} strokeWidth={1.75} aria-hidden="true" />} onClick={reveal} /> : null}
        </span>
      </div>
    </article>
  )
}

/** 我的文件: the images, videos, web pages and documents conversations produced. */
export function MyFilesPage() {
  const brand = useStarBrand()
  const { data, error, loading, reload } = useLoad(() => loadProducedFiles({ askServer: true }), 'star:my-files')
  const [filter, setFilter] = useState<ProducedFileFilter>('all')
  const [query, setQuery] = useState('')
  const [shown, setShown] = useState({ key: '', count: PAGE_SIZE })
  const [galleryIndex, setGalleryIndex] = useState(-1)
  const [starViewing, setStarViewing] = useState<{ task: StarMediaTask; index: number } | null>(null)
  const canReveal = getDesktopHost().capabilities.shell

  const matching = useMemo(() => searchProducedFiles(data ?? [], query), [data, query])
  const counts = useMemo(() => countProducedFiles(matching), [matching])
  const visible = useMemo(() => (filter === 'all' ? matching : matching.filter(file => file.kind === filter)), [matching, filter])
  // A new filter or search starts again from the first step.
  const viewKey = `${filter}\n${query}`
  const limit = shown.key === viewKey ? shown.count : PAGE_SIZE
  const showMore = () => setShown({ key: viewKey, count: limit + PAGE_SIZE })
  const hasMore = visible.length > limit
  const sentinel = useInfiniteScroll(hasMore, showMore)

  // Local pictures open in the gallery together; STAR outputs in their own viewer.
  const galleryFiles = useMemo(() => visible.filter(file => file.kind === 'image' && !file.star), [visible])
  const gallery = useMemo<GalleryImage[]>(() => galleryFiles.map(file => ({
    src: filesystemImageUrl(getServerBaseUrl(), file.path),
    name: file.name,
    path: file.path,
  })), [galleryFiles])

  const open = (file: ProducedFile) => {
    if (file.star) {
      setStarViewing(file.star)
      return
    }
    if (file.kind === 'image') {
      setGalleryIndex(galleryFiles.findIndex(item => item.id === file.id))
      return
    }
    // A page opens in the in-app browser of the conversation that made it.
    if (file.kind === 'web' && file.sessionId) {
      openConversation(file)
      workspaceOpen.browser(file.sessionId, localFileUrl(getServerBaseUrl(), file.path))
      return
    }
    void openLocalFileWithSystem(file.path).catch(() => reportOpenFailure(file.path))
  }

  return (
    <StarPageShell
      icon={FolderOpen}
      title="我的文件"
      description="对话中生成的图片、视频、网页和文档，都在这里。"
      actions={(
        <Button variant="secondary" size="base" icon={<RefreshCw size={14} strokeWidth={1.75} aria-hidden="true" />} loading={loading && Boolean(data)} onClick={() => { reload() }}>
          刷新
        </Button>
      )}
      toolbar={(
        <div className="flex flex-wrap items-center gap-3">
          <PillTabs items={FILTERS.map(item => ({ ...item, count: counts[item.id] }))} value={filter} onChange={setFilter} />
          <SearchField
            value={query}
            onChange={setQuery}
            label="搜索文件名或对话标题"
            placeholder="搜索文件名或对话标题"
            clearLabel="清除搜索"
            containerClassName="ml-auto w-[260px] max-w-full"
          />
        </div>
      )}
    >
      {error && data ? <div className="mb-3"><ErrorRow message={error} onRetry={reload} /></div> : null}
      {!data ? (
        error ? <ErrorRow message={error} onRetry={reload} /> : <LoadingRow />
      ) : data.length === 0 ? (
        <EmptyHint icon={FolderOpen} title="还没有生成的文件" hint={`让 ${brand.name} 做一份 PPT、网页或图片后会出现在这里。`} />
      ) : visible.length === 0 ? (
        <EmptyHint icon={SearchX} title="没有符合条件的文件" hint="换个关键词，或看看其他分类。" />
      ) : (
        <>
          <div data-testid="my-files-grid" className="grid grid-cols-[repeat(auto-fill,minmax(232px,1fr))] gap-3">
            {visible.slice(0, limit).map(file => <FileCard key={file.id} file={file} canReveal={canReveal} onOpen={() => open(file)} />)}
          </div>
          <div ref={sentinel} className="flex h-12 items-center justify-center">
            {hasMore ? (
              <button type="button" onClick={showMore} className="h-8 rounded-full border border-[var(--color-border)] px-4 text-[12px] text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-hover)]">
                显示更多（还有 {visible.length - limit} 个）
              </button>
            ) : (
              <span className="text-[11px] text-[var(--color-text-tertiary)]">列出最近 {RECENT_SESSION_LIMIT} 个对话和 {starStudioTabTitle(brand.name)}中的文件</span>
            )}
          </div>
        </>
      )}
      <ImageGalleryModal open={galleryIndex >= 0} images={gallery} activeIndex={Math.max(galleryIndex, 0)} onClose={() => setGalleryIndex(-1)} onSelect={setGalleryIndex} />
      {starViewing ? <StarOutputViewer task={starViewing.task} index={starViewing.index} onClose={() => setStarViewing(null)} /> : null}
    </StarPageShell>
  )
}
