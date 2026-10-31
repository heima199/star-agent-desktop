import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import '@testing-library/jest-dom'

const apis = vi.hoisted(() => ({
  distribution: vi.fn(),
  applyAgent: vi.fn(),
  withdraw: vi.fn(),
  desktopConfig: vi.fn(),
}))

vi.mock('@/api/star', () => ({
  starApi: {
    distribution: apis.distribution,
    applyAgent: apis.applyAgent,
    withdraw: apis.withdraw,
    desktopConfig: apis.desktopConfig,
  },
  starErrorText: (error: unknown) => String(error),
}))

import type { StarDistribution, StarStatus } from '@/api/star'
import { useStarStore } from '@/stores/starStore'
import { clearPageCache } from '../starPageCache'
import { AffiliatePage, DistributionPage, PartnerPage } from './AccountPages'

const initialStarState = useStarStore.getState()

const SIGNED_IN: StarStatus = {
  configured: true,
  baseUrl: 'http://127.0.0.1:0',
  signedIn: true,
  user: { id: 'user-1', email: 'me@example.test', phone: null, nickname: '测试用户', avatar: null, inviteCode: 'INV123' },
  provider: { id: null, active: false, relayReady: false, mainModel: null },
  catalog: { fetchedAt: null, chatModels: 0, imageModels: 0, videoModels: 0 },
  starWorkSignInAvailable: false,
}

const INVITE = { inviteCode: 'INV123', rewardCredits: 50, maxRewards: 10, invitedCount: 3, inviteRewardCount: 2 }

const APPROVED: StarDistribution = {
  invite: INVITE,
  agent: { status: 'approved', enabled: true, commissionRate: 20 },
  dashboard: { totalEarnings: 1234.5, monthCommission: 88, todayCommission: '6.5', availableBalance: 300, totalOrders: 12, invitedUserCount: 3 },
  // No offset: parsed and printed in local time, so the expected text is timezone-independent.
  commissions: [{ createdAt: '2026-01-02T03:04:00', amount: 18.5, status: 'settled' }],
  invitedUsers: [{ createdAt: '2026-01-01T08:00:00', nickname: '小王', email: null, phone: '138****0000' }],
  withdrawals: [],
}

const NOT_AGENT: StarDistribution = { invite: INVITE, agent: null, dashboard: null, commissions: [], invitedUsers: [], withdrawals: [] }

const PARTNER_HEADING = '用你的品牌，开一个自己的 AI 站'

function pageSwitch() {
  const tablist = screen.getByRole('tablist', { name: '分销与开站' })
  return {
    tablist,
    distribution: within(tablist).getByRole('tab', { name: '分销中心' }),
    partner: within(tablist).getByRole('tab', { name: '开一个自己的AI站' }),
  }
}

const texts = (elements: HTMLElement[]) => elements.map(element => element.textContent)

/** Lets the background refresh `useLoad` starts on every mount land inside act. */
const settle = () => act(async () => { await Promise.resolve() })

beforeEach(() => {
  vi.clearAllMocks()
  clearPageCache()
  useStarStore.setState({ status: SIGNED_IN, desktopConfig: null })
  apis.distribution.mockResolvedValue(APPROVED)
  apis.applyAgent.mockResolvedValue({})
  apis.withdraw.mockResolvedValue({})
  apis.desktopConfig.mockResolvedValue(null)
})

afterEach(() => {
  Reflect.deleteProperty(navigator, 'clipboard')
  useStarStore.setState(initialStarState)
})

