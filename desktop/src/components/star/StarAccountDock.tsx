import { useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import {
  Check,
  ChevronRight,
  Coins,
  FlaskConical,
  Fuel,
  Gift,
  LogIn,
  LogOut,
  MessageSquareText,
  Palette,
  RefreshCw,
  Settings,
  TrendingUp,
  X,
} from 'lucide-react'
import { getDesktopHost } from '../../lib/desktopHost'
import { useSettingsStore } from '../../stores/settingsStore'
import { useTabStore, SETTINGS_TAB_ID } from '../../stores/tabStore'
import { useUIStore } from '../../stores/uiStore'
import { useTranslation } from '../../i18n'
import { displayStarVersion, STAR_UPDATE_CURRENT_TEXT, STAR_UPDATE_UNAVAILABLE_TEXT } from '../../lib/starUpdate'
import { useStarUpdateStore } from '../../stores/starUpdateStore'
import { formatStarCredits, starUserName, useStarStore } from '../../stores/starStore'
import { useStarBrand } from '../../stores/starBrandStore'
import { starApi, starErrorText } from '../../api/star'
import type { ThemeMode } from '../../types/settings'

/** STAR's two palettes, plus following the OS. */
const THEME_LABELS: { value: ThemeMode | 'system'; label: string }[] = [
  { value: 'white', label: '浅色' },
  { value: 'dark', label: '深色' },
  { value: 'system', label: '跟随系统' },
]

export function StarAvatar({ size = 26, name, src }: { size?: number; name: string; src?: string | null }) {
  return (
    <span
      aria-hidden="true"
      className="inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full bg-[var(--color-brand)] font-semibold text-[var(--color-on-primary)]"
      style={{ width: size, height: size, fontSize: Math.round(size * 0.46) }}
    >
      {src ? <img src={src} alt="" className="h-full w-full object-cover" /> : (name.trim().slice(0, 1).toUpperCase() || 'S')}
    </span>
  )
}

function toast(type: 'success' | 'error' | 'info' | 'warning', message: string) {
  useUIStore.getState().addToast({ type, message })
}

function openSettings() {
  useTabStore.getState().openTab(SETTINGS_TAB_ID, '设置', 'settings')
}

/** Settings → 关于, where the new version can be downloaded. */
function openAboutSettings() {
  useUIStore.getState().setPendingSettingsTab('about')
  openSettings()
}

/** The newer STAR release the last check found (no `v` prefix), or null. */
function useAvailableStarUpdate(): string | null {
  return useStarUpdateStore(s => (s.latest?.hasUpdate && s.latest.latest.version ? displayStarVersion(s.latest.latest.version) : null))
}

/** The dot on the settings / account entry while a newer version is available. */
function UpdateDot() {
  return <span data-testid="star-update-dot" aria-hidden="true" className="pointer-events-none absolute right-[4px] top-[4px] h-[7px] w-[7px] rounded-full bg-[var(--color-brand)]" />
}

/**
 * The sidebar foot: the STAR account (avatar, name, plan) with its menu, and
 * the settings button. Signed out it offers sign-in instead.
 */
export function StarAccountDock({ collapsed, version }: { collapsed: boolean; version?: string | null }) {
  const brand = useStarBrand()
  const status = useStarStore(s => s.status)
  const quota = useStarStore(s => s.quota)
  const openLogin = useStarStore(s => s.openLogin)
  const [menuOpen, setMenuOpen] = useState(false)
  const anchorRef = useRef<HTMLButtonElement>(null)
  const name = starUserName(status)
  const availableUpdate = useAvailableStarUpdate()
  // Collapsed, the settings button is hidden: the account entry carries the dot.
  const collapsedUpdateDot = collapsed && availableUpdate ? <UpdateDot /> : null

  if (!status?.signedIn) {
    return (
      <div className={`flex min-w-0 flex-1 items-center ${collapsed ? 'justify-center' : 'gap-1'}`}>
        <button
          type="button"
          onClick={openLogin}
          title={collapsed ? `登录 ${brand.name}` : undefined}
          className={`relative flex items-center gap-2 rounded-[var(--radius-sm)] text-[13px] text-[var(--color-text-secondary)] transition-colors hover:bg-[var(--color-sidebar-item-hover)] hover:text-[var(--color-text-primary)] ${collapsed ? 'h-9 w-9 justify-center' : 'h-[30px] min-w-0 flex-1 px-2'}`}
        >
          <LogIn size={16} strokeWidth={1.75} className="shrink-0 text-[var(--color-brand)]" aria-hidden="true" />
          {!collapsed && <span className="truncate">登录 {brand.name} 账号</span>}
          {collapsedUpdateDot}
        </button>
        {!collapsed && <SettingsButton version={version} />}
      </div>
    )
  }

  return (
    <div className={`flex min-w-0 flex-1 items-center ${collapsed ? 'justify-center' : 'gap-1'}`}>
      <button
        ref={anchorRef}
        type="button"
        data-testid="star-account-chip"
        onClick={() => setMenuOpen(open => !open)}
        aria-haspopup="menu"
        aria-expanded={menuOpen}
        title={collapsed ? name : undefined}
        className={`relative flex min-w-0 items-center gap-2 rounded-[var(--radius-sm)] text-left transition-colors hover:bg-[var(--color-sidebar-item-hover)] ${collapsed ? 'h-9 w-9 justify-center' : 'h-[34px] flex-1 px-1.5'}`}
      >
        <StarAvatar name={name} src={status.user?.avatar} />
        {collapsedUpdateDot}
        {!collapsed && (
          <>
            <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-[var(--color-text-primary)]">{name}</span>
            <span className="shrink-0 rounded-[var(--radius-xs)] bg-[var(--color-surface-container-high)] px-1.5 py-[1px] text-[11px] text-[var(--color-text-secondary)]">
              {quota?.planName ?? '…'}
            </span>
          </>
        )}
      </button>
      {!collapsed && quota?.checkin && !quota.checkin.checked ? <CheckinButton /> : null}
      {!collapsed && <RechargeButton />}
      {!collapsed && <SettingsButton version={version} />}
      {menuOpen && <StarUserMenu anchor={anchorRef.current} onClose={() => setMenuOpen(false)} />}
    </div>
  )
}

/** 充值 at the sidebar foot: the 会员与积分 dialog, on its 积分包 tab. */
function RechargeButton() {
  return (
    <button
      type="button"
      data-testid="star-recharge"
      onClick={() => useStarStore.getState().openUpgrade('credits')}
      title="充值积分或开通会员"
      className="inline-flex h-[26px] shrink-0 items-center gap-1 rounded-[var(--radius-full)] border border-[var(--color-border)] px-2 text-[12px] text-[var(--color-text-primary)] transition-colors hover:border-[var(--color-border-strong)] hover:bg-[var(--color-sidebar-item-hover)]"
    >
      <Coins size={13} strokeWidth={1.75} aria-hidden="true" className="text-[var(--color-warning)]" />
      充值
    </button>
  )
}

const CHECKIN_BANNER_DISMISSED_KEY = 'star.checkinBanner.dismissedOn'

/** Today in local time, as the banner's dismissal remembers it. */
function localDay(): string {
  const now = new Date()
  return `${now.getFullYear()}-${now.getMonth() + 1}-${now.getDate()}`
}

function readDismissedDay(): string | null {
  try {
    return localStorage.getItem(CHECKIN_BANNER_DISMISSED_KEY)
  } catch {
    return null
  }
}

// One value for the banner and the sidebar that makes room for it.
let checkinBannerDismissedOn = readDismissedDay()
const checkinBannerListeners = new Set<() => void>()

function dismissCheckinBannerForToday() {
  checkinBannerDismissedOn = localDay()
  try {
    localStorage.setItem(CHECKIN_BANNER_DISMISSED_KEY, checkinBannerDismissedOn)
  } catch {
    // Unwritable storage: the banner still hides until the app restarts.
  }
  checkinBannerListeners.forEach(listener => listener())
}

function subscribeCheckinBanner(listener: () => void) {
  checkinBannerListeners.add(listener)
  return () => { checkinBannerListeners.delete(listener) }
}

/**
 * Whether the sidebar shows the check-in banner: signed in, today's check-in
 * not done, and the banner not closed today.
 */
export function useStarCheckinBannerVisible(): boolean {
  const signedIn = useStarStore(s => s.status?.signedIn === true)
  const pending = useStarStore(s => s.quota?.checkin?.checked === false)
  const dismissedOn = useSyncExternalStore(subscribeCheckinBanner, () => checkinBannerDismissedOn)
  return signedIn && pending && dismissedOn !== localDay()
}

/**
 * The sidebar's check-in banner, above the account: the same check-in as the
 * gift button and the account menu, where it is hard to miss. Closing it hides
 * it for the rest of the day.
 */
export function StarCheckinBanner() {
  const times = useStarStore(s => s.quota?.checkin?.times ?? 0)
  const [busy, setBusy] = useState(false)
  const checkin = async () => {
    setBusy(true)
    try {
      await starApi.checkin()
      toast('success', '签到成功，积分已到账')
    } catch (error) {
      toast('info', starErrorText(error))
    } finally {
      setBusy(false)
      void useStarStore.getState().refreshQuota()
    }
  }
  return (
    <div
      role="region"
      aria-label="每日签到"
      data-testid="star-checkin-banner"
      className="mb-2 flex items-center gap-2.5 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-brand-soft)] py-2 pl-2.5 pr-1.5"
    >
      <Gift size={16} strokeWidth={1.75} aria-hidden="true" className="shrink-0 text-[var(--color-brand)]" />
      <div className="min-w-0 flex-1">
        <div className="truncate text-[13px] font-medium text-[var(--color-text-primary)]">每日签到领积分</div>
        <div className="truncate text-[11px] text-[var(--color-text-tertiary)]">
          {times > 0 ? `已连签 ${times} 天，连签奖励更高` : '连签奖励更高'}
        </div>
      </div>
      <button
        type="button"
        disabled={busy}
        onClick={() => void checkin()}
        className="h-[26px] shrink-0 rounded-[var(--radius-full)] bg-[var(--color-btn-primary-bg)] px-2.5 text-[12px] font-medium text-[var(--color-btn-primary-fg)] transition-colors hover:bg-[var(--color-btn-primary-hover)] disabled:opacity-50"
      >
        签到
      </button>
      <button
        type="button"
        onClick={dismissCheckinBannerForToday}
        aria-label="今天不再提示"
        title="今天不再提示"
        className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-[var(--radius-sm)] text-[var(--color-text-tertiary)] transition-colors hover:bg-[var(--color-sidebar-item-hover)] hover:text-[var(--color-text-primary)]"
      >
        <X size={13} strokeWidth={1.75} aria-hidden="true" />
      </button>
    </div>
  )
}

/** Shown until today's check-in is done: one click collects the day's credits. */
function CheckinButton() {
  const [busy, setBusy] = useState(false)
  const checkin = async () => {
    setBusy(true)
    try {
      await starApi.checkin()
      toast('success', '签到成功，积分已到账')
    } catch (error) {
      toast('info', starErrorText(error))
    } finally {
      setBusy(false)
      void useStarStore.getState().refreshQuota()
    }
  }
  return (
    <button
      type="button"
      data-testid="star-checkin"
      disabled={busy}
      onClick={() => void checkin()}
      aria-label="签到领积分"
      title="签到领积分"
      className="inline-flex h-[30px] w-[30px] shrink-0 items-center justify-center rounded-[var(--radius-sm)] text-[var(--color-text-tertiary)] transition-colors hover:bg-[var(--color-sidebar-item-hover)] hover:text-[var(--color-text-primary)] disabled:opacity-50"
    >
      <Gift size={16} strokeWidth={1.75} aria-hidden="true" />
    </button>
  )
}

function SettingsButton({ version }: { version?: string | null }) {
  const t = useTranslation()
  const label = t('sidebar.settings')
  const update = useAvailableStarUpdate()
  const found = update ? t('update.starFound', { version: update }) : null
  return (
    <button
      type="button"
      data-testid="star-settings-button"
      onClick={update ? openAboutSettings : openSettings}
      aria-label={found ? `${label}（${found}）` : label}
      title={found ? `${label}（${found}）` : version ? `${label}（v${version}）` : label}
      className="relative inline-flex h-[30px] w-[30px] shrink-0 items-center justify-center rounded-[var(--radius-sm)] text-[var(--color-text-tertiary)] transition-colors hover:bg-[var(--color-sidebar-item-hover)] hover:text-[var(--color-text-primary)]"
    >
      <Settings size={16} strokeWidth={1.75} aria-hidden="true" />
      {update ? <UpdateDot /> : null}
    </button>
  )
}

function MenuRow({ icon, label, hint, chevron, onClick }: { icon: ReactNode; label: string; hint?: string; chevron?: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onClick}
      className="flex h-8 w-full items-center gap-2.5 rounded-[var(--radius-sm)] px-2.5 text-left text-[13px] text-[var(--color-text-primary)] transition-colors hover:bg-[var(--color-surface-hover)]"
    >
      <span className="flex h-4 w-4 shrink-0 items-center justify-center text-[var(--color-text-secondary)]">{icon}</span>
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {hint ? <span className="shrink-0 text-[12px] text-[var(--color-text-tertiary)]">{hint}</span> : null}
      {chevron ? <ChevronRight size={14} className="shrink-0 text-[var(--color-text-tertiary)]" aria-hidden="true" /> : null}
    </button>
  )
}

