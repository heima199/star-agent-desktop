import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { pageCacheGeneration, readPageCache, writePageCache } from '../starPageCache'
import {
  BarChart3,
  Book,
  Box,
  Briefcase,
  Calculator,
  ChartLine,
  Clapperboard,
  Code2,
  FileCheck,
  FileText,
  FileType,
  FlaskConical,
  Globe,
  GraduationCap,
  HardDrive,
  Image,
  Inbox,
  Kanban,
  Landmark,
  LayoutTemplate,
  Loader2,
  Mail,
  MousePointer2,
  Network,
  Newspaper,
  Palette,
  Plug,
  Ruler,
  Scale,
  Search,
  Sheet,
  Sigma,
  Smartphone,
  Star,
  TrendingUp,
  type LucideIcon,
} from 'lucide-react'
import { publicAssetPath } from '@/lib/publicAsset'
import { starErrorText } from '@/api/star'

export function StarPageShell({ icon: Icon, title, description, actions, toolbar, children, bodyClassName = '' }: {
  icon?: LucideIcon
  title: string
  description?: string
  actions?: ReactNode
  toolbar?: ReactNode
  children: ReactNode
  bodyClassName?: string
}) {
  return (
    <section className="flex h-full min-h-0 flex-col bg-[var(--color-surface)]">
      <header className="shrink-0 px-8 pb-3 pt-6">
        <div className="mx-auto flex w-full max-w-[1120px] flex-wrap items-end gap-4">
          <div className="min-w-0 flex-1">
            <h1 className="flex items-center gap-2 text-[22px] font-semibold text-[var(--color-text-primary)]">
              {Icon ? <Icon size={20} strokeWidth={1.75} className="text-[var(--color-brand)]" aria-hidden="true" /> : null}
              {title}
            </h1>
            {description ? <p className="mt-1 text-[13px] text-[var(--color-text-tertiary)]">{description}</p> : null}
          </div>
          {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
        </div>
        {toolbar ? <div className="mx-auto mt-4 w-full max-w-[1120px]">{toolbar}</div> : null}
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto [scrollbar-gutter:stable]">
        <div className={`mx-auto w-full max-w-[1120px] px-8 pb-16 pt-2 ${bodyClassName}`}>{children}</div>
      </div>
    </section>
  )
}

/**
 * Loads once per `key`; `reload` refetches without clearing the shown data.
 * A key loaded before (this session, same account) starts from its last data
 * and refreshes behind it, so a page opened again does not flash a spinner.
 */
export function useLoad<T>(loader: () => Promise<T>, key: string) {
  const [state, setState] = useState<{ data: T | null; error: string | null; loading: boolean }>(() => ({
    data: readPageCache<T>(key) ?? null,
    error: null,
    loading: true,
  }))
  const loaderRef = useRef(loader)
  loaderRef.current = loader
  const keyRef = useRef(key)
  keyRef.current = key
  const shownKey = useRef(key)
  const run = useCallback(() => {
    let cancelled = false
    const runKey = keyRef.current
    const startedIn = pageCacheGeneration()
    setState(current => ({ ...current, loading: true, error: null }))
    loaderRef.current()
      .then(data => {
        writePageCache(runKey, data, startedIn)
        if (!cancelled) setState({ data, error: null, loading: false })
      })
      .catch(error => { if (!cancelled) setState(current => ({ ...current, error: starErrorText(error), loading: false })) })
    return () => { cancelled = true }
  }, [])
  useEffect(() => {
    // A new key shows what it last loaded, if anything, while it refreshes.
    if (shownKey.current !== key) {
      shownKey.current = key
      const cached = readPageCache<T>(key)
      if (cached !== undefined) setState(current => ({ ...current, data: cached }))
    }
    return run()
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reload when the key changes
  }, [key])
  return {
    ...state,
    reload: run,
    setData: (data: T) => {
      writePageCache(keyRef.current, data)
      setState(current => ({ ...current, data }))
    },
  }
}

export function PillTabs<T extends string>({ items, value, onChange, size = 'md' }: {
  items: readonly { id: T; label: string; count?: number }[]
  value: T
  onChange: (value: T) => void
  size?: 'sm' | 'md'
}) {
  return (
    <div role="tablist" className="flex flex-wrap items-center gap-1.5">
      {items.map(item => {
        const active = item.id === value
        return (
          <button
            key={item.id}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange(item.id)}
            className={`${size === 'sm' ? 'h-7 px-2.5 text-[12px]' : 'h-8 px-3 text-[13px]'} rounded-[var(--radius-md)] transition-colors ${active ? 'bg-[var(--color-surface-container-high)] font-medium text-[var(--color-text-primary)]' : 'text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-text-primary)]'}`}
          >
            {item.label}
            {item.count !== undefined ? <span className="ml-1 text-[var(--color-text-tertiary)]">{item.count}</span> : null}
          </button>
        )
      })}
    </div>
  )
}

export function UnderlineTabs<T extends string>({ items, value, onChange }: { items: readonly { id: T; label: string }[]; value: T; onChange: (value: T) => void }) {
  return (
    <div role="tablist" className="flex items-center gap-6 border-b border-[var(--color-border)]">
      {items.map(item => {
        const active = item.id === value
        return (
          <button key={item.id} type="button" role="tab" aria-selected={active} onClick={() => onChange(item.id)}
            className={`-mb-px h-9 border-b-2 text-[14px] transition-colors ${active ? 'border-[var(--color-text-primary)] font-semibold text-[var(--color-text-primary)]' : 'border-transparent text-[var(--color-text-tertiary)] hover:text-[var(--color-text-secondary)]'}`}>
            {item.label}
          </button>
        )
      })}
    </div>
  )
}