describe('AffiliatePage', () => {
  // 分销中心 and 开一个自己的AI站 used to be two pages; they are one page with a pill switch.
  it('is one 分销中心 page whose pill switch swaps the distribution and partner bodies', async () => {
    render(<AffiliatePage />)

    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1)
    expect(screen.getByRole('heading', { level: 1, name: '分销中心' })).toBeInTheDocument()
    const { tablist, distribution, partner } = pageSwitch()
    // A pill: the track and its segments take the full radius token.
    expect(tablist).toHaveClass('rounded-[var(--radius-full)]')
    expect(distribution).toHaveClass('rounded-[var(--radius-full)]')
    expect(distribution).toHaveAttribute('aria-selected', 'true')
    expect(partner).toHaveAttribute('aria-selected', 'false')
    expect(await screen.findByRole('region', { name: '佣金概览' })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: PARTNER_HEADING })).not.toBeInTheDocument()

    fireEvent.click(partner)

    expect(partner).toHaveAttribute('aria-selected', 'true')
    expect(distribution).toHaveAttribute('aria-selected', 'false')
    expect(partner).toHaveAttribute('aria-controls', screen.getByRole('tabpanel').id)
    expect(screen.getByRole('tabpanel', { name: '开一个自己的AI站' })).toContainElement(screen.getByRole('heading', { name: PARTNER_HEADING }))
    expect(screen.queryByRole('region', { name: '佣金概览' })).not.toBeInTheDocument()
    expect(screen.getByRole('heading', { level: 1, name: '分销中心' })).toBeInTheDocument()
    await settle()

    fireEvent.click(distribution)

    expect(distribution).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('tabpanel', { name: '分销中心' })).toContainElement(await screen.findByRole('region', { name: '佣金概览' }))
    expect(screen.queryByRole('heading', { name: PARTNER_HEADING })).not.toBeInTheDocument()
    await settle()
  })

  it('moves between the sections with the arrow keys and keeps a single tab stop', async () => {
    render(<AffiliatePage />)
    await screen.findByRole('region', { name: '佣金概览' })
    const { distribution, partner } = pageSwitch()
    expect(distribution).toHaveAttribute('tabindex', '0')
    expect(partner).toHaveAttribute('tabindex', '-1')

    distribution.focus()
    fireEvent.keyDown(distribution, { key: 'ArrowRight' })
    expect(partner).toHaveAttribute('aria-selected', 'true')
    expect(partner).toHaveFocus()
    expect(partner).toHaveAttribute('tabindex', '0')
    expect(distribution).toHaveAttribute('tabindex', '-1')

    fireEvent.keyDown(partner, { key: 'ArrowRight' })
    expect(distribution).toHaveAttribute('aria-selected', 'true')
    expect(distribution).toHaveFocus()

    fireEvent.keyDown(distribution, { key: 'End' })
    expect(partner).toHaveAttribute('aria-selected', 'true')
    fireEvent.keyDown(partner, { key: 'Home' })
    expect(distribution).toHaveAttribute('aria-selected', 'true')
    fireEvent.keyDown(distribution, { key: 'ArrowLeft' })
    expect(partner).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('heading', { name: PARTNER_HEADING })).toBeInTheDocument()
    await settle()
  })

  it('opens on initialTab and fetches distribution data only once that section is shown', async () => {
    render(<AffiliatePage initialTab="partner" />)

    const { distribution, partner } = pageSwitch()
    expect(partner).toHaveAttribute('aria-selected', 'true')
    expect(distribution).toHaveAttribute('aria-selected', 'false')
    expect(screen.getByRole('heading', { name: PARTNER_HEADING })).toBeInTheDocument()
    await waitFor(() => expect(apis.desktopConfig).toHaveBeenCalled())
    expect(apis.distribution).not.toHaveBeenCalled()

    fireEvent.click(distribution)

    expect(await screen.findByRole('region', { name: '佣金概览' })).toBeInTheDocument()
    expect(apis.distribution).toHaveBeenCalledTimes(1)
  })

  it('keeps DistributionPage as an entry into the merged page on its distribution section', async () => {
    render(<DistributionPage />)

    expect(screen.getByRole('heading', { level: 1, name: '分销中心' })).toBeInTheDocument()
    const { distribution, partner } = pageSwitch()
    expect(distribution).toHaveAttribute('aria-selected', 'true')
    expect(partner).toHaveAttribute('aria-selected', 'false')
    expect(screen.getByRole('tabpanel', { name: '分销中心' })).toContainElement(await screen.findByRole('region', { name: '佣金概览' }))
  })

  it('keeps PartnerPage as an entry into the merged page on its partner section', async () => {
    render(<PartnerPage />)

    expect(screen.getByRole('heading', { level: 1, name: '分销中心' })).toBeInTheDocument()
    const { distribution, partner } = pageSwitch()
    expect(partner).toHaveAttribute('aria-selected', 'true')
    expect(distribution).toHaveAttribute('aria-selected', 'false')
    expect(screen.getByRole('tabpanel', { name: '开一个自己的AI站' })).toContainElement(screen.getByRole('heading', { name: PARTNER_HEADING }))
    await waitFor(() => expect(apis.desktopConfig).toHaveBeenCalled())
    expect(apis.distribution).not.toHaveBeenCalled()
  })
})

