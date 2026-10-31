import { useMemo, useState } from 'react'
import { RefreshCw, Wand2 } from 'lucide-react'
import { Button } from '../../components/ui/Button'
import { useStarBrand } from '../../stores/starBrandStore'
import { isStarTaskActive, useStarStore } from '../../stores/starStore'
import { StarStudioForm, type StarStudioReference } from './StarStudioForm'
import { StarTaskCard } from './starMedia'

type Filter = 'all' | 'active' | 'done' | 'agent'

/** STAR 创作: the image / video form and the live task center side by side. */
export function StarStudioPage() {
  const tasks = useStarStore(s => s.tasks)
  const status = useStarStore(s => s.status)
  const brand = useStarBrand()
  const [filter, setFilter] = useState<Filter>('all')
  const [incoming, setIncoming] = useState<StarStudioReference | null>(null)
  const active = tasks.filter(isStarTaskActive).length
  const visible = useMemo(() => tasks.filter(task => (
    filter === 'all' ? true
      : filter === 'active' ? isStarTaskActive(task)
        : filter === 'done' ? task.status === 'succeeded'
          : task.source === 'agent'
  )), [filter, tasks])

  return (
    <section className="flex h-full min-h-0 flex-col bg-[var(--color-surface)]" data-testid="star-studio-page">
      <header className="flex shrink-0 items-end gap-4 border-b border-[var(--color-border)] px-8 pb-4 pt-6">
        <div className="min-w-0 flex-1">
          <h1 className="flex items-center gap-2 text-[22px] font-semibold text-[var(--color-text-primary)]"><Wand2 size={20} strokeWidth={1.75} className="text-[var(--color-brand)]" aria-hidden="true" />{brand.name} 创作</h1>
          <p className="mt-1 text-[13px] text-[var(--color-text-tertiary)]">文生图、图生图、多图生图，文生视频、图生视频、首尾帧、多图生视频和视频参考生成。在对话框左下角点「创作」，也能直接在对话里生成。</p>
        </div>
        {!status?.signedIn ? (
          <Button size="base" onClick={() => useStarStore.getState().openLogin()}>登录 {brand.name}</Button>
        ) : null}
      </header>
      <div className="flex min-h-0 flex-1">
        <div className="w-[440px] shrink-0 overflow-y-auto border-r border-[var(--color-border)] px-6 py-5">
          <StarStudioForm incoming={incoming} onIncomingHandled={() => setIncoming(null)} />
        </div>
        <div className="flex min-w-0 flex-1 flex-col">
          <div className="flex shrink-0 items-center gap-2 px-6 pb-2 pt-5">
            <h2 className="text-[14px] font-semibold text-[var(--color-text-primary)]">任务中心</h2>
            {active ? <span className="rounded-full bg-[var(--color-brand-soft)] px-2 py-0.5 text-[11px] font-medium text-[var(--color-on-brand-soft)]">{active} 个进行中</span> : null}
            <div className="ml-auto flex gap-1 text-[12px]">
              {([['all', '全部'], ['active', '进行中'], ['done', '已完成'], ['agent', '来自对话']] as const).map(([value, label]) => (
                <button key={value} type="button" onClick={() => setFilter(value)} className={`h-7 rounded-full px-3 ${filter === value ? 'bg-[var(--color-surface-container-high)] font-medium text-[var(--color-text-primary)]' : 'text-[var(--color-text-tertiary)] hover:text-[var(--color-text-secondary)]'}`}>{label}</button>
              ))}
              <button type="button" aria-label="刷新" title="刷新" onClick={() => void useStarStore.getState().refreshTasks()} className="inline-flex h-7 w-7 items-center justify-center rounded-full text-[var(--color-text-tertiary)] hover:bg-[var(--color-surface-hover)]"><RefreshCw size={13} /></button>
            </div>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto px-6 pb-6">
            {visible.length ? (
              <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
                {visible.map(task => <StarTaskCard key={task.id} task={task} onUseAsReference={(url, kind) => setIncoming({ url, kind })} />)}
              </div>
            ) : (
              <div className="flex h-60 flex-col items-center justify-center gap-2 text-[13px] text-[var(--color-text-tertiary)]">
                <Wand2 size={22} />
                还没有任务。在左侧填写描述开始生成，或在对话框左下角点「创作」选择方式后直接发送。
              </div>
            )}
          </div>
        </div>
      </div>
    </section>
  )
}
