import { useEffect, useMemo, useState } from 'react'
import { Plus, Trash2 } from 'lucide-react'
import { settingsApi } from '@/api/settings'
import { starErrorText } from '@/api/star'
import { SettingsGroup, SettingsPageHeader, SettingsRow, SettingsSection, SettingsSwitchRow } from '@/components/settings/SettingsSection'
import { useUIStore } from '@/stores/uiStore'

/**
 * 钩子: shell commands the agent runs at set moments (before a tool runs, when
 * a reply ends, …), kept where the CLI reads them, under `hooks` in the user
 * settings file. The server merges that file one key deep, so every change
 * writes the whole `hooks` object; entries this page cannot show are carried
 * over untouched.
 */

type HookEvent = { id: string; label: string; matcher?: { hint: string } }

/** The events the CLI fires, with what a matcher is matched against where one applies. */
export const HOOK_EVENTS: readonly HookEvent[] = [
  { id: 'PreToolUse', label: '工具调用前', matcher: { hint: '工具名，如 Bash 或 Edit|Write，留空匹配全部' } },
  { id: 'PostToolUse', label: '工具调用后', matcher: { hint: '工具名，如 Bash 或 Edit|Write，留空匹配全部' } },
  { id: 'UserPromptSubmit', label: '提交消息时' },
  { id: 'Stop', label: '回复结束时' },
  { id: 'SubagentStop', label: '子智能体结束时' },
  { id: 'Notification', label: '发出通知时' },
  { id: 'PreCompact', label: '压缩上下文前', matcher: { hint: 'manual 或 auto，留空匹配全部' } },
  { id: 'SessionStart', label: '会话开始时', matcher: { hint: 'startup、resume、clear 或 compact，留空匹配全部' } },
  { id: 'SessionEnd', label: '会话结束时' },
]

const MAX_TIMEOUT_SECONDS = 3_600

type HooksConfig = Record<string, unknown>
type HookRow = { key: string; event: string; group: number; index: number; matcher: string; type: string; text: string; timeout?: number }

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

/** Every hook the page can show, in file order. */
export function hookRows(config: HooksConfig): HookRow[] {
  const rows: HookRow[] = []
  for (const [event, groups] of Object.entries(config)) {
    if (!Array.isArray(groups)) continue
    groups.forEach((group, groupIndex) => {
      if (!isRecord(group) || !Array.isArray(group.hooks)) return
      const matcher = typeof group.matcher === 'string' ? group.matcher : ''
      group.hooks.forEach((hook, index) => {
        if (!isRecord(hook)) return
        const type = typeof hook.type === 'string' ? hook.type : 'command'
        const text = typeof hook.command === 'string' ? hook.command : typeof hook.prompt === 'string' ? hook.prompt : ''
        rows.push({
          key: `${event}:${groupIndex}:${index}`, event, group: groupIndex, index, matcher, type, text,
          ...(typeof hook.timeout === 'number' ? { timeout: hook.timeout } : {}),
        })
      })
    })
  }
  return rows
}

/** `config` with one command hook added, in the group of the same matcher when there is one. */
export function addHook(config: HooksConfig, event: string, matcher: string, command: string, timeout?: number): HooksConfig {
  const hook = { type: 'command', command, ...(timeout ? { timeout } : {}) }
  const groups = Array.isArray(config[event]) ? [...(config[event] as unknown[])] : []
  const at = groups.findIndex(group => isRecord(group) && Array.isArray(group.hooks) && (typeof group.matcher === 'string' ? group.matcher : '') === matcher)
  if (at >= 0) {
    const group = groups[at] as Record<string, unknown>
    groups[at] = { ...group, hooks: [...(group.hooks as unknown[]), hook] }
  } else {
    groups.push({ ...(matcher ? { matcher } : {}), hooks: [hook] })
  }
  return { ...config, [event]: groups }
}

/** `config` without the hook a row stands for; emptied groups and events go too. */
export function removeHook(config: HooksConfig, row: Pick<HookRow, 'event' | 'group' | 'index'>): HooksConfig {
  const groups = config[row.event]
  if (!Array.isArray(groups)) return config
  const group = groups[row.group]
  if (!isRecord(group) || !Array.isArray(group.hooks)) return config
  const hooks = group.hooks.filter((_, index) => index !== row.index)
  const nextGroups = hooks.length
    ? groups.map((item, index) => (index === row.group ? { ...group, hooks } : item))
    : groups.filter((_, index) => index !== row.group)
  const next = { ...config }
  if (nextGroups.length) next[row.event] = nextGroups
  else delete next[row.event]
  return next
}

const field = 'h-8 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface-container-lowest)] px-2.5 text-[13px] text-[var(--color-text-primary)] outline-none focus-visible:border-[var(--color-border-focus)]'

function toast(type: 'success' | 'error', message: string) {
  useUIStore.getState().addToast({ type, message })
}

