import { useEffect, useState } from 'react'
import { Check, Copy, Crown, Gift, LogIn, LogOut } from 'lucide-react'
import { starApi, starErrorText } from '@/api/star'
import { getDesktopHost } from '@/lib/desktopHost'
import type { DesktopSystemPrefs } from '@/lib/desktopHost/types'
import { SettingsGroup, SettingsPageHeader, SettingsRow, SettingsSection, SettingsSwitchRow } from '@/components/settings/SettingsSection'
import { ChatAppearanceSettings } from '@/pages/settings/ChatAppearanceSettings'
import { isValidHttpProxyUrl } from '@/pages/settings/shared'
import { useSettingsStore } from '@/stores/settingsStore'
import { useUIStore } from '@/stores/uiStore'
import { formatStarCredits, starUserName, useStarStore } from '@/stores/starStore'
import { useStarBrand } from '@/stores/starBrandStore'
import type { Locale } from '@/i18n'
import type { NetworkProxyMode, ThemeMode } from '@/types/settings'
import { ACCENT_PRESETS, MONO_ACCENT, accentPalette } from '@/theme/accent'
import { BrandMark } from '@/components/controls/StarModelPanel'

const toast = (type: 'success' | 'error' | 'info', message: string) => useUIStore.getState().addToast({ type, message })
const select = 'h-8 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface-container-lowest)] px-2.5 text-[13px] text-[var(--color-text-primary)] outline-none'

const FONT_SIZES: { label: string; zoom: number }[] = [
  { label: '小', zoom: 0.9 },
  { label: '标准', zoom: 1 },
  { label: '大', zoom: 1.1 },
  { label: '特大', zoom: 1.25 },
]

const LANGUAGES: { value: Locale; label: string }[] = [
  { value: 'zh', label: '简体中文' },
  { value: 'zh-TW', label: '繁體中文' },
  { value: 'en', label: 'English' },
  { value: 'jp', label: '日本語' },
  { value: 'kr', label: '한국어' },
]

function Segmented<T extends string | number>({ items, value, onChange }: { items: { value: T; label: string }[]; value: T; onChange: (value: T) => void }) {
  return (
    <div role="radiogroup" className="inline-flex rounded-[var(--radius-md)] bg-[var(--color-surface-container)] p-[3px]">
      {items.map(item => (
        <button key={String(item.value)} type="button" role="radio" aria-checked={item.value === value} onClick={() => onChange(item.value)}
          className={`h-7 min-w-[52px] rounded-[var(--radius-sm)] px-3 text-[12px] ${item.value === value ? 'bg-[var(--color-surface-container-lowest)] font-medium text-[var(--color-text-primary)] shadow-sm' : 'text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]'}`}>
          {item.label}
        </button>
      ))}
    </div>
  )
}

// ─── 通用 ──────────────────────────────────────────────────

