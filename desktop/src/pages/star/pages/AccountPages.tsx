import { useId, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import { BadgePercent, Blocks, Bot, Copy, Gift, Globe, KeyRound, LayoutDashboard, Mail, MessageSquareText, Plus, ServerCog, Share2, Trash2, Wallet, type LucideIcon } from 'lucide-react'
import { starApi, starErrorText } from '@/api/star'
import { Modal } from '@/components/ui/Modal'
import { Switch } from '@/components/ui/Switch'
import { useStarStore } from '../../../stores/starStore'
import { useStarBrand } from '../../../stores/starBrandStore'
import { useUIStore } from '../../../stores/uiStore'
import { EmptyHint, ErrorRow, LoadingRow, PillTabs, StarPageShell, formatDate, useLoad } from './StarPageShell'

const toast = (type: 'success' | 'error' | 'info', message: string) => useUIStore.getState().addToast({ type, message })
const copy = (text: string, label = '已复制') => { void navigator.clipboard.writeText(text).then(() => toast('success', label)) }
const num = (value: unknown): number | null => (typeof value === 'number' ? value : typeof value === 'string' && value.trim() && Number.isFinite(Number(value)) ? Number(value) : null)
const str = (value: unknown): string => (typeof value === 'string' ? value : typeof value === 'number' ? String(value) : '')

function Stat({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-surface-container-lowest)] px-4 py-3">
      <div className="text-[12px] text-[var(--color-text-tertiary)]">{label}</div>
      <div className="mt-1 text-[22px] font-semibold tabular-nums text-[var(--color-text-primary)]">{value}</div>
    </div>
  )
}

function SignedOutHint() {
  const brand = useStarBrand()
  return <EmptyHint icon={KeyRound} title={`请先登录 ${brand.name} 账号`} action={<button type="button" onClick={() => useStarStore.getState().openLogin()} className="h-8 rounded-[var(--radius-md)] bg-[var(--color-btn-primary-bg)] px-4 text-[13px] text-[var(--color-btn-primary-fg)]">登录</button>} />
}

// ─── 分销中心（分销 + 开站，一页两个分区） ────────────────

export type AffiliateTab = 'distribution' | 'partner'

const AFFILIATE_TABS: readonly { id: AffiliateTab; label: string; icon: LucideIcon }[] = [
  { id: 'distribution', label: '分销中心', icon: Share2 },
  { id: 'partner', label: '开一个自己的AI站', icon: Blocks },
]

/**
 * The page's two sections as one rounded pill. Arrow keys (and Home / End)
 * move between the segments and select them, like SegmentedControl's tablist.
 */
function AffiliateSwitch({ value, onChange, idBase }: { value: AffiliateTab; onChange: (tab: AffiliateTab) => void; idBase: string }) {
  const buttons = useRef<Partial<Record<AffiliateTab, HTMLButtonElement | null>>>({})
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const count = AFFILIATE_TABS.length
    const current = AFFILIATE_TABS.findIndex(tab => tab.id === value)
    const targets: Partial<Record<string, number>> = { ArrowRight: (current + 1) % count, ArrowLeft: (current + count - 1) % count, Home: 0, End: count - 1 }
    const next = AFFILIATE_TABS[targets[event.key] ?? -1]
    if (!next) return
    event.preventDefault()
    onChange(next.id)
    buttons.current[next.id]?.focus()
  }
  return (
    <div role="tablist" aria-label="分销与开站" onKeyDown={onKeyDown} className="inline-flex items-center gap-1 rounded-[var(--radius-full)] border border-[var(--color-border)] bg-[var(--color-surface-container-lowest)] p-1">
      {AFFILIATE_TABS.map(tab => {
        const active = tab.id === value
        return (
          <button
            key={tab.id}
            ref={node => { buttons.current[tab.id] = node }}
            type="button"
            role="tab"
            id={`${idBase}-${tab.id}`}
            aria-selected={active}
            aria-controls={active ? `${idBase}-panel` : undefined}
            tabIndex={active ? 0 : -1}
            onClick={() => onChange(tab.id)}
            className={`inline-flex h-8 items-center gap-1.5 rounded-[var(--radius-full)] px-4 text-[13px] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-border-focus)] ${active ? 'bg-[var(--color-surface-container-high)] font-medium text-[var(--color-text-primary)]' : 'text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-text-primary)]'}`}
          >
            <tab.icon size={14} strokeWidth={1.75} aria-hidden="true" />
            {tab.label}
          </button>
        )
      })}
    </div>
  )
}

