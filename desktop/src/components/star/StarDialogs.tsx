import { useCallback, useEffect, useMemo, useState } from 'react'
import QRCode from 'qrcode'
import { Crown, Loader2 } from 'lucide-react'
import { Modal } from '../ui/Modal'
import { Button } from '../ui/Button'
import { Input } from '../ui/Input'
import { TextArea } from '../ui/TextArea'
import { getDesktopHost } from '../../lib/desktopHost'
import { useUIStore } from '../../stores/uiStore'
import { useProviderStore } from '../../stores/providerStore'
import { useStarStore } from '../../stores/starStore'
import { getStarBrandName, useStarBrand } from '../../stores/starBrandStore'
import { starApi, starErrorText, type StarPlan, type StarStatus } from '../../api/star'
import { StarLoginScreen } from './StarLoginScreen'

function toast(type: 'success' | 'error' | 'info' | 'warning', message: string) {
  useUIStore.getState().addToast({ type, message })
}

/** Pill choices in the theme's selected-option colors (the model picker uses the same pair). */
const STAR_CHIP_ON = 'border-[var(--color-model-option-selected-border)] bg-[var(--color-model-option-selected-bg)] font-medium text-[var(--color-on-brand-soft)]'
const STAR_CHIP_OFF = 'border-[var(--color-border)] text-[var(--color-text-secondary)] hover:border-[var(--color-border-strong)] hover:text-[var(--color-text-primary)]'

/** Mounts the STAR dialogs that any part of the shell can open through the store. */
export function StarDialogs() {
  const loginOpen = useStarStore(s => s.loginOpen)
  const upgradeOpen = useStarStore(s => s.upgradeOpen)
  const feedbackOpen = useStarStore(s => s.feedbackOpen)
  return (
    <>
      {loginOpen && <StarLoginDialog />}
      {upgradeOpen && <StarUpgradeDialog initial={upgradeOpen} />}
      {feedbackOpen && <StarFeedbackDialog />}
    </>
  )
}

/** The sign-in, opened through the store: a full-window screen (StarLoginScreen.tsx). */
function StarLoginDialog() {
  const status = useStarStore(s => s.status)
  const close = useStarStore(s => s.closeLogin)
  const signedIn = useCallback((next: StarStatus, activate: boolean) => {
    useStarStore.getState().signedIn(next)
    if (activate) void useProviderStore.getState().fetchProviders?.()
    toast('success', `已登录 ${getStarBrandName()}：${next.user?.nickname || next.user?.phone || next.user?.email || ''}`)
  }, [])
  return <StarLoginScreen status={status} onClose={close} onSignedIn={signedIn} />
}

type Cycle = 'monthly' | 'yearly' | 'lifetime' | 'daily'
const CYCLE_LABEL: Record<Cycle, string> = { monthly: '月付', yearly: '年付', lifetime: '永久', daily: '日付' }
const PRICE_KEY: Record<Cycle, string> = { monthly: 'monthlyPrice', yearly: 'yearlyPrice', lifetime: 'lifetimePrice', daily: 'dailyPrice' }
const ORIGINAL_KEY: Partial<Record<Cycle, string>> = { monthly: 'monthlyOriginalPrice', yearly: 'yearlyOriginalPrice', lifetime: 'originalPrice' }

function money(value: unknown): number {
  const amount = Number(value)
  return Number.isFinite(amount) ? amount : 0
}

function yuan(amount: number): string {
  return `¥${Number.isInteger(amount) ? amount : amount.toFixed(2)}`
}

