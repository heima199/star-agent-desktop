import { MessageSquareText, QrCode, Smartphone } from 'lucide-react'
import { Button } from '../../components/ui/Button'
import { ImPlatformLogo, IM_PLATFORM_NAMES, type ImPlatformId } from '../../components/im/ImPlatformLogo'
import { useStarBrand } from '../../stores/starBrandStore'
import { useTabStore, SETTINGS_TAB_ID } from '../../stores/tabStore'
import { useUIStore, type SettingsTab } from '../../stores/uiStore'

const CHANNELS: { id: ImPlatformId; description: string }[] = [
  { id: 'feishu', description: '配置飞书机器人频道，支持私聊与群聊，消息双向同步到助手。' },
  { id: 'wechat', description: '扫码绑定个人微信，接收并回复私聊、群聊消息。' },
  { id: 'wecom', description: '配置企业微信智能机器人，适合单聊与群聊场景。' },
  { id: 'dingtalk', description: '配置钉钉机器人频道，支持单聊与群聊，适合团队办公。' },
  { id: 'qq', description: '配置 QQ 机器人频道，接入后在 QQ 中直接对话。' },
  { id: 'telegram', description: '通过 Telegram Bot 远程对话、切换项目和审批权限。' },
  { id: 'whatsapp', description: '扫码关联 WhatsApp，在手机上把任务交给助手。' },
  { id: 'slack', description: '通过 Slack App 在频道或私信中与助手协作。' },
]

const STEPS = ['选择通讯工具', '扫码或填写机器人凭证', '在手机上发消息']

function openSettings(tab: SettingsTab) {
  useUIStore.getState().setPendingSettingsTab(tab)
  useTabStore.getState().openTab(SETTINGS_TAB_ID, '设置', 'settings')
}

/** 手机助手: hand work to this computer from a phone, through an IM app or the H5 page. */
export function StarPhonePage() {
  const brand = useStarBrand()
  return (
    <section className="flex h-full min-h-0 flex-col overflow-y-auto bg-[var(--color-surface)]" data-testid="star-phone-page">
      <div className="mx-auto flex w-full max-w-[760px] flex-col gap-6 px-8 py-7">
        <h1 className="text-[18px] font-semibold text-[var(--color-text-primary)]">手机助手</h1>
        <div className="flex items-center gap-6 rounded-[var(--radius-xl)] border border-[var(--color-border)] bg-[var(--color-surface-container-low)] px-7 py-6">
          <div className="min-w-0 flex-1">
            <h2 className="text-[18px] font-semibold text-[var(--color-text-primary)]">在手机上，随时把工作交给 {brand.name}</h2>
            <p className="mt-1.5 text-[13px] leading-5 text-[var(--color-text-secondary)]">连接飞书、微信等通讯工具，把消息交给助手处理。助手在这台电脑上完成任务，再把结果发回聊天里。</p>
            <ol className="mt-3 flex flex-wrap gap-4 text-[12px] text-[var(--color-text-secondary)]">
              {STEPS.map((step, index) => (
                <li key={step} className="inline-flex items-center">
                  <span className="mr-1.5 inline-flex h-4 w-4 items-center justify-center rounded-full bg-[var(--color-brand-soft)] text-[11px] font-medium text-[var(--color-on-brand-soft)]">{index + 1}</span>
                  {step}
                </li>
              ))}
            </ol>
          </div>
          <div className="flex shrink-0 items-center justify-center rounded-[var(--radius-lg)] bg-[var(--color-brand-soft)] p-3 text-[var(--color-on-brand-soft)]">
            <Smartphone size={44} strokeWidth={1.3} aria-hidden="true" />
          </div>
        </div>
        <div>
          <div className="mb-2 flex items-center">
            <h3 className="text-[14px] font-semibold text-[var(--color-text-primary)]">连接 IM，随时找我聊</h3>
            <button type="button" onClick={() => openSettings('h5Access')} className="ml-auto inline-flex items-center gap-1 rounded-[var(--radius-xs)] text-[12px] text-[var(--color-text-accent)] hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-border-focus)]">
              <QrCode size={13} aria-hidden="true" />用手机浏览器扫码访问（H5）
            </button>
          </div>
          <ul className="overflow-hidden rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-surface-container-lowest)]">
            {CHANNELS.map(channel => (
              <li key={channel.id} data-testid={`star-phone-channel-${channel.id}`} className="flex items-center gap-3 border-b border-[var(--color-border)] px-4 py-3 transition-colors last:border-b-0 hover:bg-[var(--color-surface-hover)]">
                <ImPlatformLogo platform={channel.id} size={36} />
                <div className="min-w-0 flex-1">
                  <div className="text-[13px] font-semibold text-[var(--color-text-primary)]">{IM_PLATFORM_NAMES[channel.id]}</div>
                  <div className="truncate text-[12px] text-[var(--color-text-tertiary)]">{channel.description}</div>
                </div>
                <Button size="sm" variant="secondary" className="shrink-0 px-3" onClick={() => openSettings('adapters')}>连接</Button>
              </li>
            ))}
          </ul>
        </div>
        <div className="flex items-center gap-3 rounded-[var(--radius-lg)] border border-[var(--color-border)] px-4 py-3">
          <MessageSquareText size={18} className="shrink-0 text-[var(--color-text-tertiary)]" aria-hidden="true" />
          <p className="min-w-0 flex-1 text-[12px] leading-5 text-[var(--color-text-tertiary)]">在手机上发来的消息会在这台电脑上新建会话执行，权限审批同样会推送到手机。电脑需要保持开机并打开本应用。</p>
        </div>
      </div>
    </section>
  )
}