export function StarGeneralSection({ onAdvanced }: { onAdvanced: () => void }) {
  const { locale, setLocale, uiZoom, setUiZoom, chatSendBehavior, setChatSendBehavior } = useSettingsStore()
  const replyTipsEnabled = useStarStore(s => s.replyTipsEnabled)
  const brand = useStarBrand()
  const mod = navigator.platform.toLowerCase().includes('mac') ? '⌘' : 'Ctrl'
  const [prefs, setPrefs] = useState<DesktopSystemPrefs | null>(null)
  const desktop = getDesktopHost().isDesktop
  useEffect(() => { if (desktop) void getDesktopHost().app.getSystemPrefs().then(setPrefs).catch(() => undefined) }, [desktop])
  const zoom = FONT_SIZES.reduce((best, item) => (Math.abs(item.zoom - uiZoom) < Math.abs(best.zoom - uiZoom) ? item : best), FONT_SIZES[1]!)
  const updatePrefs = (patch: Partial<Omit<DesktopSystemPrefs, 'openAtLoginSupported'>>) => {
    void getDesktopHost().app.setSystemPrefs(patch).then(setPrefs).catch(error => toast('error', starErrorText(error)))
  }
  return (
    <div>
      <SettingsPageHeader title="通用" description="语言、字号与启动。网络代理在「运行环境」里。" />
      <SettingsSection title="基础">
        <SettingsGroup>
          <SettingsRow title="语言" description="界面显示的语言">
            <select value={locale} onChange={event => setLocale(event.target.value as Locale)} className={select}>
              {LANGUAGES.map(item => <option key={item.value} value={item.value}>{item.label}</option>)}
            </select>
          </SettingsRow>
          <SettingsRow title="字体大小" description="整体缩放界面文字与控件">
            <Segmented items={FONT_SIZES.map(item => ({ value: item.zoom, label: item.label }))} value={zoom.zoom} onChange={value => setUiZoom(value)} />
          </SettingsRow>
        </SettingsGroup>
      </SettingsSection>
      <SettingsSection title="对话">
        <SettingsGroup>
          <SettingsRow title="发送消息" description={chatSendBehavior === 'modifierEnter' ? `${mod}+Enter 发送，Enter 换行` : 'Enter 发送，Shift+Enter 换行'}>
            <Segmented
              items={[{ value: 'enter', label: 'Enter' }, { value: 'modifierEnter', label: `${mod}+Enter` }]}
              value={chatSendBehavior}
              onChange={value => void setChatSendBehavior(value).catch(error => toast('error', starErrorText(error)))}
            />
          </SettingsRow>
          <SettingsSwitchRow
            title="回复时显示使用技巧"
            description={`${brand.name} 回复期间，在状态下方轮流显示一条小技巧`}
            checked={replyTipsEnabled}
            onChange={checked => useStarStore.getState().setReplyTipsEnabled(checked)}
          />
        </SettingsGroup>
      </SettingsSection>
      {desktop ? (
        <SettingsSection title="系统">
          <SettingsGroup>
            <SettingsSwitchRow title="开机自动启动" description={prefs && !prefs.openAtLoginSupported ? '安装版生效；开发运行时只保存选择' : `登录系统后自动打开 ${brand.name}`} checked={Boolean(prefs?.openAtLogin)} disabled={!prefs} onChange={checked => updatePrefs({ openAtLogin: checked })} />
            <SettingsSwitchRow title="关闭窗口时最小化到托盘" description="关闭后在托盘继续运行定时任务与远程控制；关闭此项则退出应用" checked={Boolean(prefs?.closeToTray)} disabled={!prefs} onChange={checked => updatePrefs({ closeToTray: checked })} />
            <SettingsSwitchRow title="防止电脑自动休眠" description={`${brand.name} 运行期间保持电脑唤醒，长任务不中断`} checked={Boolean(prefs?.preventSleep)} disabled={!prefs} onChange={checked => updatePrefs({ preventSleep: checked })} />
          </SettingsGroup>
        </SettingsSection>
      ) : null}
      <button type="button" onClick={onAdvanced} className="mt-2 text-[13px] text-[var(--color-text-accent)] hover:underline">更多设置（通知、联网搜索、会话保留、存储位置…）</button>
    </div>
  )
}

// ─── 运行环境 · 网络 ─────────────────────────────────────────

const PROXY_MODES: { value: NetworkProxyMode; label: string; hint: string }[] = [
  { value: 'system', label: '跟随系统', hint: '使用系统的代理设置' },
  { value: 'direct', label: '不使用代理', hint: '所有请求直接连接' },
  { value: 'manual', label: '手动设置', hint: '所有请求走下面填写的代理地址' },
]

/**
 * The proxy model requests and web tools go through. Manual mode is only
 * saved together with a valid address: the server treats manual without one
 * as "no proxy", which is never what the person picking it meant.
 */