describe('AffiliatePage distribution section', () => {
  it('lays out stat cards, then the invite card, then the record tabs', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } })
    render(<AffiliatePage />)

    const stats = await screen.findByRole('region', { name: '佣金概览' })
    const invite = screen.getByRole('region', { name: '邀请好友' })
    const records = screen.getByRole('region', { name: '分销记录' })
    expect(stats.compareDocumentPosition(invite) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(invite.compareDocumentPosition(records) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()

    expect(within(stats).getByText('累计佣金（元）').nextElementSibling).toHaveTextContent('1,234.5')
    expect(within(stats).getByText('今日佣金（元）').nextElementSibling).toHaveTextContent('6.5')
    expect(within(stats).getByText('佣金比例').nextElementSibling).toHaveTextContent('20%')

    fireEvent.click(within(invite).getByRole('button', { name: '复制邀请码 INV123' }))
    expect(writeText).toHaveBeenCalledWith('INV123')

    expect(within(records).getByRole('tab', { name: '佣金明细' })).toHaveAttribute('aria-selected', 'true')
    let table = within(records).getByRole('table', { name: '佣金明细' })
    expect(texts(within(table).getAllByRole('columnheader'))).toEqual(['时间', '金额', '状态'])
    expect(texts(within(table).getAllByRole('cell'))).toEqual(['2026-01-02 03:04', '18.5', 'settled'])

    fireEvent.click(within(records).getByRole('tab', { name: '邀请用户' }))
    table = within(records).getByRole('table', { name: '邀请用户' })
    expect(texts(within(table).getAllByRole('columnheader'))).toEqual(['注册时间', '昵称', '账号'])
    expect(texts(within(table).getAllByRole('cell'))).toEqual(['2026-01-01 08:00', '小王', '138****0000'])

    fireEvent.click(within(records).getByRole('tab', { name: '提现记录' }))
    table = within(records).getByRole('table', { name: '提现记录' })
    expect(texts(within(table).getAllByRole('columnheader'))).toEqual(['申请时间', '金额', '状态'])
    expect(within(table).queryAllByRole('cell')).toHaveLength(0)
    expect(within(records).getByText('暂无记录')).toBeInTheDocument()
  })

  it('submits a withdrawal from the 佣金概览 header and reloads the dashboard', async () => {
    render(<AffiliatePage />)
    const stats = await screen.findByRole('region', { name: '佣金概览' })

    fireEvent.click(within(stats).getByRole('button', { name: '申请提现' }))
    const dialog = screen.getByRole('dialog', { name: '申请提现' })
    fireEvent.change(within(dialog).getByPlaceholderText('提现金额（元）'), { target: { value: '100' } })
    fireEvent.change(within(dialog).getByPlaceholderText('收款账号与姓名'), { target: { value: 'me@example.test 张三' } })
    fireEvent.click(within(dialog).getByRole('button', { name: '提交' }))

    await waitFor(() => expect(apis.withdraw).toHaveBeenCalledWith({ amount: 100, accountType: 'alipay', accountInfo: 'me@example.test 张三' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    await waitFor(() => expect(apis.distribution).toHaveBeenCalledTimes(2))
  })

  it('offers the agent application instead of stats and records to a non-agent', async () => {
    apis.distribution.mockResolvedValue(NOT_AGENT)
    render(<AffiliatePage />)

    expect(await screen.findByText('成为分销代理')).toBeInTheDocument()
    expect(screen.getByRole('region', { name: '邀请好友' })).toBeInTheDocument()
    expect(screen.queryByRole('region', { name: '佣金概览' })).not.toBeInTheDocument()
    expect(screen.queryByRole('table')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '申请成为代理' }))

    await waitFor(() => expect(apis.applyAgent).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(apis.distribution).toHaveBeenCalledTimes(2))
  })

  it('asks a signed-out user to sign in on the distribution section only', async () => {
    useStarStore.setState({ status: { ...SIGNED_IN, signedIn: false, user: null } })
    render(<AffiliatePage />)

    expect(screen.getByText('请先登录 STAR 账号')).toBeInTheDocument()
    expect(apis.distribution).not.toHaveBeenCalled()
    await settle()

    fireEvent.click(pageSwitch().partner)

    expect(screen.getByRole('heading', { name: PARTNER_HEADING })).toBeInTheDocument()
    expect(screen.queryByText('请先登录 STAR 账号')).not.toBeInTheDocument()
    await waitFor(() => expect(apis.desktopConfig).toHaveBeenCalled())
  })
})
