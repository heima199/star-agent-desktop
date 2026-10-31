import { lazy, Suspense, useEffect, useState, type ComponentType } from 'react'
import { createPortal } from 'react-dom'
import {
  Blocks,
  Bot,
  Brain,
  Crown,
  Database,
  Info,
  Keyboard,
  LifeBuoy,
  MessageSquare,
  Palette,
  Server,
  Settings2,
  ShieldCheck,
  Smartphone,
  SquareTerminal,
  UserRound,
  UserRoundCog,
  X,
  type LucideIcon,
} from 'lucide-react'
import { STAR_OPEN_SETTINGS_EVENT } from '@/lib/starSettingsEvent'
import { useTabStore } from '@/stores/tabStore'
import { useUIStore, type SettingsTab } from '@/stores/uiStore'
import { useSettingsStore } from '@/stores/settingsStore'
import { useStarStore } from '@/stores/starStore'
import { useStarBrand } from '@/stores/starBrandStore'
import { PermissionModeSelector } from '@/components/controls/PermissionModeSelector'
import { SettingsGroup, SettingsPageHeader, SettingsRow, SettingsSection } from '@/components/settings/SettingsSection'
import { StarAppearanceSection, StarGeneralSection, StarModelsSection, StarNetworkSection, StarPlanSection, StarProfileSection, StarShortcutsSection } from './StarSettingsSections'

type SectionId = 'general' | 'advanced' | 'profile' | 'plan' | 'appearance' | 'shortcuts' | 'personal' | 'memory' | 'agents' | 'models' | 'assistant' | 'devices' | 'runtime' | 'data' | 'apps' | 'security' | 'about'

const pane = (load: () => Promise<Record<string, unknown>>, name: string) =>
  lazy(() => load().then(module => ({ default: module[name] as ComponentType<Record<string, unknown>> })))

const Panes = {
  general: pane(() => import('@/pages/settings/GeneralSettings'), 'GeneralSettings'),
  voice: pane(() => import('@/pages/settings/VoiceInputSettings'), 'VoiceInputSettings'),
  pets: pane(() => import('@/features/pets/PetSettings'), 'PetSettings'),
  memory: pane(() => import('@/pages/MemorySettings'), 'MemorySettings'),
  agents: pane(() => import('@/components/settings/AgentManager'), 'AgentManager'),
  adapters: pane(() => import('@/pages/AdapterSettings'), 'AdapterSettings'),
  h5: pane(() => import('@/pages/settings/H5AccessSettings'), 'H5AccessSettings'),
  computer: pane(() => import('@/pages/ComputerUseSettings'), 'ComputerUseSettings'),
  remote: pane(() => import('@/pages/star/StarPhonePage'), 'StarPhonePage'),
  activity: pane(() => import('@/pages/ActivitySettings'), 'ActivitySettings'),
  plugins: pane(() => import('@/pages/Settings'), 'PluginSettings'),
  skills: pane(() => import('@/pages/Settings'), 'SkillSettings'),
  mcp: pane(() => import('@/pages/McpSettings'), 'McpSettings'),
  terminal: pane(() => import('@/pages/TerminalSettings'), 'TerminalSettings'),
  // Loaded with the other STAR sections above; it needs no chunk of its own.
  network: StarNetworkSection as ComponentType<Record<string, unknown>>,
  hooks: pane(() => import('./StarHooksSection'), 'StarHooksSection'),
  diagnostics: pane(() => import('@/pages/DiagnosticsSettings'), 'DiagnosticsSettings'),
  about: pane(() => import('@/pages/settings/AboutSettings'), 'AboutSettings'),
}

type Sub = { id: keyof typeof Panes; label: string; props?: Record<string, unknown> }

const GROUPS: { label: string; items: { id: SectionId; label: string; icon: LucideIcon }[] }[] = [
  { label: '设置', items: [
    { id: 'general', label: '通用', icon: Settings2 },
    { id: 'profile', label: '个人主页', icon: UserRound },
    { id: 'plan', label: '套餐与积分', icon: Crown },
    { id: 'appearance', label: '外观', icon: Palette },
    { id: 'shortcuts', label: '快捷键', icon: Keyboard },
  ] },
  { label: '功能', items: [
    { id: 'personal', label: '个性化', icon: UserRoundCog },
    { id: 'memory', label: '记忆与进化', icon: Brain },
    { id: 'agents', label: '智能体', icon: Bot },
    { id: 'models', label: '模型', icon: Server },
    { id: 'assistant', label: '助理', icon: MessageSquare },
    { id: 'devices', label: '设备连接', icon: Smartphone },
    { id: 'runtime', label: '运行环境', icon: SquareTerminal },
  ] },
  { label: '数据与安全', items: [
    { id: 'data', label: '数据管理', icon: Database },
    { id: 'apps', label: '应用管理', icon: Blocks },
    { id: 'security', label: '安全中心', icon: ShieldCheck },
  ] },
]