export function StarNetworkSection() {
  const network = useSettingsStore(s => s.network)
  const setNetwork = useSettingsStore(s => s.setNetwork)
  const [mode, setMode] = useState<NetworkProxyMode>(network.proxy.mode)
  const [proxyUrl, setProxyUrl] = useState(network.proxy.url)
  const [urlError, setUrlError] = useState<string | null>(null)
  const save = (next: NetworkProxyMode, url: string) => {
    void setNetwork({ ...network, proxy: { mode: next, url } })
      .then(() => toast('success', '网络设置已保存，新请求生效'))
      .catch(error => toast('error', starErrorText(error)))
  }
  const chooseMode = (next: NetworkProxyMode) => {
    setMode(next)
    setUrlError(null)
    // Going back to what is already saved (after a manual address that never
    // validated) saves nothing, and says nothing.
    const url = next === 'manual' ? proxyUrl.trim() : ''
    if (next === 'manual' && !isValidHttpProxyUrl(url)) return
    if (next !== network.proxy.mode || url !== network.proxy.url) save(next, url)
  }
  const commitUrl = () => {
    const url = proxyUrl.trim()
    if (!url) return setUrlError('请填写代理地址')
    if (!isValidHttpProxyUrl(url)) return setUrlError('代理地址需以 http:// 或 https:// 开头')
    setUrlError(null)
    if (network.proxy.mode !== 'manual' || url !== network.proxy.url) save('manual', url)
  }
  return (
    <div>
      <SettingsPageHeader title="网络" description="模型请求、联网搜索与读取网页使用的代理。" />
      <SettingsSection title="代理">
        <SettingsGroup>
          <SettingsRow title="网络代理" description={PROXY_MODES.find(item => item.value === mode)?.hint}>
            <select aria-label="网络代理" value={mode} onChange={event => chooseMode(event.target.value as NetworkProxyMode)} className={select}>
              {PROXY_MODES.map(item => <option key={item.value} value={item.value}>{item.label}</option>)}
            </select>
          </SettingsRow>
          {mode === 'manual' ? (
            <SettingsRow title="代理地址" description={urlError ? <span role="alert" className="text-[var(--color-error)]">{urlError}</span> : '例如 http://127.0.0.1:7890，回车或移开光标后保存'}>
              <input
                aria-label="代理地址"
                aria-invalid={urlError ? true : undefined}
                value={proxyUrl}
                placeholder="http://127.0.0.1:7890"
                onChange={event => { setProxyUrl(event.target.value); setUrlError(null) }}
                onBlur={commitUrl}
                onKeyDown={event => { if (event.key === 'Enter') commitUrl() }}
                className={`${select} w-[240px]`}
              />
            </SettingsRow>
          ) : null}
        </SettingsGroup>
      </SettingsSection>
    </div>
  )
}

// ─── 个人主页 ──────────────────────────────────────────────