/**
 * 分销中心 and 开一个自己的 AI 站 as one page: the pill under the header picks
 * which body shows. Only the shown body is mounted, so opening the partner
 * section does not fetch the account's distribution data.
 */
export function AffiliatePage({ initialTab = 'distribution' }: { initialTab?: AffiliateTab }) {
  const [tab, setTab] = useState<AffiliateTab>(initialTab)
  const idBase = useId()
  return (
    <StarPageShell
      icon={Share2}
      title="分销中心"
      description="邀请好友赚积分和佣金，或用你的品牌开一个自己的 AI 站。"
      toolbar={<AffiliateSwitch value={tab} onChange={setTab} idBase={idBase} />}
    >
      <div role="tabpanel" id={`${idBase}-panel`} aria-labelledby={`${idBase}-${tab}`}>
        {tab === 'distribution' ? <DistributionBody /> : <PartnerBody />}
      </div>
    </StarPageShell>
  )
}

/** The 分销中心 page id: the merged page, opened on its distribution section. */
export function DistributionPage() {
  return <AffiliatePage initialTab="distribution" />
}

/** The 开一个自己的 AI 站 page id: the merged page, opened on its partner section. */
export function PartnerPage() {
  return <AffiliatePage initialTab="partner" />
}

// ─── 分销 ──────────────────────────────────────────────────

const DASHBOARD_FIELDS: [string, string][] = [
  ['totalEarnings', '累计佣金（元）'],
  ['monthCommission', '本月佣金（元）'],
  ['todayCommission', '今日佣金（元）'],
  ['availableBalance', '可提现（元）'],
  ['totalOrders', '订单数'],
  ['invitedUserCount', '邀请用户'],
]

type RecordTab = 'commissions' | 'invitedUsers' | 'withdrawals'

const RECORD_TABS: readonly { id: RecordTab; label: string; columns: readonly (readonly [string, string])[] }[] = [
  { id: 'commissions', label: '佣金明细', columns: [['createdAt', '时间'], ['amount', '金额'], ['status', '状态']] },
  { id: 'invitedUsers', label: '邀请用户', columns: [['createdAt', '注册时间'], ['nickname', '昵称'], ['email', '账号']] },
  { id: 'withdrawals', label: '提现记录', columns: [['createdAt', '申请时间'], ['amount', '金额'], ['status', '状态']] },
]

const cellText = (row: Record<string, unknown>, key: string): string =>
  key === 'createdAt' ? formatDate(str(row[key])) : str(row[key] ?? (key === 'email' ? row.phone : '')) || '--'

/** 佣金明细 / 邀请用户 / 提现记录 as tabs over one table. */
function DistributionRecords({ rows }: { rows: Record<RecordTab, Record<string, unknown>[]> }) {
  const [tab, setTab] = useState<RecordTab>('commissions')
  const current = RECORD_TABS.find(item => item.id === tab) ?? RECORD_TABS[0]!
  const list = rows[tab]
  return (
    <section aria-label="分销记录" className="overflow-hidden rounded-[var(--radius-xl)] border border-[var(--color-border)] bg-[var(--color-surface-container-lowest)]">
      <div className="border-b border-[var(--color-border)] px-4 py-3">
        <PillTabs size="sm" items={RECORD_TABS} value={tab} onChange={setTab} />
      </div>
      <div role="table" aria-label={current.label}>
        <div role="row" className="grid grid-cols-3 gap-3 bg-[var(--color-surface-container-low)] px-4 py-2 text-[12px] text-[var(--color-text-tertiary)]">
          {current.columns.map(([key, label]) => <span key={key} role="columnheader" className="truncate">{label}</span>)}
        </div>
        {list.map((row, index) => (
          <div key={index} role="row" className="grid grid-cols-3 gap-3 border-t border-[var(--color-border)] px-4 py-2.5 text-[12px]">
            {current.columns.map(([key]) => <span key={key} role="cell" className="truncate tabular-nums text-[var(--color-text-secondary)]">{cellText(row, key)}</span>)}
          </div>
        ))}
      </div>
      {list.length === 0 ? <div className="border-t border-[var(--color-border)] px-4 py-8 text-center text-[12px] text-[var(--color-text-tertiary)]">暂无记录</div> : null}
    </section>
  )
}