const SUBS: Partial<Record<SectionId, Sub[]>> = {
  personal: [{ id: 'voice', label: '语音输入' }, { id: 'pets', label: '桌面宠物' }],
  // 远程控制 (IM bots + the phone page) left the sidebar for this tab.
  devices: [{ id: 'remote', label: '远程控制' }, { id: 'h5', label: '手机访问' }, { id: 'computer', label: '电脑操控' }],
  data: [{ id: 'activity', label: '使用统计' }, { id: 'general', label: '存储与保留' }],
  // 运行环境 is the one place for where and how commands run: the shell, the
  // network the agent's requests take, and the hooks that run at set moments.
  runtime: [{ id: 'terminal', label: '终端', props: { showPreferences: true } }, { id: 'network', label: '网络' }, { id: 'hooks', label: '钩子' }],
  apps: [{ id: 'plugins', label: '插件' }, { id: 'skills', label: '技能' }, { id: 'mcp', label: 'MCP' }],
  security: [{ id: 'diagnostics', label: '诊断' }],
}

// 模型 is STAR's own catalog (StarModelsSection), not the provider editor: the
// app offers no way to connect another model service or API key.
const SINGLE: Partial<Record<SectionId, keyof typeof Panes>> = {
  advanced: 'general', memory: 'memory', agents: 'agents', assistant: 'adapters', about: 'about',
}

/** Old settings tab ids (still used by callers) → section and sub-tab. */
const FROM_TAB: Record<SettingsTab, [SectionId, (keyof typeof Panes)?]> = {
  providers: ['models'], general: ['general'], voice: ['personal', 'voice'], h5Access: ['devices', 'h5'], adapters: ['assistant'],
  terminal: ['runtime', 'terminal'], mcp: ['apps', 'mcp'], agents: ['agents'], skills: ['apps', 'skills'], memory: ['memory'],
  plugins: ['apps', 'plugins'], pets: ['personal', 'pets'], computerUse: ['devices', 'computer'], activity: ['data', 'activity'],
  diagnostics: ['security', 'diagnostics'], about: ['about'],
}

function DefaultPermissionRow() {
  const permissionMode = useSettingsStore(s => s.permissionMode)
  const setPermissionMode = useSettingsStore(s => s.setPermissionMode)
  return (
    <SettingsSection title="执行权限">
      <SettingsGroup>
        <SettingsRow title="新对话默认权限" description="手动批准：每次授权前询问；默认：常规操作自动执行；全自动：不再确认">
          <PermissionModeSelector value={permissionMode} onChange={mode => void setPermissionMode(mode)} workDir="新对话" menuPlacement="bottom" menuAlign="right" />
        </SettingsRow>
      </SettingsGroup>
    </SettingsSection>
  )
}