export function StarProfileSection() {
  const brand = useStarBrand()
  const status = useStarStore(s => s.status)
  const quota = useStarStore(s => s.quota)
  const user = status?.user
  if (!status?.signedIn || !user) {
    return (
      <div>
        <SettingsPageHeader title="个人主页" description={`登录 ${brand.name} 账号后，对话、生图和视频按账号额度计费。`} />
        <button type="button" onClick={() => useStarStore.getState().openLogin()} className="mt-4 inline-flex h-9 items-center gap-1.5 rounded-[var(--radius-md)] bg-[var(--color-btn-primary-bg)] px-4 text-[13px] font-medium text-[var(--color-btn-primary-fg)]"><LogIn size={14} aria-hidden="true" />登录 / 注册</button>
      </div>
    )
  }
  const name = starUserName(status)
  return (
    <div>
      <SettingsPageHeader title="个人主页" />
      <div className="mt-4 flex items-center gap-4 rounded-[var(--radius-lg)] border border-[var(--color-border)] p-5">
        {user.avatar ? <img src={user.avatar} alt="" className="h-14 w-14 rounded-full object-cover" /> : (
          <span className="flex h-14 w-14 items-center justify-center rounded-full bg-[var(--color-brand-soft)] text-[22px] font-semibold text-[var(--color-text-accent)]">{name.slice(0, 1)}</span>
        )}
        <div className="min-w-0 flex-1">
          <div className="text-[18px] font-semibold text-[var(--color-text-primary)]">{name}</div>
          <div className="mt-0.5 text-[12px] text-[var(--color-text-tertiary)]">{[user.phone, user.email].filter(Boolean).join(' · ')}</div>
          <div className="mt-1.5 inline-flex items-center gap-1 rounded-full bg-[var(--color-surface-container)] px-2 py-0.5 text-[12px] text-[var(--color-text-secondary)]"><Crown size={12} aria-hidden="true" />{quota?.planName ?? '--'}</div>
        </div>
        <button type="button" onClick={() => void useStarStore.getState().logout()} className="inline-flex h-8 items-center gap-1.5 rounded-[var(--radius-md)] border border-[var(--color-border)] px-3 text-[13px] text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-hover)]"><LogOut size={14} aria-hidden="true" />退出登录</button>
      </div>
      <SettingsSection title="账号">
        <SettingsGroup>
          {user.inviteCode ? (
            <SettingsRow title="我的邀请码" description="好友注册时填写，双方都能获得积分">
              <button type="button" onClick={() => void navigator.clipboard.writeText(user.inviteCode!).then(() => toast('success', '已复制'))} className="inline-flex items-center gap-1.5 font-mono text-[13px] text-[var(--color-text-primary)]">{user.inviteCode}<Copy size={13} aria-hidden="true" /></button>
            </SettingsRow>
          ) : null}
          <SettingsRow title={`对话默认使用 ${brand.name} 模型`} description={status.provider.active ? `当前默认：${status.provider.mainModel ?? brand.name}` : '目前使用的是其他模型服务商'}>
            {status.provider.active ? <span className="inline-flex items-center gap-1 text-[13px] text-[var(--color-text-secondary)]"><Check size={14} aria-hidden="true" />已启用</span> : (
              <button type="button" onClick={() => void starApi.activate().then(next => useStarStore.getState().signedIn(next)).catch(error => toast('error', starErrorText(error)))} className="h-8 rounded-[var(--radius-md)] border border-[var(--color-border)] px-3 text-[13px] hover:bg-[var(--color-surface-hover)]">设为默认</button>
            )}
          </SettingsRow>
        </SettingsGroup>
      </SettingsSection>
    </div>
  )
}

// ─── 模型 ──────────────────────────────────────────────────

function contextLabel(tokens?: number): string {
  if (!tokens) return ''
  return tokens >= 1_000_000 ? `${Math.round(tokens / 100_000) / 10}M 上下文` : `${Math.round(tokens / 1000)}K 上下文`
}

/**
 * 模型: the STAR platform's own catalog, read-only. Models come with the STAR
 * account; connecting another provider or API key is not offered.
 */