function DistributionBody() {
  const signedIn = useStarStore(s => Boolean(s.status?.signedIn))
  const data = useLoad(() => (signedIn ? starApi.distribution() : Promise.resolve(null)), `dist-${signedIn}`)
  const [withdrawOpen, setWithdrawOpen] = useState(false)
  const [form, setForm] = useState({ amount: '', accountType: 'alipay', accountInfo: '' })
  const invite = data.data?.invite ?? null
  const agent = data.data?.agent ?? null
  const status = str(agent?.status)
  const approved = Boolean(agent && agent.enabled !== false && (!status || status === 'approved'))

  const apply = async () => {
    try {
      await starApi.applyAgent()
      toast('success', '申请已提交，审核通过后即可查看佣金')
      data.reload()
    } catch (error) {
      toast('error', starErrorText(error))
    }
  }
  const withdraw = async () => {
    try {
      await starApi.withdraw({ amount: Number(form.amount), accountType: form.accountType, accountInfo: form.accountInfo })
      toast('success', '提现申请已提交')
      setWithdrawOpen(false)
      data.reload()
    } catch (error) {
      toast('error', starErrorText(error))
    }
  }

  // Dashboard layout: stat cards, then the invite card, then the record tabs.
  return (
    <>
      {!signedIn ? <SignedOutHint /> : data.error ? <ErrorRow message={data.error} onRetry={data.reload} /> : data.loading && !data.data ? <LoadingRow /> : (
        <div className="space-y-6">
          {agent && approved ? (
            <section aria-label="佣金概览">
              <div className="mb-3 flex items-center justify-between gap-3">
                <div className="text-[15px] font-semibold text-[var(--color-text-primary)]">佣金概览</div>
                <button type="button" onClick={() => setWithdrawOpen(true)} className="inline-flex h-8 items-center gap-1.5 rounded-[var(--radius-md)] bg-[var(--color-btn-primary-bg)] px-3 text-[13px] text-[var(--color-btn-primary-fg)]"><Wallet size={14} strokeWidth={1.75} aria-hidden="true" />申请提现</button>
              </div>
              <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-4">
                {DASHBOARD_FIELDS.filter(([key]) => num(data.data?.dashboard?.[key]) !== null).map(([key, label]) => (
                  <Stat key={key} label={label} value={num(data.data?.dashboard?.[key])!.toLocaleString('zh-CN', { maximumFractionDigits: 2 })} />
                ))}
                {agent.commissionRate !== undefined ? <Stat label="佣金比例" value={`${str(agent.commissionRate)}%`} /> : null}
              </div>
            </section>
          ) : null}

          <section aria-label="邀请好友" className="flex flex-wrap items-center gap-5 rounded-[var(--radius-xl)] border border-[var(--color-border)] bg-[var(--color-surface-container-lowest)] p-5">
            <span className="flex h-12 w-12 items-center justify-center rounded-[var(--radius-lg)] bg-[var(--color-brand-soft)] text-[var(--color-text-accent)]"><Gift size={22} strokeWidth={1.75} aria-hidden="true" /></span>
            <div className="min-w-0 flex-1">
              <div className="text-[15px] font-semibold text-[var(--color-text-primary)]">邀请好友{invite?.rewardCredits ? `，每邀请 1 人得 ${str(invite.rewardCredits)} 积分` : ''}</div>
              <div className="mt-0.5 text-[12px] text-[var(--color-text-tertiary)]">好友注册时填写你的邀请码{invite?.maxRewards ? `，最多奖励 ${str(invite.maxRewards)} 次` : ''}。已邀请 {str(invite?.invitedCount) || '0'} 人，已获奖励 {str(invite?.inviteRewardCount) || '0'} 次。</div>
            </div>
            {invite?.inviteCode ? (
              <div className="flex items-center gap-3">
                <span className="text-[12px] text-[var(--color-text-tertiary)]">我的邀请码</span>
                <button type="button" aria-label={`复制邀请码 ${str(invite.inviteCode)}`} title="复制邀请码" onClick={() => copy(str(invite.inviteCode), '邀请码已复制')} className="inline-flex h-10 items-center gap-2 rounded-[var(--radius-md)] border border-dashed border-[var(--color-border-strong)] px-4 font-mono text-[15px] text-[var(--color-text-primary)] hover:bg-[var(--color-surface-hover)]">
                  {str(invite.inviteCode)}<Copy size={14} strokeWidth={1.75} aria-hidden="true" />
                </button>
              </div>
            ) : <span className="text-[13px] text-[var(--color-text-tertiary)]">邀请功能暂未开启</span>}
          </section>

          {!agent ? (
            <EmptyHint icon={BadgePercent} title="成为分销代理" hint="开通后可查看佣金明细、邀请用户和提现记录。" action={<button type="button" onClick={() => void apply()} className="h-8 rounded-[var(--radius-md)] bg-[var(--color-btn-primary-bg)] px-4 text-[13px] text-[var(--color-btn-primary-fg)]">申请成为代理</button>} />
          ) : !approved ? (
            <EmptyHint icon={BadgePercent} title={status === 'pending' ? '代理申请审核中' : status === 'rejected' ? '代理申请未通过' : '代理账号不可用'} hint="如有疑问请通过「意见反馈」联系我们。" />
          ) : (
            <DistributionRecords rows={{ commissions: data.data?.commissions ?? [], invitedUsers: data.data?.invitedUsers ?? [], withdrawals: data.data?.withdrawals ?? [] }} />
          )}
        </div>
      )}
      <Modal open={withdrawOpen} onClose={() => setWithdrawOpen(false)} title="申请提现" width={420}
        footer={<div className="flex w-full justify-end gap-2"><button type="button" onClick={() => setWithdrawOpen(false)} className="h-8 rounded-[var(--radius-md)] border border-[var(--color-border)] px-3 text-[13px]">取消</button><button type="button" onClick={() => void withdraw()} className="h-8 rounded-[var(--radius-md)] bg-[var(--color-btn-primary-bg)] px-3 text-[13px] text-[var(--color-btn-primary-fg)]">提交</button></div>}>
        <div className="space-y-3 text-[13px]">
          <input inputMode="decimal" value={form.amount} onChange={event => setForm({ ...form, amount: event.target.value })} placeholder="提现金额（元）" className="h-9 w-full rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface-container-lowest)] px-3 outline-none" />
          <select value={form.accountType} onChange={event => setForm({ ...form, accountType: event.target.value })} className="h-9 w-full rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface-container-lowest)] px-3 outline-none">
            <option value="alipay">支付宝</option><option value="wechat">微信</option><option value="bank">银行卡</option>
          </select>
          <input value={form.accountInfo} onChange={event => setForm({ ...form, accountInfo: event.target.value })} placeholder="收款账号与姓名" className="h-9 w-full rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface-container-lowest)] px-3 outline-none" />
        </div>
      </Modal>
    </>
  )
}

