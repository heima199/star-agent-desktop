import { useEffect, useState, type ReactNode } from 'react'
import { Check, ChevronRight, Clapperboard, FileScan, FlaskConical, FolderPlus, FolderX, Palette, Telescope, type LucideIcon } from 'lucide-react'
import { pluginsApi } from '../../api/plugins'
import { starApi, starErrorText } from '../../api/star'
import type { StarCreateMode } from '../../lib/starCreateRequest'
import { useStarCreateStore } from '../../stores/starCreateStore'
import { useStarStore } from '../../stores/starStore'
import { useStarBrand } from '../../stores/starBrandStore'
import { useUIStore } from '../../stores/uiStore'

/**
 * The built-in STAR plugins, one click each: 绘图 / 视频 arm the composer's
 * 创作 mode, the others put their command at the start of the draft.
 * `{brand}` in a title is the console's product name, filled in when shown.
 */
export const STAR_PLUGIN_ICONS: ({ name: string; title: string; icon: LucideIcon } & ({ arm: StarCreateMode } | { command: string }))[] = [
  { name: 'star-image', title: '{brand} 绘图', icon: Palette, arm: 'text2image' },
  { name: 'star-video', title: '{brand} 视频', icon: Clapperboard, arm: 'text2video' },
  { name: 'star-research', title: '{brand} 联网研究', icon: Telescope, command: '/star-web-search' },
  { name: 'star-docs', title: '{brand} 文档与多模态', icon: FileScan, command: '/star-file-recognize' },
  { name: 'star-lab', title: '{brand} 能力测试', icon: FlaskConical, command: '/star-capability-test' },
]

const ACTION_ROW = 'flex min-h-8 w-full items-center gap-2.5 rounded-[var(--radius-sm)] px-2 py-1.5 text-left transition-colors hover:bg-[var(--color-surface-hover)] focus-visible:bg-[var(--color-surface-hover)] focus-visible:outline-none disabled:opacity-50'

/**
 * STAR's rows in the project menu, after "choose folder": a blank project
 * folder made on the spot, and a draft that works in no folder at all.
 */
export function StarProjectActions({ workDir, pick }: { workDir: string; pick: (path: string) => void }) {
  const [naming, setNaming] = useState(false)
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)

  const createBlank = async () => {
    if (busy) return
    setBusy(true)
    try {
      const folder = await starApi.createLocalProject(name.trim() || '新项目')
      setNaming(false)
      setName('')
      pick(folder.path)
    } catch (error) {
      useUIStore.getState().addToast({ type: 'error', message: starErrorText(error) })
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      {naming ? (
        <div className="flex items-center gap-1.5 px-1 py-1">
          <input
            autoFocus
            value={name}
            onChange={event => setName(event.target.value)}
            onKeyDown={event => {
              if (event.key === 'Enter') { event.preventDefault(); void createBlank() }
            }}
            placeholder="项目名称"
            aria-label="项目名称"
            className="h-7 min-w-0 flex-1 rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-transparent px-2 text-[13px] text-[var(--color-text-primary)] outline-none placeholder:text-[var(--color-text-tertiary)] focus:border-[var(--color-border-focus)]"
          />
          <button type="button" disabled={busy} onClick={() => void createBlank()} className="h-7 shrink-0 rounded-[var(--radius-sm)] bg-[var(--color-btn-primary-bg)] px-2.5 text-[12px] text-[var(--color-btn-primary-fg)] disabled:opacity-50">创建</button>
        </div>
      ) : (
        <button type="button" className={ACTION_ROW} onClick={() => setNaming(true)}>
          <FolderPlus size={16} strokeWidth={1.75} aria-hidden="true" className="shrink-0 text-[var(--color-text-tertiary)]" />
          <span className="text-[13px] text-[var(--color-text-primary)]">新建空白项目</span>
        </button>
      )}
      <button type="button" className={ACTION_ROW} onClick={() => pick('')}>
        <FolderX size={16} strokeWidth={1.75} aria-hidden="true" className="shrink-0 text-[var(--color-text-tertiary)]" />
        <span className="flex-1 text-[13px] text-[var(--color-text-primary)]">不使用文件夹</span>
        {!workDir ? <Check size={14} aria-hidden="true" className="shrink-0 text-[var(--color-brand)]" /> : null}
      </button>
    </>
  )
}