export function StarModelsSection() {
  const brand = useStarBrand()
  const status = useStarStore(s => s.status)
  const catalog = useStarStore(s => s.catalog)
  const [brandId, setBrandId] = useState<string | null>(null)
  const [refreshing, setRefreshing] = useState(false)
  useEffect(() => { if (!catalog) void useStarStore.getState().loadCatalog() }, [catalog])

  const header = <SettingsPageHeader title="模型" description={`使用 ${brand.name} 平台提供的模型，登录账号即可使用，按次扣除积分；不支持接入自定义 API。`} />
  if (!status?.signedIn) {
    return (
      <div>
        {header}
        <div data-testid="star-models-signed-out" className="mt-4 flex items-center justify-between gap-4 rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-surface-container-low)] px-5 py-4">
          <div className="text-[13px] text-[var(--color-text-secondary)]">登录 {brand.name} 账号后可使用全部模型</div>
          <button type="button" onClick={() => useStarStore.getState().openLogin()} className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-[var(--radius-md)] bg-[var(--color-btn-primary-bg)] px-3 text-[13px] text-[var(--color-btn-primary-fg)]"><LogIn size={14} aria-hidden="true" />登录</button>
        </div>
      </div>
    )
  }

  const brands = catalog?.brands ?? []
  const models = catalog?.chat ?? []
  const current = brands.find(brand => brand.id === brandId) ?? brands[0] ?? null
  const shown = current ? models.filter(model => model.brandId === current.id) : []
  const refresh = async () => {
    setRefreshing(true)
    await useStarStore.getState().loadCatalog(true)
    setRefreshing(false)
  }
  return (
    <div>
      {header}
      <SettingsSection title="默认">
        <SettingsGroup>
          <SettingsRow title="对话默认模型" description={`共 ${models.length} 个模型，${brands.length} 个品牌`}>
            <span className="text-[13px] text-[var(--color-text-secondary)]">{models.find(model => model.id === status.provider.mainModel)?.name ?? status.provider.mainModel ?? '--'}</span>
          </SettingsRow>
          <SettingsRow title="模型列表" description={`随 ${brand.name} 账号自动同步，新上架的模型刷新后可见`}>
            <button type="button" disabled={refreshing} onClick={() => void refresh()} className="h-8 rounded-[var(--radius-md)] border border-[var(--color-border)] px-3 text-[13px] text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-hover)] disabled:opacity-50">{refreshing ? '刷新中…' : '刷新'}</button>
          </SettingsRow>
        </SettingsGroup>
      </SettingsSection>
      <SettingsSection title="全部模型">
        <div role="tablist" aria-label="模型品牌" className="mb-3 flex flex-wrap gap-1.5">
          {brands.map(brand => {
            const active = brand.id === current?.id
            return (
              <button key={brand.id} type="button" role="tab" aria-selected={active} onClick={() => setBrandId(brand.id)}
                className={`inline-flex h-8 items-center gap-1.5 rounded-[var(--radius-full)] border px-3 text-[12px] ${active ? 'border-[var(--color-text-primary)] text-[var(--color-text-primary)]' : 'border-[var(--color-border)] text-[var(--color-text-secondary)] hover:border-[var(--color-border-strong)]'}`}>
                <BrandMark name={brand.name} brandId={brand.id} logo={brand.logo} color={brand.color} size={15} />
                {brand.name}
                <span className="tabular-nums text-[var(--color-text-tertiary)]">{models.filter(model => model.brandId === brand.id).length}</span>
              </button>
            )
          })}
        </div>
        <SettingsGroup>
          {shown.length ? shown.map(model => (
            <SettingsRow key={model.id} title={model.name} description={[model.credits ? `${model.credits} 积分/次` : '', contextLabel(model.contextWindow)].filter(Boolean).join(' · ') || model.id}>
              {status.provider.mainModel === model.id ? <span className="text-[12px] text-[var(--color-text-tertiary)]">默认</span> : null}
            </SettingsRow>
          )) : (
            <div className="px-4 py-6 text-center text-[13px] text-[var(--color-text-tertiary)]">{catalog ? '暂无模型' : '加载中…'}</div>
          )}
        </SettingsGroup>
      </SettingsSection>
    </div>
  )
}

// ─── 套餐与积分 ────────────────────────────────────────────

