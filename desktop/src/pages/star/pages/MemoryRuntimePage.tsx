import { useId, useRef, useState, type KeyboardEvent } from 'react'
import { Activity, Orbit, type LucideIcon } from 'lucide-react'
import { MemoryGraphBody } from './MemoryGraphPage'
import { RuntimeBody } from './RuntimePage'

export type MemoryRuntimeView = 'memory' | 'runtime'

const VIEWS: ReadonlyArray<{ id: MemoryRuntimeView; label: string; icon: LucideIcon }> = [
  { id: 'memory', label: '记忆图谱', icon: Orbit },
  { id: 'runtime', label: '运行时', icon: Activity },
]

/**
 * 记忆图谱 and 运行时 on one page: what STAR remembers, and what it is
 * running right now. One header: the pill switch on its left, and to its
 * right whatever the shown view puts there (its description and actions,
 * rendered into the slot from inside the view, which owns that state).
 *
 * Only the shown view is mounted, so the graph's animation and the runtime
 * poll stop while the other one is up. `initialView` picks the view it opens
 * on; a later, different `initialView` switches to it.
 */
export function MemoryRuntimePage({ initialView = 'memory' }: { initialView?: MemoryRuntimeView }) {
  const [view, setView] = useState<MemoryRuntimeView>(initialView)
  const [requested, setRequested] = useState(initialView)
  if (requested !== initialView) {
    setRequested(initialView)
    setView(initialView)
  }
  const [slot, setSlot] = useState<HTMLDivElement | null>(null)
  const tabsRef = useRef<HTMLDivElement>(null)
  const baseId = useId()
  const tabId = (id: MemoryRuntimeView) => `${baseId}-tab-${id}`
  const panelId = `${baseId}-panel`
  const active = VIEWS.find((item) => item.id === view) ?? VIEWS[0]!

  // Arrow keys move along the switch; the switch is one tab stop.
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'ArrowRight' && event.key !== 'ArrowLeft') return
    event.preventDefault()
    const index = VIEWS.findIndex((item) => item.id === view)
    const next = VIEWS[(index + (event.key === 'ArrowRight' ? 1 : -1) + VIEWS.length) % VIEWS.length]!
    setView(next.id)
    tabsRef.current?.querySelector<HTMLButtonElement>(`[data-view="${next.id}"]`)?.focus()
  }

  return (
    <section className="flex h-full min-h-0 flex-col bg-[var(--color-surface)]">
      <header className="flex shrink-0 items-center gap-4 border-b border-[var(--color-border)] px-6 py-3">
        <h1 className="sr-only">{active.label}</h1>
        <div
          ref={tabsRef}
          role="tablist"
          aria-label="记忆图谱与运行时"
          onKeyDown={onKeyDown}
          className="inline-flex h-8 shrink-0 items-center gap-0.5 rounded-[var(--radius-full)] bg-[var(--color-surface-container)] p-[3px]"
        >
          {VIEWS.map(({ id, label, icon: Icon }) => {
            const selected = id === view
            return (
              <button
                key={id}
                type="button"
                role="tab"
                id={tabId(id)}
                data-view={id}
                aria-selected={selected}
                aria-controls={panelId}
                tabIndex={selected ? 0 : -1}
                onClick={() => setView(id)}
                className={`inline-flex h-full items-center gap-1.5 rounded-[var(--radius-full)] px-3.5 text-[13px] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-border-focus)] ${selected ? 'bg-[var(--color-surface-container-lowest)] font-medium text-[var(--color-text-primary)] shadow-[var(--shadow-segment)]' : 'text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]'}`}
              >
                <Icon size={14} strokeWidth={1.75} aria-hidden="true" />
                {label}
              </button>
            )
          })}
        </div>
        <div ref={setSlot} data-testid="memory-runtime-actions" className="flex min-w-0 flex-1 items-center gap-3" />
      </header>
      <div id={panelId} role="tabpanel" aria-labelledby={tabId(view)} className="flex min-h-0 flex-1 flex-col">
        {view === 'memory' ? <MemoryGraphBody actionsSlot={slot} /> : <RuntimeBody actionsSlot={slot} />}
      </div>
    </section>
  )
}