/** Global settings card: grouped nav on the left, the section on the right. */
export function StarSettingsHost() {
  const brand = useStarBrand()
  const [open, setOpen] = useState(false)
  const [section, setSection] = useState<SectionId>('general')
  const [sub, setSub] = useState<keyof typeof Panes | null>(null)

  useEffect(() => {
    const onOpen = () => {
      const pending = useUIStore.getState().pendingSettingsTab
      if (pending) {
        const [next, nextSub] = FROM_TAB[pending] ?? ['general']
        setSection(next)
        setSub(nextSub ?? null)
        useUIStore.getState().setPendingSettingsTab(null)
      }
      setOpen(true)
    }
    window.addEventListener(STAR_OPEN_SETTINGS_EVENT, onOpen)
    return () => window.removeEventListener(STAR_OPEN_SETTINGS_EVENT, onOpen)
  }, [])

  // Opening a page from inside the card (记忆图谱, a session) moves the app
  // underneath it; the card gets out of the way instead of hiding the result.
  useEffect(() => {
    if (!open) return
    return useTabStore.subscribe((state, previous) => {
      if (state.activeTabId !== previous.activeTabId) setOpen(false)
    })
  }, [open])

  useEffect(() => {
    if (!open) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented) return
      if (document.querySelectorAll('[role="dialog"]').length > 1) return
      setOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open])

  if (!open) return null
  const subs = SUBS[section]
  const activeSub = subs ? (subs.find(item => item.id === sub) ?? subs[0]!) : null
  const single = SINGLE[section]
  const Pane = activeSub ? Panes[activeSub.id] : single ? Panes[single] : null
  const choose = (id: SectionId) => { setSection(id); setSub(null) }

  return createPortal(
    <div className="fixed inset-0 z-[var(--z-dialog)] flex items-center justify-center bg-black/45 p-6" onMouseDown={event => { if (event.target === event.currentTarget) setOpen(false) }}>
      <div role="dialog" aria-modal="true" aria-label="设置" className="flex h-[min(780px,90vh)] w-[min(1120px,94vw)] overflow-hidden rounded-[var(--radius-xl)] border border-[var(--color-border)] bg-[var(--color-surface)] shadow-[0_24px_80px_rgba(0,0,0,0.35)]">
        <nav aria-label="设置分类" className="flex w-[212px] shrink-0 flex-col overflow-y-auto border-r border-[var(--color-border)] bg-[var(--color-surface-sidebar,var(--color-surface-container-low))] px-2.5 py-4">
          {GROUPS.map(group => (
            <div key={group.label} className="mb-3">
              <div className="px-2.5 pb-1.5 text-[11px] font-medium text-[var(--color-text-tertiary)]">{group.label}</div>
              {group.items.map(item => {
                const active = section === item.id || (item.id === 'general' && section === 'advanced')
                return (
                  <button key={item.id} type="button" onClick={() => choose(item.id)} aria-current={active ? 'page' : undefined}
                    className={`flex h-8 w-full items-center gap-2.5 rounded-[var(--radius-md)] px-2.5 text-left text-[13px] ${active ? 'bg-[var(--color-surface-selected,var(--color-surface-container-high))] font-medium text-[var(--color-text-primary)]' : 'text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-text-primary)]'}`}>
                    <item.icon size={15} strokeWidth={1.75} className={active ? 'text-[var(--color-brand)]' : 'text-[var(--color-text-tertiary)]'} aria-hidden="true" />{item.label}
                  </button>
                )
              })}
            </div>
          ))}
          <div className="mt-auto border-t border-[var(--color-border)] pt-2">
            <button type="button" onClick={() => choose('about')} className={`flex h-8 w-full items-center gap-2.5 rounded-[var(--radius-md)] px-2.5 text-left text-[13px] ${section === 'about' ? 'bg-[var(--color-surface-container-high)] font-medium text-[var(--color-text-primary)]' : 'text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-hover)]'}`}>
              <Info size={15} strokeWidth={1.75} className="text-[var(--color-text-tertiary)]" aria-hidden="true" />关于 {brand.name}
            </button>
            {/* Problems and ideas go straight to the STAR team from here. */}
            <button type="button" onClick={() => useStarStore.getState().openFeedback()} className="flex h-8 w-full items-center gap-2.5 rounded-[var(--radius-md)] px-2.5 text-left text-[13px] text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-hover)]">
              <LifeBuoy size={15} strokeWidth={1.75} className="text-[var(--color-text-tertiary)]" aria-hidden="true" />帮助与反馈
            </button>
          </div>
        </nav>
        <div className="relative flex min-w-0 flex-1 flex-col">
          <button type="button" aria-label="关闭设置" onClick={() => setOpen(false)} className="absolute right-3 top-3 z-10 flex h-8 w-8 items-center justify-center rounded-[var(--radius-md)] text-[var(--color-text-tertiary)] hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-text-primary)]"><X size={16} aria-hidden="true" /></button>
          {subs ? (
            <div className="flex shrink-0 gap-1 border-b border-[var(--color-border)] px-8 pt-4">
              {subs.map(item => (
                <button key={item.id} type="button" onClick={() => setSub(item.id)} className={`-mb-px h-9 border-b-2 px-2 text-[13px] ${activeSub?.id === item.id ? 'border-[var(--color-text-primary)] font-medium text-[var(--color-text-primary)]' : 'border-transparent text-[var(--color-text-tertiary)] hover:text-[var(--color-text-secondary)]'}`}>{item.label}</button>
              ))}
            </div>
          ) : null}
          <div className="min-h-0 flex-1 overflow-y-auto [scrollbar-gutter:stable]">
            <div className="mx-auto w-full max-w-[880px] px-8 pb-16 pt-7">
              <Suspense fallback={<div className="py-10 text-center text-[13px] text-[var(--color-text-tertiary)]">加载中…</div>}>
                {section === 'general' ? <StarGeneralSection onAdvanced={() => setSection('advanced')} /> : null}
                {section === 'advanced' ? <button type="button" onClick={() => setSection('general')} className="mb-3 text-[13px] text-[var(--color-text-tertiary)] hover:text-[var(--color-text-primary)]">‹ 返回通用</button> : null}
                {section === 'profile' ? <StarProfileSection /> : null}
                {section === 'plan' ? <StarPlanSection /> : null}
                {section === 'models' ? <StarModelsSection /> : null}
                {section === 'appearance' ? <StarAppearanceSection /> : null}
                {section === 'shortcuts' ? <StarShortcutsSection /> : null}
                {section === 'security' ? <><SettingsPageHeader title="安全中心" description="默认权限与运行诊断。" /><DefaultPermissionRow /></> : null}
                {Pane ? <Pane {...(activeSub?.props ?? {})} /> : null}
              </Suspense>
            </div>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  )
}