export function StarPlanSection() {
  const signedIn = useStarStore(s => Boolean(s.status?.signedIn))
  const quota = useStarStore(s => s.quota)
  const [code, setCode] = useState('')
  useEffect(() => { if (signedIn) void useStarStore.getState().refreshQuota() }, [signedIn])
  const usage = (label: string, item?: { quota: number; used: number; period?: string }) => item ? (
    <SettingsRow title={label} description={item.period ? `周期：${item.period}` : undefined}>
      <span className="text-[13px] tabular-nums text-[var(--color-text-secondary)]">{item.used.toLocaleString()} / {item.quota.toLocaleString()}</span>
    </SettingsRow>
  ) : null
  if (!signedIn) {
    return (
      <div>
        <SettingsPageHeader title="套餐与积分" />
        <button type="button" onClick={() => useStarStore.getState().openLogin()} className="mt-4 h-9 rounded-[var(--radius-md)] bg-[var(--color-btn-primary-bg)] px-4 text-[13px] text-[var(--color-btn-primary-fg)]">登录后查看</button>
      </div>
    )
  }
  return (
    <div>
      <SettingsPageHeader title="套餐与积分" description="个人版与团队版套餐、积分余额和兑换。" />
      <div className="mt-4 grid grid-cols-2 gap-3">
        <div className="rounded-[var(--radius-lg)] border border-[var(--color-border)] p-4">
          <div className="text-[12px] text-[var(--color-text-tertiary)]">当前套餐</div>
          <div className="mt-1 text-[18px] font-semibold text-[var(--color-text-primary)]">{quota?.planName ?? '--'}</div>
          <div className="mt-1 text-[12px] text-[var(--color-text-tertiary)]">{quota?.expiresAt ? `到期：${new Date(quota.expiresAt).toLocaleDateString('zh-CN')}` : quota?.planTier === 'free' ? '免费体验' : ''}</div>
          <button type="button" onClick={() => useStarStore.getState().openUpgrade('plan')} className="mt-3 h-8 rounded-[var(--radius-md)] bg-[var(--color-btn-primary-bg)] px-3 text-[13px] font-medium text-[var(--color-btn-primary-fg)]">升级会员</button>
        </div>
        <div className="rounded-[var(--radius-lg)] border border-[var(--color-border)] p-4">
          <div className="text-[12px] text-[var(--color-text-tertiary)]">积分余额</div>
          <div className="mt-1 text-[18px] font-semibold tabular-nums text-[var(--color-text-primary)]">{formatStarCredits(quota?.credits)}</div>
          <div className="mt-1 text-[12px] text-[var(--color-text-tertiary)]">{quota?.checkin ? (quota.checkin.checked ? '今日已签到' : '今日未签到') : ''}</div>
          <div className="mt-3 flex gap-2">
            <button type="button" onClick={() => useStarStore.getState().openUpgrade('credits')} className="h-8 rounded-[var(--radius-md)] border border-[var(--color-border)] px-3 text-[13px] hover:bg-[var(--color-surface-hover)]">购买积分</button>
            <button type="button" disabled={quota?.checkin?.checked} onClick={() => void starApi.checkin().then(() => { toast('success', '签到成功'); void useStarStore.getState().refreshQuota() }).catch(error => toast('error', starErrorText(error)))} className="inline-flex h-8 items-center gap-1 rounded-[var(--radius-md)] border border-[var(--color-border)] px-3 text-[13px] hover:bg-[var(--color-surface-hover)] disabled:opacity-50"><Gift size={13} aria-hidden="true" />签到</button>
          </div>
        </div>
      </div>
      <SettingsSection title="用量">
        <SettingsGroup>
          {usage('普通模型', quota?.normal)}
          {usage('高级模型', quota?.premium)}
          <SettingsRow title="兑换码" description="兑换会员时长或积分">
            <span className="flex gap-2">
              <input value={code} onChange={event => setCode(event.target.value)} placeholder="输入兑换码" className={`${select} w-[180px]`} />
              <button type="button" disabled={!code.trim()} onClick={() => void starApi.redeem(code.trim()).then(() => { toast('success', '兑换成功'); setCode(''); void useStarStore.getState().refreshQuota() }).catch(error => toast('error', starErrorText(error)))} className="h-8 rounded-[var(--radius-md)] border border-[var(--color-border)] px-3 text-[13px] disabled:opacity-50">兑换</button>
            </span>
          </SettingsRow>
        </SettingsGroup>
      </SettingsSection>
    </div>
  )
}

// ─── 外观 ──────────────────────────────────────────────────

/** The accent dot of a preview or a swatch: the derived color for that ground. */
function accentDot(accent: string, dark: boolean): string {
  return accentPalette(accent, dark)?.['--cc-ac'] ?? (dark ? '#ECECEA' : '#1F1E1C')
}