export function StarHooksSection() {
  const [config, setConfig] = useState<HooksConfig | null>(null)
  const [paused, setPaused] = useState(false)
  const [loadFailed, setLoadFailed] = useState(false)
  const [saving, setSaving] = useState(false)
  const [event, setEvent] = useState(HOOK_EVENTS[0]!.id)
  const [matcher, setMatcher] = useState('')
  const [command, setCommand] = useState('')
  const [timeout, setTimeoutText] = useState('')

  useEffect(() => {
    let alive = true
    settingsApi.getUser().then(settings => {
      if (!alive) return
      setConfig(isRecord(settings.hooks) ? settings.hooks : {})
      setPaused(settings.disableAllHooks === true)
    }, () => {
      if (alive) setLoadFailed(true)
    })
    return () => { alive = false }
  }, [])

  const rows = useMemo(() => (config ? hookRows(config) : []), [config])
  const eventInfo = HOOK_EVENTS.find(item => item.id === event)
  const timeoutValue = timeout.trim() ? Number(timeout.trim()) : undefined
  const timeoutInvalid = timeoutValue !== undefined && !(Number.isInteger(timeoutValue) && timeoutValue > 0 && timeoutValue <= MAX_TIMEOUT_SECONDS)

  const save = async (next: HooksConfig): Promise<boolean> => {
    setSaving(true)
    try {
      await settingsApi.updateUser({ hooks: next })
      setConfig(next)
      return true
    } catch (error) {
      toast('error', starErrorText(error))
      return false
    } finally {
      setSaving(false)
    }
  }

  const add = async () => {
    if (!config || !command.trim() || timeoutInvalid) return
    const next = addHook(config, event, eventInfo?.matcher ? matcher.trim() : '', command.trim(), timeoutValue)
    if (await save(next)) {
      setCommand('')
      setTimeoutText('')
      toast('success', '已添加钩子，新对话开始生效')
    }
  }

  const togglePaused = async (checked: boolean) => {
    setSaving(true)
    try {
      await settingsApi.updateUser({ disableAllHooks: checked })
      setPaused(checked)
    } catch (error) {
      toast('error', starErrorText(error))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div>
      <SettingsPageHeader title="钩子" description="在智能体执行到特定时机时自动运行你的 Shell 命令，例如改完文件后格式化、提交消息前检查内容。" />
      <p role="note" className="mt-3 rounded-[var(--radius-md)] bg-[var(--color-warning-container)] px-3 py-2 text-[12px] leading-5 text-[var(--color-on-warning-container)]">
        钩子命令以你本人的权限自动运行，不再逐条确认。只添加你信任的命令；修改后对新对话生效。
      </p>
      {loadFailed ? (
        <p role="alert" className="mt-4 text-[13px] text-[var(--color-error)]">读取钩子配置失败，请稍后重试。</p>
      ) : !config ? (
        <p className="mt-4 text-[13px] text-[var(--color-text-tertiary)]">加载中…</p>
      ) : (
        <>
          <SettingsSection title="已配置">
            <SettingsGroup>
              <SettingsSwitchRow title="暂停全部钩子" description="开启后所有钩子都不运行，配置保留" checked={paused} disabled={saving} onChange={checked => void togglePaused(checked)} />
              {rows.length === 0 ? (
                <SettingsRow title="还没有钩子" description="在下面添加第一个" />
              ) : rows.map(row => (
                <SettingsRow
                  key={row.key}
                  title={`${HOOK_EVENTS.find(item => item.id === row.event)?.label ?? row.event}${row.matcher ? ` · ${row.matcher}` : ''}`}
                  description={(
                    <span className="block truncate font-mono text-[12px]" title={row.text}>
                      {row.type === 'command' ? row.text : `${row.type}：${row.text}`}{row.timeout ? `（超时 ${row.timeout} 秒）` : ''}
                    </span>
                  )}
                >
                  <button
                    type="button"
                    aria-label={`删除钩子：${row.text}`}
                    disabled={saving}
                    onClick={() => void save(removeHook(config, row))}
                    className="inline-flex h-8 w-8 items-center justify-center rounded-[var(--radius-md)] text-[var(--color-text-tertiary)] transition-colors hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-error)] disabled:opacity-50"
                  >
                    <Trash2 size={15} strokeWidth={1.75} aria-hidden="true" />
                  </button>
                </SettingsRow>
              ))}
            </SettingsGroup>
          </SettingsSection>

          <SettingsSection title="添加钩子">
            <SettingsGroup>
              <SettingsRow title="触发时机">
                <select aria-label="触发时机" value={event} onChange={item => setEvent(item.target.value)} className={field}>
                  {HOOK_EVENTS.map(item => <option key={item.id} value={item.id}>{item.label}（{item.id}）</option>)}
                </select>
              </SettingsRow>
              {eventInfo?.matcher ? (
                <SettingsRow title="匹配" description={eventInfo.matcher.hint}>
                  <input aria-label="匹配" value={matcher} onChange={item => setMatcher(item.target.value)} placeholder="留空匹配全部" className={`${field} w-[240px] font-mono`} />
                </SettingsRow>
              ) : null}
              <SettingsRow title="命令" description="在项目目录中运行；事件内容以 JSON 从标准输入传入" layout="stack">
                <input aria-label="命令" value={command} onChange={item => setCommand(item.target.value)} placeholder="例如 npx prettier --write ." className={`${field} w-full font-mono`} />
              </SettingsRow>
              <SettingsRow title="超时（秒）" description={timeoutInvalid ? `请输入 1 到 ${MAX_TIMEOUT_SECONDS} 之间的整数` : '留空使用默认的 60 秒'}>
                <input aria-label="超时（秒）" inputMode="numeric" value={timeout} onChange={item => setTimeoutText(item.target.value)} placeholder="60" aria-invalid={timeoutInvalid} className={`${field} w-[96px]`} />
              </SettingsRow>
            </SettingsGroup>
            <div className="mt-3 flex justify-end">
              <button
                type="button"
                disabled={saving || !command.trim() || timeoutInvalid}
                onClick={() => void add()}
                className="inline-flex h-8 items-center gap-1.5 rounded-[var(--radius-md)] bg-[var(--color-btn-primary-bg)] px-3 text-[13px] font-medium text-[var(--color-btn-primary-fg)] transition-colors hover:bg-[var(--color-btn-primary-hover)] disabled:opacity-50"
              >
                <Plus size={14} strokeWidth={1.75} aria-hidden="true" />添加钩子
              </button>
            </div>
          </SettingsSection>
        </>
      )}
    </div>
  )
}