// ─── 开一个自己的 AI 站 ────────────────────────────────────

const BENEFITS: { icon: typeof Globe; title: string; desc: string }[] = [
  { icon: Globe, title: '独立品牌与域名', desc: '站点名称、Logo 与域名都是你自己的，用户看到的是你的品牌。' },
  { icon: Bot, title: '全站 AI 能力', desc: '对话、生图、视频等能力与主站同步，新模型上线即可使用。' },
  { icon: BadgePercent, title: '自主定价', desc: '套餐和积分价格由你设定，按自己的节奏做活动。' },
  { icon: Share2, title: '分销与分润', desc: '内置邀请与佣金体系，用户带来用户。' },
  { icon: LayoutDashboard, title: '分站后台', desc: '用户、订单、充值与数据在一个后台里管理。' },
  { icon: ServerCog, title: '技术托管', desc: '服务器、模型接入和版本升级由我们负责。' },
]

const STEPS = ['联系商务确认方案', '提交站点名称、域名与资料', '我们完成部署与品牌配置', '域名生效后正式上线']

function PartnerBody() {
  const config = useStarStore(s => s.desktopConfig)
  useLoad(() => useStarStore.getState().loadDesktopConfig(), 'desktop-config')
  const qrcode = config?.support.qrcodeUrl || config?.about.wecomQr || ''
  const email = config?.about.email || config?.support.email || ''
  const wechat = config?.support.wechatId || ''
  return (
    <>
      <section className="rounded-[var(--radius-xl)] border border-[var(--color-border)] bg-[var(--color-surface-container-lowest)] px-7 py-8">
        <span className="inline-flex items-center gap-1.5 rounded-full bg-[var(--color-brand-soft)] px-2.5 py-1 text-[12px] text-[var(--color-text-accent)]"><Blocks size={13} strokeWidth={1.75} aria-hidden="true" />SaaS 分站合伙人</span>
        <h2 className="mt-3 text-[26px] font-semibold leading-tight text-[var(--color-text-primary)]">用你的品牌，开一个自己的 AI 站</h2>
        <p className="mt-2 max-w-[640px] text-[14px] leading-7 text-[var(--color-text-secondary)]">独立品牌和域名，接入全站 AI 能力。价格你来定，分销分润自动结算，技术和运维交给我们。</p>
      </section>
      <div className="mb-3 mt-8 text-[15px] font-semibold text-[var(--color-text-primary)]">你将获得</div>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
        {BENEFITS.map(item => (
          <div key={item.title} className="rounded-[var(--radius-lg)] border border-[var(--color-border)] p-4">
            <item.icon size={18} strokeWidth={1.75} className="text-[var(--color-text-accent)]" aria-hidden="true" />
            <div className="mt-2 text-[14px] font-medium text-[var(--color-text-primary)]">{item.title}</div>
            <div className="mt-1 text-[12px] leading-5 text-[var(--color-text-tertiary)]">{item.desc}</div>
          </div>
        ))}
      </div>
      <div className="mb-3 mt-8 text-[15px] font-semibold text-[var(--color-text-primary)]">开通流程</div>
      <ol className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {STEPS.map((step, index) => (
          <li key={step} className="rounded-[var(--radius-lg)] border border-[var(--color-border)] p-4">
            <span className="flex h-6 w-6 items-center justify-center rounded-full bg-[var(--color-btn-primary-bg)] text-[12px] font-semibold text-[var(--color-btn-primary-fg)]">{index + 1}</span>
            <div className="mt-2 text-[13px] text-[var(--color-text-secondary)]">{step}</div>
          </li>
        ))}
      </ol>
      <section className="mt-8 flex flex-wrap items-center gap-6 rounded-[var(--radius-xl)] border border-[var(--color-border)] p-6">
        {qrcode ? <img src={qrcode} alt="商务企业微信二维码" className="h-32 w-32 rounded-[var(--radius-md)] bg-white object-contain p-1" /> : null}
        <div className="min-w-0 flex-1 space-y-2 text-[13px] text-[var(--color-text-secondary)]">
          <div className="text-[15px] font-semibold text-[var(--color-text-primary)]">联系商务，了解开通细节</div>
          {qrcode ? <p>用微信扫码添加企业微信，商务会协助你完成资料提交和上线。</p> : null}
          {wechat ? <p>微信：{wechat}</p> : null}
          {email ? <p className="inline-flex items-center gap-1.5"><Mail size={13} strokeWidth={1.75} aria-hidden="true" /><button type="button" onClick={() => copy(email, '邮箱已复制')} className="text-[var(--color-text-accent)] hover:underline">{email}</button></p> : null}
          {!qrcode && !email && !wechat ? <p>在「意见反馈」里留下联系方式和想开的站点，商务会尽快联系你。</p> : null}
          <button type="button" onClick={() => useStarStore.getState().openFeedback()} className="inline-flex h-8 items-center gap-1.5 rounded-[var(--radius-md)] border border-[var(--color-border)] px-3 text-[13px] hover:bg-[var(--color-surface-hover)]"><MessageSquareText size={14} strokeWidth={1.75} aria-hidden="true" />留言咨询</button>
        </div>
      </section>
    </>
  )
}