function StarUpgradeDialog({ initial }: { initial: 'plan' | 'credits' }) {
  const brand = useStarBrand()
  const close = useStarStore(s => s.closeUpgrade)
  const [tab, setTab] = useState<'plan' | 'credits'>(initial)
  const [cycle, setCycle] = useState<Cycle>('monthly')
  const [payType, setPayType] = useState<'alipay' | 'wxpay'>('alipay')
  const [plans, setPlans] = useState<StarPlan[] | null>(null)
  const [packs, setPacks] = useState<StarPlan[]>([])
  const [methods, setMethods] = useState({ alipay: true, wxpay: true })
  const [busyId, setBusyId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [paying, setPaying] = useState(false)
  /** The order being paid: its link as a QR code to scan, so no payment address is shown. */
  const [payment, setPayment] = useState<{ url: string; qr: string; payType: 'alipay' | 'wxpay'; name: string } | null>(null)
  const [audience, setAudience] = useState<'personal' | 'team'>('personal')
  const [seats, setSeats] = useState(3)

  useEffect(() => {
    let alive = true
    starApi.plans().then((data) => {
      if (!alive) return
      setPlans(data.plans.filter(plan => plan.enabled !== false))
      setPacks(data.creditPacks)
      const m = data.paymentMethods as Record<string, unknown>
      setMethods({ alipay: m.alipay !== false, wxpay: m.wxpay !== false })
      if (m.alipay === false && m.wxpay !== false) setPayType('wxpay')
    }).catch((err) => {
      if (alive) {
        setPlans([])
        setError(starErrorText(err))
      }
    })
    return () => { alive = false }
  }, [])

  const hasTeam = (plans ?? []).some(plan => plan.audience === 'team')
  // Team plans are priced per seat; the order's quantity is the seat count.
  const shown = useMemo(() => (plans ?? []).filter(plan => (plan.audience === 'team' ? 'team' : 'personal') === (hasTeam ? audience : 'personal')), [plans, audience, hasTeam])
  const team = hasTeam && audience === 'team'
  const cycles = useMemo(() => (['monthly', 'yearly', 'lifetime', 'daily'] as Cycle[]).filter(item => shown.some(plan => money(plan[PRICE_KEY[item]]) > 0)), [shown])
  useEffect(() => {
    if (cycles.length && !cycles.includes(cycle)) setCycle(cycles[0]!)
  }, [cycle, cycles])

  const buy = async (kind: 'plan' | 'credits', id: string) => {
    setBusyId(id)
    setError(null)
    try {
      const order = await starApi.order({ kind, id, billingCycle: cycle, payType, ...(kind === 'plan' && team ? { quantity: seats } : {}) })
      if (!order.payUrl) throw new Error('没有拿到支付链接，请稍后重试')
      // Paid by scanning, in the dialog: a WeChat Pay link cannot open in a
      // browser at all, and a page there would show the payment address.
      const qr = await QRCode.toDataURL(order.payUrl, { margin: 1, width: 240 })
      const item = [...(plans ?? []), ...packs].find(entry => String(entry.id ?? '') === id)
      setPayment({ url: order.payUrl, qr, payType, name: String(item?.name ?? (kind === 'plan' ? '会员套餐' : '积分包')) })
      setPaying(true)
    } catch (err) {
      setError(starErrorText(err))
    } finally {
      setBusyId(null)
    }
  }

  const paid = async () => {
    await useStarStore.getState().refreshQuota()
    toast('success', '账户信息已刷新')
    close()
  }

  return (
    <Modal open onClose={close} title={`${brand.name} 会员与积分`} width={720} typography="interface">
      <div className="flex flex-col gap-4" data-testid="star-upgrade-dialog">
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex gap-1 rounded-[var(--radius-md)] bg-[var(--color-surface-container)] p-1 text-[13px]">
            {(['plan', 'credits'] as const).map(item => (
              <button key={item} type="button" onClick={() => setTab(item)} className={`h-7 rounded-[var(--radius-sm)] px-4 transition-colors ${tab === item ? 'bg-[var(--color-surface-container-lowest)] font-medium text-[var(--color-text-primary)] shadow-sm' : 'text-[var(--color-text-tertiary)]'}`}>
                {item === 'plan' ? '会员套餐' : '积分包'}
              </button>
            ))}
          </div>
          {tab === 'plan' && hasTeam ? (
            <div className="flex gap-1 rounded-[var(--radius-md)] bg-[var(--color-surface-container)] p-1 text-[12px]">
              {(['personal', 'team'] as const).map(item => (
                <button key={item} type="button" onClick={() => setAudience(item)} className={`h-6 rounded-[var(--radius-sm)] px-3 transition-colors ${audience === item ? 'bg-[var(--color-surface-container-lowest)] font-medium text-[var(--color-text-primary)] shadow-sm' : 'text-[var(--color-text-tertiary)]'}`}>
                  {item === 'personal' ? '个人版' : '团队版'}
                </button>
              ))}
            </div>
          ) : null}
          {tab === 'plan' && cycles.length > 1 ? (
            <div className="flex gap-1 text-[12px]">
              {cycles.map(item => (
                <button key={item} type="button" onClick={() => setCycle(item)} className={`h-7 rounded-full border px-3 ${cycle === item ? STAR_CHIP_ON : STAR_CHIP_OFF}`}>{CYCLE_LABEL[item]}</button>
              ))}
            </div>
          ) : null}
          <div className="ml-auto flex gap-1 text-[12px]">
            {methods.alipay ? <button type="button" onClick={() => setPayType('alipay')} className={`h-7 rounded-full border px-3 ${payType === 'alipay' ? STAR_CHIP_ON : STAR_CHIP_OFF}`}>支付宝</button> : null}
            {methods.wxpay ? <button type="button" onClick={() => setPayType('wxpay')} className={`h-7 rounded-full border px-3 ${payType === 'wxpay' ? STAR_CHIP_ON : STAR_CHIP_OFF}`}>微信支付</button> : null}
          </div>
        </div>
        {tab === 'plan' && team ? (
          <div className="flex flex-wrap items-center gap-3 rounded-[var(--radius-md)] border border-[var(--color-border)] px-3 py-2 text-[12px] text-[var(--color-text-secondary)]">
            <span>席位数</span>
            <div className="flex items-center overflow-hidden rounded-[var(--radius-sm)] border border-[var(--color-border)]">
              <button type="button" aria-label="减少席位" disabled={seats <= 1} onClick={() => setSeats(value => Math.max(1, value - 1))} className="h-7 w-7 text-[14px] disabled:opacity-40">-</button>
              <input aria-label="席位数" value={seats} inputMode="numeric" onChange={event => { const value = Number(event.target.value.replace(/\D/g, '')); setSeats(Math.max(1, Math.min(200, value || 1))) }} className="h-7 w-12 border-x border-[var(--color-border)] bg-transparent text-center tabular-nums outline-none" />
              <button type="button" aria-label="增加席位" disabled={seats >= 200} onClick={() => setSeats(value => Math.min(200, value + 1))} className="h-7 w-7 text-[14px] disabled:opacity-40">+</button>
            </div>
            <span className="text-[var(--color-text-tertiary)]">按席位计价，每个席位一份额度；成员管理在网页端团队空间</span>
          </div>
        ) : null}
        {payment ? (
          <div data-testid="star-payment-qr" className="flex flex-col items-center gap-3 py-2">
            <img src={payment.qr} alt={`${payment.payType === 'wxpay' ? '微信' : '支付宝'}支付二维码`} className="h-[240px] w-[240px] rounded-[var(--radius-md)] border border-[var(--color-border)]" />
            <div className="text-[14px] font-medium text-[var(--color-text-primary)]">请用{payment.payType === 'wxpay' ? '微信' : '支付宝'}扫码支付</div>
            <div className="text-[12px] text-[var(--color-text-tertiary)]">{payment.name} · 支付完成后点下方按钮刷新账户</div>
            <div className="flex gap-2">
              {/^https?:\/\//i.test(payment.url) ? (
                <Button variant="ghost" size="sm" onClick={() => void getDesktopHost().shell.open(payment.url).catch(() => toast('error', '无法打开浏览器，请扫码支付'))}>在浏览器中支付</Button>
              ) : null}
              <Button variant="ghost" size="sm" onClick={() => setPayment(null)}>返回重新选择</Button>
            </div>
          </div>
        ) : plans === null ? (
          <div className="flex h-40 items-center justify-center text-[13px] text-[var(--color-text-tertiary)]"><Loader2 size={16} className="mr-2 animate-spin" />加载中…</div>
        ) : tab === 'plan' ? (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            {shown.filter(plan => money(plan[PRICE_KEY[cycle]]) > 0).map((plan) => {
              const id = String(plan.id ?? '')
              const price = money(plan[PRICE_KEY[cycle]])
              const original = money(ORIGINAL_KEY[cycle] ? plan[ORIGINAL_KEY[cycle]!] : 0)
              const tags = ((plan.features as { tags?: string[] } | null)?.tags ?? []).slice(0, 5)
              return (
                <div key={id} className={`flex flex-col gap-2 rounded-[var(--radius-lg)] border p-4 ${plan.isRecommended ? 'border-[var(--color-model-option-selected-border)] bg-[var(--color-model-option-selected-bg)]' : 'border-[var(--color-border)]'}`}>
                  <div className="flex items-center gap-1.5 text-[14px] font-semibold text-[var(--color-text-primary)]">
                    {plan.isRecommended ? <Crown size={14} className="text-[var(--color-warning)]" aria-hidden="true" /> : null}
                    {String(plan.name ?? '套餐')}
                  </div>
                  <div className="flex items-baseline gap-1.5">
                    <span className="text-[22px] font-semibold text-[var(--color-text-primary)]">{yuan(price)}</span>
                    {original > price ? <span className="text-[12px] text-[var(--color-text-tertiary)] line-through">{yuan(original)}</span> : null}
                    <span className="text-[12px] text-[var(--color-text-tertiary)]">{team ? '/席位' : ''}/{CYCLE_LABEL[cycle]}</span>
                  </div>
                  {team ? <div className="text-[12px] text-[var(--color-text-secondary)]">合计 {yuan(+(price * seats).toFixed(2))}（{seats} 席位）</div> : null}
                  {plan.description ? <p className="text-[12px] leading-5 text-[var(--color-text-tertiary)]">{String(plan.description)}</p> : null}
                  <ul className="flex flex-col gap-1 text-[12px] text-[var(--color-text-secondary)]">
                    {typeof plan.normalModelQuota === 'number' ? <li>· 普通模型 {plan.normalModelQuota} 次/天</li> : null}
                    {typeof plan.premiumModelQuota === 'number' ? <li>· 高级模型 {plan.premiumModelQuota} 次/天</li> : null}
                    {typeof plan.giftCredits === 'number' && plan.giftCredits > 0 ? <li>· 赠送 {plan.giftCredits} 积分</li> : null}
                    {tags.map(tag => <li key={tag}>· {tag}</li>)}
                  </ul>
                  <Button className="mt-auto" size="md" block loading={busyId === id} disabled={busyId !== null} onClick={() => void buy('plan', id)}>立即开通</Button>
                </div>
              )
            })}
            {!shown.some(plan => money(plan[PRICE_KEY[cycle]]) > 0) ? <div className="col-span-full py-10 text-center text-[13px] text-[var(--color-text-tertiary)]">暂无可购买的套餐</div> : null}
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {packs.map((pack) => {
              const id = String(pack.id ?? '')
              return (
                <div key={id} className="flex flex-col gap-1.5 rounded-[var(--radius-lg)] border border-[var(--color-border)] p-3.5">
                  <span className="text-[13px] font-semibold text-[var(--color-text-primary)]">{String(pack.name ?? `${money(pack.credits)} 积分`)}</span>
                  <span className="text-[12px] text-[var(--color-text-tertiary)]">{money(pack.credits)} 积分</span>
                  <span className="text-[18px] font-semibold text-[var(--color-text-primary)]">{yuan(money(pack.price))}</span>
                  <Button size="sm" block loading={busyId === id} disabled={busyId !== null} onClick={() => void buy('credits', id)}>购买</Button>
                </div>
              )
            })}
            {!packs.length ? <div className="col-span-full py-10 text-center text-[13px] text-[var(--color-text-tertiary)]">暂无积分包</div> : null}
          </div>
        )}
        {error ? <div className="text-[12px] text-[var(--color-error)]">{error}</div> : null}
        {paying ? <Button variant="secondary" size="md" block onClick={() => void paid()}>我已完成支付，刷新账户</Button> : null}
      </div>
    </Modal>
  )
}

