import { Briefcase, Code2, Palette } from 'lucide-react'
import { useStarStore, type StarMode } from '../../stores/starStore'
import { STAR_CREATE_DRAFT_SLOT, useStarCreateStore } from '../../stores/starCreateStore'
import { useUIStore } from '../../stores/uiStore'
import { openStarPage } from './starPages'

export const STAR_MODES: { value: StarMode; label: string; icon: typeof Briefcase }[] = [
  { value: 'work', label: 'Work', icon: Briefcase },
  { value: 'code', label: 'Code', icon: Code2 },
  { value: 'design', label: 'Design', icon: Palette },
]

/** Switches the shell mode; Design opens its own page, the others the new-session page. */
export function chooseStarMode(value: StarMode): void {
  useStarStore.getState().setMode(value)
  useStarCreateStore.getState().disarm(STAR_CREATE_DRAFT_SLOT)
  if (value === 'design') {
    openStarPage('design')
    return
  }
  // Same path as 新建会话: the new-session page for the current project,
  // where the mode's suggestions show. Open tabs stay open.
  useUIStore.getState().requestNewSession()
}

/**
 * Work / Code / Design, top-left of the sidebar. The mode picks the
 * sidebar entries and the home page; sessions, tools and permissions work the
 * same in every mode. Design is a separate page with its own artboard.
 */
export function StarModeSwitch({ collapsed }: { collapsed: boolean }) {
  const mode = useStarStore(s => s.mode)
  if (collapsed) {
    const current = STAR_MODES.find(item => item.value === mode) ?? STAR_MODES[0]!
    const next = STAR_MODES[(STAR_MODES.indexOf(current) + 1) % STAR_MODES.length]!
    return (
      <button
        type="button"
        onClick={() => chooseStarMode(next.value)}
        title={`当前 ${current.label}，切换到 ${next.label}`}
        aria-label={`当前 ${current.label}，切换到 ${next.label}`}
        className="mx-auto mb-1.5 flex h-8 w-8 items-center justify-center rounded-[var(--radius-md)] bg-[var(--color-surface-container)] text-[var(--color-text-primary)]"
      >
        <current.icon size={15} strokeWidth={1.9} aria-hidden="true" />
      </button>
    )
  }
  return (
    <div role="radiogroup" aria-label="工作模式" data-testid="star-mode-switch" className="mx-2 mb-1.5 grid grid-cols-3 gap-0.5 rounded-[var(--radius-full)] bg-[var(--color-surface-container)] p-[3px]">
      {STAR_MODES.map(({ value, label, icon: Icon }) => {
        const active = mode === value
        return (
          <button
            key={value}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => chooseStarMode(value)}
            className={`flex h-[26px] min-w-0 items-center justify-center gap-1 rounded-[var(--radius-full)] text-[12px] transition-colors ${active ? 'bg-[var(--color-surface-container-lowest)] font-semibold text-[var(--color-text-primary)] shadow-sm' : 'text-[var(--color-text-tertiary)] hover:text-[var(--color-text-secondary)]'}`}
          >
            <Icon size={12} strokeWidth={1.9} aria-hidden="true" />
            <span className="truncate">{label}</span>
          </button>
        )
      })}
    </div>
  )
}