function ThemePreview({ dark, accent }: { dark: boolean; accent: string }) {
  // Content card on the darker ground, sidebar a step lighter: 深色 is #121212 / #181817.
  const page = dark ? '#121212' : '#ffffff'
  const side = dark ? '#181817' : '#f5f4f1'
  const line = dark ? '#2e2e2c' : '#e6e3dd'
  const text = dark ? '#5c5b57' : '#c9c5bd'
  return (
    <svg viewBox="0 0 160 96" className="h-full w-full" aria-hidden="true">
      <rect width="160" height="96" rx="8" fill={page} />
      <rect width="44" height="96" rx="8" fill={side} />
      <rect x="44" width="1" height="96" fill={line} />
      {[16, 28, 40].map(y => <rect key={y} x="9" y={y} width={y === 16 ? 26 : 20} height="5" rx="2.5" fill={text} />)}
      <rect x="60" y="20" width="70" height="6" rx="3" fill={text} />
      <rect x="60" y="32" width="52" height="5" rx="2.5" fill={line} />
      <rect x="56" y="64" width="92" height="20" rx="7" fill={dark ? '#222220' : '#f7f6f3'} stroke={line} />
      <circle cx="138" cy="74" r="5" fill={accentDot(accent, dark)} />
    </svg>
  )
}

/** 主题色: one click per preset, or any color through the picker. */
function AccentPicker() {
  const accent = useUIStore(s => s.accent)
  const setAccent = useUIStore(s => s.setAccent)
  const dark = useUIStore(s => s.theme === 'dark')
  const custom = accent !== MONO_ACCENT && !ACCENT_PRESETS.some(preset => preset.value === accent)
  return (
    <div className="flex flex-wrap items-center gap-2 px-4 py-3" role="radiogroup" aria-label="主题色" data-testid="accent-picker">
      {ACCENT_PRESETS.map(preset => {
        const active = accent === preset.value
        return (
          <button
            key={preset.value}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => setAccent(preset.value)}
            data-testid={`accent-${preset.value === MONO_ACCENT ? 'mono' : preset.value.slice(1).toLowerCase()}`}
            className={`flex h-8 items-center gap-1.5 rounded-[var(--radius-full)] border px-2.5 text-[12px] transition-colors ${active ? 'border-[var(--color-text-primary)] text-[var(--color-text-primary)]' : 'border-[var(--color-border)] text-[var(--color-text-secondary)] hover:border-[var(--color-border-strong)]'}`}
          >
            <span className="h-3.5 w-3.5 shrink-0 rounded-full border border-[var(--color-border)]" style={{ background: accentDot(preset.value, dark) }} aria-hidden="true" />
            {preset.label}
          </button>
        )
      })}
      <label
        className={`flex h-8 cursor-pointer items-center gap-1.5 rounded-[var(--radius-full)] border px-2.5 text-[12px] ${custom ? 'border-[var(--color-text-primary)] text-[var(--color-text-primary)]' : 'border-[var(--color-border)] text-[var(--color-text-secondary)] hover:border-[var(--color-border-strong)]'}`}
      >
        <input
          type="color"
          value={custom ? accent : '#D07B52'}
          onChange={event => setAccent(event.target.value)}
          className="h-3.5 w-3.5 cursor-pointer appearance-none rounded-full border-0 bg-transparent p-0"
          aria-label="自定义主题色"
        />
        自定义
      </label>
    </div>
  )
}