// ─── API 接入 ──────────────────────────────────────────────

export function ApiAccessPage() {
  const brand = useStarBrand()
  const signedIn = useStarStore(s => Boolean(s.status?.signedIn))
  const keys = useLoad(() => (signedIn ? starApi.apiKeys() : Promise.resolve(null)), `keys-${signedIn}`)
  const [name, setName] = useState('')
  const [secret, setSecret] = useState<string | null>(null)
  const baseUrl = keys.data?.baseUrl ?? ''
  const model = useStarStore(s => s.status?.provider.mainModel || s.catalog?.chat[0]?.id || '<模型 ID>')

  const create = async () => {
    try {
      const result = await starApi.createApiKey(name.trim() || '我的应用')
      setName('')
      setSecret(result.secret || null)
      keys.reload()
    } catch (error) {
      toast('error', starErrorText(error))
    }
  }
  // The service's address is never printed: the samples read it from
  // STAR_BASE_URL, which the copy button fills in for the user.
  const sample = `curl "$STAR_BASE_URL/chat/completions" \\\n  -H "Authorization: Bearer $STAR_API_KEY" \\\n  -H "Content-Type: application/json" \\\n  -d '{"model": "${model}", "messages": [{"role": "user", "content": "你好"}]}'`
  const python = `import os\nfrom openai import OpenAI\n\nclient = OpenAI(base_url=os.environ["STAR_BASE_URL"], api_key=os.environ["STAR_API_KEY"])\nreply = client.chat.completions.create(model="${model}", messages=[{"role": "user", "content": "你好"}])\nprint(reply.choices[0].message.content)`

  return (
    <StarPageShell icon={KeyRound} title="API 接入" description={`兼容 OpenAI 接口格式，按量调用 ${brand.name} 的全部模型，费用从账号积分扣除。`}>
      {!signedIn ? <SignedOutHint /> : (
        <div className="space-y-6">
          <section className="rounded-[var(--radius-lg)] border border-[var(--color-border)] p-4">
            <div className="text-[12px] text-[var(--color-text-tertiary)]">接口地址（Base URL）</div>
            <div className="mt-1 flex items-center gap-2 text-[13px] text-[var(--color-text-primary)]">
              {baseUrl ? (
                <>
                  <span className="font-mono text-[var(--color-text-secondary)]">STAR_BASE_URL</span>
                  <button type="button" onClick={() => copy(baseUrl)} className="inline-flex h-7 items-center gap-1 rounded-[var(--radius-md)] border border-[var(--color-border)] px-2 text-[12px] hover:bg-[var(--color-surface-hover)]"><Copy size={12} aria-hidden="true" />复制接口地址</button>
                </>
              ) : '--'}
            </div>
            <p className="mt-1.5 text-[12px] text-[var(--color-text-tertiary)]">接口地址不在页面上显示。复制后设为环境变量 STAR_BASE_URL（密钥设为 STAR_API_KEY），下面的示例直接读取。</p>
          </section>
          <section>
            <div className="mb-2 flex items-center gap-2">
              <span className="flex-1 text-[13px] font-medium text-[var(--color-text-secondary)]">API 密钥</span>
              <input value={name} onChange={event => setName(event.target.value)} placeholder="新密钥名称" className="h-8 w-[180px] rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface-container-lowest)] px-2.5 text-[13px] outline-none" />
              <button type="button" onClick={() => void create()} className="inline-flex h-8 items-center gap-1 rounded-[var(--radius-md)] bg-[var(--color-btn-primary-bg)] px-3 text-[13px] text-[var(--color-btn-primary-fg)]"><Plus size={14} aria-hidden="true" />创建密钥</button>
            </div>
            {keys.error ? <ErrorRow message={keys.error} onRetry={keys.reload} /> : null}
            <div className="overflow-hidden rounded-[var(--radius-lg)] border border-[var(--color-border)]">
              {keys.loading && !keys.data ? <LoadingRow /> : !keys.data?.keys.length ? <div className="px-4 py-8 text-center text-[13px] text-[var(--color-text-tertiary)]">还没有密钥</div> : keys.data.keys.map(key => (
                <div key={key.id} className="flex items-center gap-3 border-b border-[var(--color-border)] px-4 py-2.5 last:border-b-0">
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[13px] text-[var(--color-text-primary)]">{key.name || '未命名'}</div>
                    <div className="font-mono text-[12px] text-[var(--color-text-tertiary)]">{key.tokenMask} · 创建于 {formatDate(key.createdAt)}{key.lastUsedAt ? ` · 最近使用 ${formatDate(key.lastUsedAt)}` : ''}</div>
                  </div>
                  <Switch size="sm" label={`启用 ${key.name}`} checked={key.enabled} onChange={() => void starApi.toggleApiKey(key.id).then(() => keys.reload()).catch(error => toast('error', starErrorText(error)))} />
                  <button type="button" aria-label={`删除 ${key.name}`} onClick={() => { if (window.confirm(`删除密钥「${key.name}」？使用它的应用将无法再调用。`)) void starApi.deleteApiKey(key.id).then(() => keys.reload()).catch(error => toast('error', starErrorText(error))) }} className="rounded p-1 text-[var(--color-text-tertiary)] hover:text-[var(--color-error)]"><Trash2 size={14} aria-hidden="true" /></button>
                </div>
              ))}
            </div>
          </section>
          {[['cURL', sample], ['Python（openai SDK）', python]].map(([title, code]) => (
            <section key={title}>
              <div className="mb-2 flex items-center justify-between text-[13px] font-medium text-[var(--color-text-secondary)]">{title}<button type="button" onClick={() => copy(code!)} className="inline-flex items-center gap-1 text-[12px] text-[var(--color-text-tertiary)] hover:text-[var(--color-text-primary)]"><Copy size={12} aria-hidden="true" />复制</button></div>
              <pre className="overflow-x-auto rounded-[var(--radius-lg)] bg-[var(--color-surface-container)] p-4 font-mono text-[12px] leading-5 text-[var(--color-text-secondary)]">{code}</pre>
            </section>
          ))}
        </div>
      )}
      <Modal open={Boolean(secret)} onClose={() => setSecret(null)} title="密钥已创建" width={520}
        footer={<div className="flex w-full justify-end"><button type="button" onClick={() => { if (secret) copy(secret, '密钥已复制'); setSecret(null) }} className="h-8 rounded-[var(--radius-md)] bg-[var(--color-btn-primary-bg)] px-3 text-[13px] text-[var(--color-btn-primary-fg)]">复制并关闭</button></div>}>
        <p className="text-[13px] text-[var(--color-text-secondary)]">完整密钥只显示这一次，请妥善保存，不要提交到代码仓库。</p>
        <div className="mt-3 break-all rounded-[var(--radius-md)] bg-[var(--color-surface-container)] p-3 font-mono text-[12px] text-[var(--color-text-primary)]">{secret}</div>
      </Modal>
    </StarPageShell>
  )
}