export function EmptyHint({ icon: Icon = Inbox, title, hint, action }: { icon?: LucideIcon; title: string; hint?: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 rounded-[var(--radius-lg)] border border-dashed border-[var(--color-border)] px-6 py-14 text-center">
      <Icon size={22} strokeWidth={1.6} className="text-[var(--color-text-tertiary)]" aria-hidden="true" />
      <div className="text-[14px] font-medium text-[var(--color-text-primary)]">{title}</div>
      {hint ? <div className="max-w-[420px] text-[12px] leading-5 text-[var(--color-text-tertiary)]">{hint}</div> : null}
      {action ? <div className="mt-2">{action}</div> : null}
    </div>
  )
}

export function LoadingRow({ label = '加载中…' }: { label?: string }) {
  return (
    <div className="flex items-center justify-center gap-2 py-12 text-[13px] text-[var(--color-text-tertiary)]">
      <Loader2 size={15} className="animate-spin" aria-hidden="true" />{label}
    </div>
  )
}

export function ErrorRow({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface-container-low)] px-4 py-3 text-[13px] text-[var(--color-text-secondary)]">
      <span className="min-w-0 truncate">{message}</span>
      {onRetry ? <button type="button" onClick={onRetry} className="shrink-0 text-[var(--color-text-accent)] hover:underline">重试</button> : null}
    </div>
  )
}

const ICONS: Record<string, LucideIcon> = {
  'file-text': FileText, sheet: Sheet, 'file-type': FileType, box: Box, smartphone: Smartphone, globe: Globe, image: Image,
  clapperboard: Clapperboard, 'graduation-cap': GraduationCap, search: Search, 'line-chart': ChartLine, 'mouse-pointer': MousePointer2,
  mail: Mail, 'hard-drive': HardDrive, briefcase: Briefcase, 'trending-up': TrendingUp, calculator: Calculator, landmark: Landmark,
  'bar-chart': BarChart3, newspaper: Newspaper, sparkles: Star, palette: Palette, layout: LayoutTemplate, ruler: Ruler, code: Code2,
  network: Network, sigma: Sigma, flask: FlaskConical, book: Book, scale: Scale, 'file-check': FileCheck, kanban: Kanban,
}

/**
 * `connector:<id>` renders the shipped connector logo; other names map to a
 * line icon. Line icons are monochrome (white on the dark theme), never the
 * accent color: plugin icons stay black and white whatever the theme color.
 */
export function MarketIcon({ icon, size = 40 }: { icon: string; size?: number }) {
  const [failed, setFailed] = useState(false)
  if (icon.startsWith('connector:') && !failed) {
    return (
      <span className="flex shrink-0 items-center justify-center overflow-hidden rounded-[var(--radius-md)] border border-[var(--color-border)] bg-white" style={{ width: size, height: size }}>
        <img src={publicAssetPath(`connectors/${icon.slice('connector:'.length)}.svg`)} alt="" className="object-contain" style={{ width: size * 0.62, height: size * 0.62 }} onError={() => setFailed(true)} />
      </span>
    )
  }
  const Icon = ICONS[icon] ?? Plug
  return (
    <span data-testid="market-line-icon" className="flex shrink-0 items-center justify-center rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface-container-low)] text-[var(--color-text-primary)]" style={{ width: size, height: size }}>
      <Icon size={Math.round(size * 0.46)} strokeWidth={1.7} aria-hidden="true" />
    </span>
  )
}

export function formatDate(ms: number | string | null | undefined): string {
  if (!ms) return '--'
  const date = new Date(typeof ms === 'number' ? ms : Date.parse(ms))
  if (Number.isNaN(date.getTime())) return '--'
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}

/**
 * An iframe rendered at its design size (`width`×`height`) and scaled to the
 * box it sits in. Only mounted once the box scrolls into view.
 */
export function ScaledFrame({ src, width, height, title, sandbox = 'allow-scripts', className = '' }: {
  src: string
  width: number
  height: number
  title: string
  sandbox?: string
  className?: string
}) {
  const boxRef = useRef<HTMLDivElement>(null)
  const [scale, setScale] = useState(0)
  const [visible, setVisible] = useState(false)
  useEffect(() => {
    const box = boxRef.current
    if (!box) return
    const resize = new ResizeObserver(() => setScale(box.clientWidth / width))
    resize.observe(box)
    const seen = new IntersectionObserver(entries => {
      if (entries.some(entry => entry.isIntersecting)) {
        setVisible(true)
        seen.disconnect()
      }
    }, { rootMargin: '200px' })
    seen.observe(box)
    return () => { resize.disconnect(); seen.disconnect() }
  }, [width])
  return (
    <div ref={boxRef} className={`relative w-full overflow-hidden bg-[var(--color-surface-container)] ${className}`} style={{ aspectRatio: `${width} / ${height}` }}>
      {visible && scale > 0 ? (
        <iframe
          title={title}
          src={src}
          sandbox={sandbox}
          loading="lazy"
          tabIndex={-1}
          className="pointer-events-none absolute left-0 top-0 origin-top-left border-0 bg-white"
          style={{ width, height, transform: `scale(${scale})` }}
        />
      ) : null}
    </div>
  )
}