function StarUserMenu({ anchor, onClose }: { anchor: HTMLElement | null; onClose: () => void }) {
  const brand = useStarBrand()
  const status = useStarStore(s => s.status)
  const quota = useStarStore(s => s.quota)
  const appliedTheme = useUIStore(s => s.theme)
  const followSystem = useUIStore(s => s.followSystemTheme)
  const theme: ThemeMode | 'system' = followSystem ? 'system' : appliedTheme
  const [themeOpen, setThemeOpen] = useState(false)
  const panelRef = useRef<HTMLDivElement>(null)
  const name = starUserName(status)
  const availableUpdate = useAvailableStarUpdate()

  useEffect(() => {
    const onDown = (event: MouseEvent) => {
      const target = event.target as Node
      if (panelRef.current?.contains(target) || anchor?.contains(target)) return
      onClose()
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [anchor, onClose])

  const rect = anchor?.getBoundingClientRect()
  const left = Math.max(8, rect?.left ?? 8)
  const bottom = rect ? Math.max(8, window.innerHeight - rect.top + 6) : 56
  const run = (action: () => void | Promise<void>) => () => {
    onClose()
    void action()
  }

  const checkin = async () => {
    try {
      await starApi.checkin()
      toast('success', '签到成功，积分已到账')
    } catch (error) {
      toast('info', starErrorText(error))
    }
    void useStarStore.getState().refreshQuota()
  }
  const invite = async () => {
    const code = status?.user?.inviteCode
    if (!code) {
      toast('info', '邀请码暂不可用')
      return
    }
    try {
      await navigator.clipboard.writeText(`我在用 ${brand.name} 桌面端，注册时填写邀请码 ${code} 可获得积分奖励`)
      toast('success', `邀请码 ${code} 已复制，发给好友即可`)
    } catch {
      toast('info', `我的邀请码：${code}`)
    }
  }
  const checkUpdate = async () => {
    try {
      const result = await useStarUpdateStore.getState().refresh()
      if (!result.hasUpdate) {
        toast('success', STAR_UPDATE_CURRENT_TEXT)
        return
      }
      useUIStore.getState().setPendingSettingsTab('about')
      openSettings()
    } catch {
      // The console could not answer: a calm notice, not an error.
      toast('info', STAR_UPDATE_UNAVAILABLE_TEXT)
    }
  }

  return createPortal(
    <div
      ref={panelRef}
      role="menu"
      data-testid="star-user-menu"
      className="fixed z-[var(--z-dropdown)] w-[260px] rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-surface-container-lowest)] p-1.5 shadow-[var(--shadow-dropdown)]"
      style={{ left, bottom }}
    >
      <div className="flex items-center gap-2.5 px-2 pb-2 pt-1.5">
        <StarAvatar size={32} name={name} src={status?.user?.avatar} />
        <span className="min-w-0 truncate text-[14px] font-semibold text-[var(--color-text-primary)]">{name}</span>
      </div>
      <div className="mx-1 mb-1.5 grid grid-cols-2 gap-2">
        <div className="flex flex-col gap-1 rounded-[var(--radius-md)] border border-[var(--color-border)] p-2.5">
          <span className="text-[11px] text-[var(--color-text-tertiary)]">套餐</span>
          <span className="truncate text-[14px] font-semibold text-[var(--color-text-primary)]">{quota?.planName ?? '—'}</span>
          <button type="button" onClick={run(() => useStarStore.getState().openUpgrade('plan'))} className="mt-1 h-7 rounded-[var(--radius-sm)] bg-[var(--color-btn-primary-bg)] text-[12px] font-medium text-[var(--color-btn-primary-fg)] transition-colors hover:bg-[var(--color-btn-primary-hover)]">升级套餐</button>
        </div>
        <div className="flex flex-col gap-1 rounded-[var(--radius-md)] border border-[var(--color-border)] p-2.5">
          <span className="text-[11px] text-[var(--color-text-tertiary)]">积分余额</span>
          <span className="truncate text-[14px] font-semibold tabular-nums text-[var(--color-text-primary)]">{formatStarCredits(quota?.credits)}</span>
          <button type="button" onClick={run(() => useStarStore.getState().openUpgrade('credits'))} className="mt-1 h-7 rounded-[var(--radius-sm)] border border-[var(--color-border)] text-[12px] text-[var(--color-text-primary)] hover:bg-[var(--color-surface-hover)]">购买积分</button>
        </div>
      </div>
      {quota?.normal ? (
        <div className="mx-2 mb-1 text-[11px] text-[var(--color-text-tertiary)]">
          今日对话 {quota.normal.used}/{quota.normal.quota}{quota.premium ? ` · 高级 ${quota.premium.used}/${quota.premium.quota}` : ''}
        </div>
      ) : null}
      <div className="my-1 h-px bg-[var(--color-border)]" />
      <MenuRow icon={<Fuel size={15} />} label={`${brand.name} 加油站`} hint={quota?.checkin?.checked ? '今日已签到' : '签到领积分'} chevron onClick={run(checkin)} />
      <MenuRow icon={<Gift size={15} />} label="去邀约" hint="邀请好友得积分" chevron onClick={run(invite)} />
      <MenuRow icon={<TrendingUp size={15} />} label="成长计划" hint={quota?.checkin ? `已连签 ${quota.checkin.times} 天` : '连签奖励更高'} chevron onClick={run(checkin)} />
      <div className="my-1 h-px bg-[var(--color-border)]" />
      <MenuRow icon={<Settings size={15} />} label="设置" hint="Ctrl+," onClick={run(openSettings)} />
      <div className="relative" onMouseEnter={() => setThemeOpen(true)} onMouseLeave={() => setThemeOpen(false)}>
        <MenuRow icon={<Palette size={15} />} label="外观" hint={THEME_LABELS.find(item => item.value === theme)?.label} chevron onClick={() => setThemeOpen(open => !open)} />
        {themeOpen && (
          <div role="menu" className="absolute bottom-0 left-full ml-1 w-[150px] rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-surface-container-lowest)] p-1 shadow-[var(--shadow-dropdown)]">
            {THEME_LABELS.map(item => (
              <MenuRow
                key={item.value}
                icon={item.value === theme ? <Check size={14} /> : <span />}
                label={item.label}
                onClick={run(() => {
                  if (item.value === 'system') useUIStore.getState().setFollowSystemTheme(true)
                  else void useSettingsStore.getState().setTheme(item.value)
                })}
              />
            ))}
          </div>
        )}
      </div>
      <MenuRow icon={<FlaskConical size={15} />} label={`${brand.name} 插件与能力测试`} onClick={run(() => useStarStore.getState().openStarPlugins())} />
      <MenuRow icon={<MessageSquareText size={15} />} label="意见反馈" onClick={run(() => useStarStore.getState().openFeedback())} />
      <MenuRow icon={<RefreshCw size={15} />} label="检查更新" hint={availableUpdate ? `发现新版本 ${availableUpdate}` : undefined} onClick={run(checkUpdate)} />
      <div className="my-1 h-px bg-[var(--color-border)]" />
      <MenuRow icon={<LogOut size={15} />} label="退出登录" onClick={run(async () => {
        await useStarStore.getState().logout()
        toast('info', `已退出 ${brand.name} 账号`)
      })} />
      {status?.baseUrl ? (
        <button
          type="button"
          onClick={run(() => getDesktopHost().shell.open('https://bo.spkx.cn').catch(() => undefined))}
          className="mt-1 w-full px-2.5 pb-1 text-left text-[11px] text-[var(--color-text-tertiary)] hover:text-[var(--color-text-secondary)]"
        >
          打开 {brand.name} 网页版
        </button>
      ) : null}
    </div>,
    document.body,
  )
}
