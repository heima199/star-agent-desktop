import { useEffect, useState } from 'react'
import { BookOpen, Download, ExternalLink, FileText, Loader2, Mail, MessageSquareText, RefreshCw, Users } from 'lucide-react'
import { starErrorText, type StarDesktopConfig } from '../../api/star'
import { SettingsGroup, SettingsPageHeader, SettingsRow, SettingsSection, SettingsSwitchRow } from '@/components/settings/SettingsSection'
import { MarkdownRenderer } from '../../components/markdown/MarkdownRenderer'
import { BrandSeal } from '../../components/composite/BrandSeal'
import { Modal } from '@/components/ui/Modal'
import { getDesktopHost } from '../../lib/desktopHost'
import { starUpdateStatusText } from '../../lib/starUpdate'
import { useTranslation } from '../../i18n'
import { useSettingsStore } from '../../stores/settingsStore'
import { useStarStore } from '../../stores/starStore'
import { useStarUpdateStore } from '../../stores/starUpdateStore'

const open = (url: string) => { if (/^https?:\/\//i.test(url)) void getDesktopHost().shell.open(url) }

/**
 * 关于 STAR: version, the update published in the STAR console, and the
 * links, support contact and legal documents configured by the operator
 * (站点设置 → 桌面端). Nothing here points at a code host.
 */
export function AboutSettings() {
  const t = useTranslation()
  const config = useStarStore(s => s.desktopConfig)
  const [version, setVersion] = useState('')
  // Shared with the automatic check and the dot on the settings entry.
  const check = useStarUpdateStore(s => s.latest)
  const [checking, setChecking] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [legal, setLegal] = useState<StarDesktopConfig['legal'][number] | null>(null)
  const autoUpdateEnabled = useSettingsStore(s => s.autoUpdateEnabled)
  const [autoUpdateSaving, setAutoUpdateSaving] = useState(false)
  const [autoUpdateError, setAutoUpdateError] = useState<string | null>(null)

  // Gates the startup notice (UpdateChecker) only; the manual check above
  // always works. The store rolls the value back when the save fails.
  const saveAutoUpdate = async (enabled: boolean) => {
    setAutoUpdateSaving(true)
    setAutoUpdateError(null)
    try {
      await useSettingsStore.getState().setAutoUpdateEnabled(enabled)
    } catch (failure) {
      setAutoUpdateError(starErrorText(failure))
    }
    setAutoUpdateSaving(false)
  }

  const runCheck = async () => {
    setChecking(true)
    setError(null)
    try {
      await useStarUpdateStore.getState().refresh()
    } catch (failure) {
      setError(starErrorText(failure))
    }
    setChecking(false)
  }

  useEffect(() => {
    void getDesktopHost().app.getVersion().then(setVersion).catch(() => undefined)
    void useStarStore.getState().loadDesktopConfig(true)
    void runCheck()
  }, [])

  const appName = config?.branding.appName || 'STAR'
  const about = config?.about
  const support = config?.support
  const links: { label: string; url: string; icon: typeof BookOpen }[] = [
    { label: '使用手册', url: about?.manualUrl ?? '', icon: BookOpen },
    { label: '用户社区', url: about?.communityUrl ?? '', icon: Users },
    { label: '服务条款', url: about?.termsUrl ?? '', icon: FileText },
    { label: '隐私政策', url: about?.privacyUrl ?? '', icon: FileText },
  ].filter(link => link.url)

  return (
    <div>
      <SettingsPageHeader title={`关于 ${appName}`} />
      <div className="mt-4 flex items-center gap-4 rounded-[var(--radius-lg)] border border-[var(--color-border)] p-5">
        {config?.branding.logoUrl ? <img src={config.branding.logoUrl} alt="" className="h-14 w-14 rounded-[var(--radius-lg)] object-contain" onError={event => { event.currentTarget.style.display = 'none' }} /> : <BrandSeal size="lg" />}
        <div className="min-w-0 flex-1">
          <div className="text-[18px] font-semibold text-[var(--color-text-primary)]">{appName}</div>
          <div className="mt-0.5 text-[12px] text-[var(--color-text-tertiary)]">{config?.branding.tagline || about?.description || '你的 AI 工作台：对话、办公、编程与设计。'}</div>
          <div className="mt-1 text-[12px] tabular-nums text-[var(--color-text-tertiary)]">版本 {version || '--'}</div>
        </div>
        <div className="flex flex-col items-end gap-1.5">
          {check?.hasUpdate ? (
            <button type="button" onClick={() => open(check.latest.downloadUrl!)} className="inline-flex h-8 items-center gap-1.5 rounded-[var(--radius-md)] bg-[var(--color-btn-primary-bg)] px-3 text-[13px] font-medium text-[var(--color-btn-primary-fg)]"><Download size={14} aria-hidden="true" />下载 {check.latest.version}</button>
          ) : (
            <button type="button" disabled={checking} onClick={() => void runCheck()} className="inline-flex h-8 items-center gap-1.5 rounded-[var(--radius-md)] border border-[var(--color-border)] px-3 text-[13px] hover:bg-[var(--color-surface-hover)] disabled:opacity-60">{checking ? <Loader2 size={14} className="animate-spin" aria-hidden="true" /> : <RefreshCw size={14} aria-hidden="true" />}检查更新</button>
          )}
          <span className="text-[11px] text-[var(--color-text-tertiary)]" title={error ?? undefined}>{starUpdateStatusText(check, Boolean(error), t)}</span>
        </div>
      </div>
      {check?.hasUpdate && check.latest.releaseNotes ? (
        <div className="mt-3 rounded-[var(--radius-lg)] border border-[var(--color-border)] px-4 py-3"><MarkdownRenderer content={check.latest.releaseNotes} variant="compact" /></div>
      ) : null}

      <SettingsSection title="更新">
        <SettingsGroup>
          <SettingsSwitchRow
            title="自动检查更新"
            description={`启动时检查 ${appName} 的新版本并提示下载；关闭后仍可在上方手动检查。`}
            checked={autoUpdateEnabled}
            onChange={enabled => void saveAutoUpdate(enabled)}
            disabled={autoUpdateSaving}
            footer={autoUpdateError ? <p role="alert" className="text-[12px] text-[var(--color-error)]">自动检查更新设置保存失败：{autoUpdateError}</p> : null}
          />
        </SettingsGroup>
      </SettingsSection>

      {links.length ? (
        <SettingsSection title="帮助与资源">
          <SettingsGroup>
            {links.map(link => (
              <SettingsRow key={link.label} title={link.label}>
                <button type="button" onClick={() => open(link.url)} className="inline-flex items-center gap-1 text-[13px] text-[var(--color-text-accent)] hover:underline"><link.icon size={13} aria-hidden="true" />打开<ExternalLink size={12} aria-hidden="true" /></button>
              </SettingsRow>
            ))}
          </SettingsGroup>
        </SettingsSection>
      ) : null}

      <SettingsSection title="联系我们">
        <SettingsGroup>
          {support?.enabled && support.description ? <SettingsRow title="客服说明" description={support.description} /> : null}
          {support?.hours ? <SettingsRow title="服务时间"><span className="text-[13px] text-[var(--color-text-secondary)]">{support.hours}</span></SettingsRow> : null}
          {support?.wechatId ? <SettingsRow title="微信"><span className="text-[13px] text-[var(--color-text-secondary)]">{support.wechatId}</span></SettingsRow> : null}
          {about?.email || support?.email ? <SettingsRow title="邮箱"><span className="inline-flex items-center gap-1 text-[13px] text-[var(--color-text-secondary)]"><Mail size={13} aria-hidden="true" />{about?.email || support?.email}</span></SettingsRow> : null}
          {support?.url ? <SettingsRow title="在线客服"><button type="button" onClick={() => open(support.url)} className="text-[13px] text-[var(--color-text-accent)] hover:underline">打开</button></SettingsRow> : null}
          <SettingsRow title="意见反馈" description="遇到问题或有建议，告诉我们">
            <button type="button" onClick={() => useStarStore.getState().openFeedback()} className="inline-flex h-8 items-center gap-1.5 rounded-[var(--radius-md)] border border-[var(--color-border)] px-3 text-[13px] hover:bg-[var(--color-surface-hover)]"><MessageSquareText size={14} aria-hidden="true" />反馈</button>
          </SettingsRow>
        </SettingsGroup>
        {support?.qrcodeUrl || about?.wecomQr ? (
          <div className="mt-3 flex items-center gap-3"><img src={support?.qrcodeUrl || about?.wecomQr} alt="客服二维码" className="h-28 w-28 rounded-[var(--radius-md)] bg-white object-contain p-1" /><span className="text-[12px] text-[var(--color-text-tertiary)]">微信扫码联系客服</span></div>
        ) : null}
      </SettingsSection>

      {config?.legal.length ? (
        <SettingsSection title="协议与政策">
          <SettingsGroup>
            {config.legal.map(doc => (
              <SettingsRow key={doc.id} title={doc.title}>
                <button type="button" onClick={() => (doc.content ? setLegal(doc) : open(doc.url))} className="text-[13px] text-[var(--color-text-accent)] hover:underline">查看</button>
              </SettingsRow>
            ))}
          </SettingsGroup>
        </SettingsSection>
      ) : null}
      {about?.copyright ? <p className="mt-6 text-center text-[11px] text-[var(--color-text-tertiary)]">{about.copyright}</p> : null}
      <Modal open={Boolean(legal)} onClose={() => setLegal(null)} title={legal?.title ?? ''} width={760}>
        {legal ? <div className="max-h-[64vh] overflow-y-auto"><MarkdownRenderer content={legal.content} variant="document" /></div> : null}
      </Modal>
    </div>
  )
}