function StarFeedbackDialog() {
  const close = useStarStore(s => s.closeFeedback)
  const [category, setCategory] = useState<'bug' | 'feature' | 'other'>('bug')
  const [message, setMessage] = useState('')
  const [contact, setContact] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const submit = async () => {
    if (!message.trim()) {
      setError('请填写反馈内容')
      return
    }
    setBusy(true)
    setError(null)
    try {
      await starApi.feedback({ category, message: message.trim(), contact: contact.trim() })
      toast('success', '感谢反馈，我们会尽快处理')
      close()
    } catch (err) {
      setError(starErrorText(err))
    } finally {
      setBusy(false)
    }
  }
  return (
    <Modal open onClose={close} title="意见反馈" width={480} typography="interface">
      <div className="flex flex-col gap-3">
        <div className="flex gap-2 text-[12px]">
          {([['bug', '问题反馈'], ['feature', '功能建议'], ['other', '其他']] as const).map(([value, label]) => (
            <button key={value} type="button" onClick={() => setCategory(value)} className={`h-7 rounded-full border px-3 ${category === value ? STAR_CHIP_ON : STAR_CHIP_OFF}`}>{label}</button>
          ))}
        </div>
        <TextArea label="反馈内容" value={message} onChange={event => setMessage(event.target.value)} rows={6} placeholder="请描述遇到的问题或建议，越具体越好" />
        <Input label="联系方式（可选）" value={contact} onChange={event => setContact(event.target.value)} placeholder="手机号 / 邮箱 / 微信" size="md" />
        {error ? <div className="text-[12px] text-[var(--color-error)]">{error}</div> : null}
        <Button size="md" block loading={busy} onClick={() => void submit()}>提交</Button>
      </div>
    </Modal>
  )
}