/**
 * The strip under the home composer (Kimi style): the draft's project picker,
 * then the STAR plugins it can call. Sending still goes through the composer's
 * own Run.
 */
export function StarComposerTray({ location, plugins: showPlugins = true, slot, onCommand, disabled = false }: {
  /** The draft's project picker, first in the strip. */
  location: ReactNode
  /** Off in the lean mode, which leaves the STAR plugins out. */
  plugins?: boolean
  /** Composer slot the image / video plugins arm their 创作 mode in. */
  slot: string
  /** Puts a plugin's slash command at the start of the draft. */
  onCommand: (command: string) => void
  disabled?: boolean
}) {
  const [enabled, setEnabled] = useState<Record<string, boolean>>({})
  const signedIn = useStarStore(s => Boolean(s.status?.signedIn))
  const brand = useStarBrand()
  const addToast = useUIStore(s => s.addToast)

  useEffect(() => {
    let alive = true
    pluginsApi.list().then(response => {
      if (!alive) return
      const next: Record<string, boolean> = {}
      for (const plugin of response.plugins ?? []) if (plugin.isBuiltin) next[plugin.name] = plugin.enabled
      setEnabled(next)
    }).catch(() => undefined)
    return () => { alive = false }
  }, [])

  const plugins = STAR_PLUGIN_ICONS.filter(item => enabled[item.name] ?? true)
  const runPlugin = (item: typeof STAR_PLUGIN_ICONS[number]) => {
    // The plugins run on the STAR account; signed out, the click is a sign-in.
    if (!signedIn) {
      useStarStore.getState().openLogin()
      return
    }
    if ('arm' in item) {
      useStarCreateStore.getState().arm(slot, item.arm)
      addToast({ type: 'info', message: `已切到「${brand.format(item.title)}」，描述想要的画面后发送` })
      return
    }
    onCommand(item.command)
  }

  return (
    <div data-testid="star-composer-tray" className="mx-3 -mt-4 flex items-center gap-2 rounded-b-[var(--radius-xl)] border border-t-0 border-[var(--color-border)] bg-[var(--color-surface-container-low)] px-3 pb-2 pt-[22px] text-[12px] text-[var(--color-text-secondary)]">
      {/* Always the first child, so the picker keeps its place (and its
          state) when the plugins come and go. */}
      <div data-testid="star-composer-tray-location" className="flex min-w-0 max-w-[320px] shrink items-center">{location}</div>
      {showPlugins ? (
        <>
          <span className="h-4 w-px shrink-0 bg-[var(--color-border)]" aria-hidden="true" />
          <span className="shrink-0 text-[var(--color-text-tertiary)]">插件</span>
          <div className="flex min-w-0 items-center gap-1">
            {plugins.map(item => {
              const title = brand.format(item.title)
              const label = signedIn ? title : `${title}（登录 ${brand.name} 后可用）`
              return (
                <button
                  key={item.name}
                  type="button"
                  disabled={disabled}
                  onClick={() => runPlugin(item)}
                  title={label}
                  aria-label={label}
                  data-testid={`tray-plugin-${item.name}`}
                  className={`flex h-6 w-6 items-center justify-center rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-surface-container-lowest)] transition-colors hover:border-[var(--color-border-strong)] hover:bg-[var(--color-surface-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-border-focus)] disabled:opacity-50 ${signedIn ? 'text-[var(--color-text-primary)]' : 'text-[var(--color-text-tertiary)]'}`}
                >
                  <item.icon size={13} strokeWidth={1.75} aria-hidden="true" />
                </button>
              )
            })}
          </div>
          <button type="button" onClick={() => useStarStore.getState().openStarPlugins()} className="ml-auto inline-flex h-7 shrink-0 items-center gap-0.5 rounded-[var(--radius-md)] px-2 text-[12px] text-[var(--color-text-tertiary)] hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-text-primary)]">
            管理插件<ChevronRight size={13} aria-hidden="true" />
          </button>
        </>
      ) : null}
    </div>
  )
}