export function StarAppearanceSection() {
  const theme = useUIStore(s => s.theme)
  const follow = useUIStore(s => s.followSystemTheme)
  const setFollow = useUIStore(s => s.setFollowSystemTheme)
  const setTheme = useSettingsStore(s => s.setTheme)
  const mascotEnabled = useStarStore(s => s.mascotEnabled)
  const setMascotEnabled = useStarStore(s => s.setMascotEnabled)
  const brand = useStarBrand()
  const accent = useUIStore(s => s.accent)
  const isDark = theme === 'dark'
  const cards: { value: ThemeMode; label: string; dark: boolean }[] = [
    { value: 'white', label: '浅色', dark: false },
    { value: 'dark', label: '深色', dark: true },
  ]
  return (
    <div>
      <SettingsPageHeader title="外观" description="默认黑白配色；深浅色和主题色点选立即生效。" />
      <div className="mt-4 grid max-w-[440px] grid-cols-2 gap-4">
        {cards.map(card => {
          const active = !follow && (card.dark ? isDark : !isDark)
          return (
            <button key={card.value} type="button" onClick={() => void setTheme(card.value)} className="text-left">
              <span className={`block overflow-hidden rounded-[var(--radius-lg)] border-2 ${active ? 'border-[var(--color-brand)]' : 'border-[var(--color-border)] hover:border-[var(--color-border-strong)]'}`}><span className="block aspect-[5/3]"><ThemePreview dark={card.dark} accent={accent} /></span></span>
              <span className="mt-2 flex items-center gap-1.5 text-[13px] text-[var(--color-text-primary)]">{active ? <Check size={14} className="text-[var(--color-brand)]" aria-hidden="true" /> : null}{card.label}</span>
            </button>
          )
        })}
      </div>
      <SettingsSection title="跟随系统">
        <SettingsGroup>
          <SettingsSwitchRow title="跟随系统深浅色" description="开启后随系统自动切换；点选上面的浅色或深色会关闭跟随" checked={follow} onChange={setFollow} />
        </SettingsGroup>
      </SettingsSection>
      <SettingsSection title="主题色">
        <SettingsGroup>
          <AccentPicker />
        </SettingsGroup>
      </SettingsSection>
      <SettingsSection title="输入框">
        <SettingsGroup>
          <SettingsSwitchRow title="输入框角色" description={`显示在输入框右上角，随 ${brand.name} 的状态切换思考、工作、空闲和休息`} checked={mascotEnabled} onChange={setMascotEnabled} />
        </SettingsGroup>
      </SettingsSection>
      <ChatAppearanceSettings />
    </div>
  )
}

// ─── 快捷键 ────────────────────────────────────────────────

export function StarShortcutsSection() {
  const mod = navigator.platform.toLowerCase().includes('mac') ? '⌘' : 'Ctrl'
  // 设置 → 通用 → 发送消息 decides which of the two sends.
  const modifierSend = useSettingsStore(s => s.chatSendBehavior) === 'modifierEnter'
  const rows: [string, string[]][] = [
    ['新建会话', [mod, 'N']],
    ['发送消息', modifierSend ? [mod, 'Enter'] : ['Enter']],
    ['换行', modifierSend ? ['Enter'] : ['Shift', 'Enter']],
    ['放大界面', [mod, '=']],
    ['缩小界面', [mod, '-']],
    ['恢复默认大小', [mod, '0']],
    ['画布：缩放', [mod, '滚轮']],
    ['画布：平移', ['空格', '拖动']],
    ['画布：适应画布', ['Shift', '1']],
    ['画板编辑：微调位置', ['方向键']],
    ['画板编辑：删除图层', ['Delete']],
  ]
  return (
    <div>
      <SettingsPageHeader title="快捷键" />
      <div className="mt-4 overflow-hidden rounded-[var(--radius-lg)] border border-[var(--color-border)]">
        {rows.map(([label, keys]) => (
          <div key={label} className="flex items-center justify-between border-b border-[var(--color-border)] px-4 py-2.5 text-[13px] last:border-b-0">
            <span className="text-[var(--color-text-secondary)]">{label}</span>
            <span className="flex gap-1">{keys.map(key => <kbd key={key} className="rounded-[var(--radius-xs)] border border-[var(--color-border)] bg-[var(--color-surface-container-lowest)] px-1.5 py-0.5 font-mono text-[11px] text-[var(--color-text-tertiary)]">{key}</kbd>)}</span>
          </div>
        ))}
      </div>
    </div>
  )
}
