import { useMemo, useState } from 'react'
import { FolderOpen, Images, Loader2, Wand2 } from 'lucide-react'
import { Button } from '../../components/ui/Button'
import { getDesktopHost } from '../../lib/desktopHost'
import { useTabStore } from '../../stores/tabStore'
import { isStarTaskActive, useStarStore } from '../../stores/starStore'
import type { StarMediaTask } from '../../api/star'
import { STAR_STUDIO_TAB_ID, starStudioTabTitle } from '../../components/star/starTabs'
import { useStarBrand } from '../../stores/starBrandStore'
import { formatStarTime, STAR_MODE_LABELS, StarOutputThumb, StarOutputViewer } from './starMedia'

type Kind = 'all' | 'image' | 'video'
type Source = 'all' | 'desktop' | 'agent'

/** 资料库: everything STAR generated, from the studio and from conversations. */
export function StarLibraryPage() {
  const tasks = useStarStore(s => s.tasks)
  const brand = useStarBrand()
  const [kind, setKind] = useState<Kind>('all')
  const [source, setSource] = useState<Source>('all')
  const [viewing, setViewing] = useState<{ task: StarMediaTask; index: number } | null>(null)
  const running = tasks.filter(isStarTaskActive)
  const items = useMemo(() => tasks
    .filter(task => task.status === 'succeeded')
    .filter(task => (kind === 'all' || task.kind === kind) && (source === 'all' || task.source === source))
    .flatMap(task => task.outputs.map((_, index) => ({ task, index }))), [kind, source, tasks])
  const outputsDir = tasks.find(task => task.source === 'desktop' && task.saveDir)?.saveDir

  return (
    <section className="flex h-full min-h-0 flex-col bg-[var(--color-surface)]" data-testid="star-library-page">
      <header className="flex shrink-0 flex-wrap items-end gap-4 border-b border-[var(--color-border)] px-8 pb-4 pt-6">
        <div className="min-w-0 flex-1">
          <h1 className="flex items-center gap-2 text-[22px] font-semibold text-[var(--color-text-primary)]"><Images size={20} strokeWidth={1.75} className="text-[var(--color-brand)]" aria-hidden="true" />资料库</h1>
          <p className="mt-1 text-[13px] text-[var(--color-text-tertiary)]">{brand.name} 生成的图片和视频都在这里，包括对话中由助手生成的作品。</p>
        </div>
        <div className="flex flex-wrap items-center gap-1 text-[12px]">
          {([['all', '全部'], ['image', '图片'], ['video', '视频']] as const).map(([value, label]) => (
            <button key={value} type="button" onClick={() => setKind(value)} className={`h-7 rounded-full px-3 ${kind === value ? 'bg-[var(--color-surface-container-high)] font-medium text-[var(--color-text-primary)]' : 'text-[var(--color-text-tertiary)]'}`}>{label}</button>
          ))}
          <span className="mx-1 h-4 w-px bg-[var(--color-border)]" />
          {([['all', '全部来源'], ['desktop', '创作台'], ['agent', '对话']] as const).map(([value, label]) => (
            <button key={value} type="button" onClick={() => setSource(value)} className={`h-7 rounded-full px-3 ${source === value ? 'bg-[var(--color-surface-container-high)] font-medium text-[var(--color-text-primary)]' : 'text-[var(--color-text-tertiary)]'}`}>{label}</button>
          ))}
          {outputsDir ? (
            <button type="button" onClick={() => void getDesktopHost().shell.openPath(outputsDir)} className="ml-2 inline-flex h-7 items-center gap-1 rounded-full border border-[var(--color-border)] px-3 text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-hover)]"><FolderOpen size={13} />作品文件夹</button>
          ) : null}
        </div>
      </header>
      {running.length ? (
        <button type="button" onClick={() => useTabStore.getState().openTab(STAR_STUDIO_TAB_ID, starStudioTabTitle(brand.name), 'star-studio')} className="mx-8 mt-4 flex items-center gap-2 rounded-[var(--radius-md)] border border-[var(--color-primary-fixed-dim)] bg-[var(--color-brand-soft)] px-3 py-2 text-left text-[12px] text-[var(--color-text-secondary)] hover:bg-[var(--color-brand-soft-hover)]">
          <Loader2 size={14} className="animate-spin text-[var(--color-brand)]" aria-hidden="true" />
          {running.length} 个任务生成中：{running.slice(0, 2).map(task => `${STAR_MODE_LABELS[task.mode] ?? task.mode} ${task.progress}%`).join('，')}
          <span className="ml-auto text-[var(--color-on-brand-soft)]">查看进度 →</span>
        </button>
      ) : null}
      <div className="min-h-0 flex-1 overflow-y-auto px-8 py-5">
        {items.length ? (
          <div className="grid grid-cols-[repeat(auto-fill,minmax(180px,1fr))] gap-3">
            {items.map(({ task, index }) => (
              <figure key={`${task.id}-${index}`} className="flex flex-col gap-1.5">
                <StarOutputThumb task={task} index={index} className="aspect-square w-full" onOpen={() => setViewing({ task, index })} />
                <figcaption className="flex items-center gap-1.5 text-[11px] text-[var(--color-text-tertiary)]">
                  <span className="shrink-0 font-medium text-[var(--color-text-secondary)]">{STAR_MODE_LABELS[task.mode] ?? task.mode}</span>
                  <span className="min-w-0 flex-1 truncate" title={task.prompt}>{task.prompt}</span>
                  <span className="shrink-0 tabular-nums">{formatStarTime(task.createdAt)}</span>
                </figcaption>
              </figure>
            ))}
          </div>
        ) : (
          <div className="flex h-72 flex-col items-center justify-center gap-3 text-[13px] text-[var(--color-text-tertiary)]">
            <Images size={26} />
            还没有作品
            <Button size="base" icon={<Wand2 size={14} strokeWidth={1.75} aria-hidden="true" />} onClick={() => useTabStore.getState().openTab(STAR_STUDIO_TAB_ID, starStudioTabTitle(brand.name), 'star-studio')}>去创作</Button>
          </div>
        )}
      </div>
      {viewing ? <StarOutputViewer task={viewing.task} index={viewing.index} onClose={() => setViewing(null)} /> : null}
    </section>
  )
}
