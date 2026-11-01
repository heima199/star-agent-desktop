import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import '@testing-library/jest-dom'

import { starApi, type StarLegalDocument, type StarStatus } from '../../api/star'
import { BRAND_LOGO_ROTATING_SRC, BRAND_LOGO_SRC } from '../composite/BrandSeal'
import { useProviderStore } from '../../stores/providerStore'
import { useStarStore } from '../../stores/starStore'
import { useUIStore } from '../../stores/uiStore'
import { StarDialogs } from './StarDialogs'
import { STAR_LOGIN_AGREEMENT_HINT, StarLoginScreen } from './StarLoginScreen'
import { STAR_LOGIN_AGREED_STORAGE_KEY } from './starLoginForm'

const SIGNED_OUT: StarStatus = {
  configured: true,
  baseUrl: 'https://star.example.test',
  signedIn: false,
  user: null,
  provider: { id: null, active: false, relayReady: false, mainModel: null },
  catalog: { fetchedAt: null, chatModels: 0, imageModels: 0, videoModels: 0 },
  starWorkSignInAvailable: false,
}

const SIGNED_IN: StarStatus = { ...SIGNED_OUT, signedIn: true, user: { nickname: '小星' } as StarStatus['user'] }

const TERMS: StarLegalDocument = {
  id: 'terms',
  title: '用户协议',
  bodyHtml: '<h2>第一条</h2><p>请阅读<a href="https://example.test/terms">完整条款</a></p><script>window.__legal = 1</script><img src="https://example.test/p.png">',
  body: '',
  updatedAt: 0,
}

function renderScreen(props: Partial<Parameters<typeof StarLoginScreen>[0]> = {}) {
  const onClose = vi.fn()
  const onSignedIn = vi.fn()
  render(<StarLoginScreen status={SIGNED_OUT} onClose={onClose} onSignedIn={onSignedIn} {...props} />)
  return { onClose, onSignedIn }
}

/** Lets the legal-docs request settle. */
async function settle() {
  await act(async () => {})
}

describe('StarLoginScreen', () => {
  beforeEach(() => {
    window.localStorage.removeItem(STAR_LOGIN_AGREED_STORAGE_KEY)
    vi.spyOn(starApi, 'legalDocs').mockResolvedValue({ docs: [TERMS] })
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
    window.localStorage.removeItem(STAR_LOGIN_AGREED_STORAGE_KEY)
  })

  it('covers the window with the logo card and the reference form, and links nowhere', async () => {
    renderScreen()
    await settle()

    const screenRoot = screen.getByTestId('star-login-dialog')
    expect(screenRoot.parentElement).toBe(document.body)
    expect(screenRoot).toHaveClass('star-login-screen')
    expect(screen.getByTestId('star-login-card').querySelectorAll('.star-login-blob')).toHaveLength(3)
    // logo需替换掉，用桌面的白色.svg和黑色.svg适配做我们的logo: the card shows the
    // rotating glass star, black on the paper themes and white on the dark one;
    // the small mark for narrow windows is BrandSeal.
    const logos = Array.from(screen.getByTestId('star-login-card').querySelectorAll('img.star-login-logo'))
    expect(logos.map(image => image.getAttribute('src'))).toEqual([
      expect.stringMatching(/star-glass-black\.svg$/),
      expect.stringMatching(/star-glass-white\.svg$/),
    ])
    expect(logos[0]).toHaveClass('dark:hidden')
    expect(logos[1]).toHaveClass('hidden', 'dark:block')
    expect(screenRoot.querySelector('.star-login-brand [data-testid="brand-seal"]')).not.toBeNull()
    expect(screen.getByRole('heading', { name: '欢迎登录' })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: '验证码登录' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('tab', { name: '密码登录' })).toHaveAttribute('aria-selected', 'false')
    expect(screen.getByLabelText('手机号或邮箱')).toHaveFocus()
    expect(screen.getByLabelText('6位验证码')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '发送验证码' })).toBeEnabled()
    expect(screen.getByText('未注册的手机号或邮箱将自动创建账号')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '《用户协议》' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '《隐私政策》' })).toBeInTheDocument()
    expect(document.body.querySelector('a[href]')).toBeNull()
  })

  it('switches between 验证码登录 and 密码登录', () => {
    renderScreen()

    fireEvent.click(screen.getByRole('tab', { name: '密码登录' }))
    expect(screen.getByRole('tab', { name: '密码登录' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByLabelText('密码')).toHaveAttribute('type', 'password')
    expect(screen.getByLabelText('邮箱')).toBeInTheDocument()
    expect(screen.queryByLabelText('6位验证码')).toBeNull()
    expect(screen.queryByRole('button', { name: '发送验证码' })).toBeNull()
    expect(screen.queryByText('未注册的手机号或邮箱将自动创建账号')).toBeNull()

    fireEvent.click(screen.getByRole('tab', { name: '验证码登录' }))
    expect(screen.getByLabelText('6位验证码')).toBeInTheDocument()
    expect(screen.queryByLabelText('密码')).toBeNull()
  })

  it('sends a code only to a valid account and then counts 60 seconds down', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] })
    const sendCode = vi.spyOn(starApi, 'sendCode').mockResolvedValue({ ok: true })
    renderScreen()

    fireEvent.click(screen.getByRole('button', { name: '发送验证码' }))
    expect(sendCode).not.toHaveBeenCalled()
    expect(screen.getByRole('alert')).toHaveTextContent('请输入手机号或邮箱')

    fireEvent.change(screen.getByLabelText('手机号或邮箱'), { target: { value: ' 13800138000 ' } })
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '发送验证码' }))
    })
    expect(sendCode).toHaveBeenCalledWith('13800138000')
    expect(screen.getByRole('status')).toHaveTextContent('验证码已发送，请查收短信')
    expect(screen.getByRole('button', { name: '60 秒后重发' })).toBeDisabled()

    act(() => { vi.advanceTimersByTime(1000) })
    expect(screen.getByRole('button', { name: '59 秒后重发' })).toBeDisabled()

    act(() => { vi.advanceTimersByTime(59_000) })
    expect(screen.getByRole('button', { name: '发送验证码' })).toBeEnabled()
  })

  it('signs in only after the agreement is ticked, then remembers it', async () => {
    const login = vi.spyOn(starApi, 'login').mockResolvedValue(SIGNED_IN)
    const { onSignedIn } = renderScreen()

    fireEvent.change(screen.getByLabelText('手机号或邮箱'), { target: { value: '13800138000' } })
    fireEvent.change(screen.getByLabelText('6位验证码'), { target: { value: '验证码：123456' } })
    expect(screen.getByLabelText('6位验证码')).toHaveValue('123456')

    const submit = screen.getByRole('button', { name: '登录' })
    expect(submit).toHaveAttribute('aria-disabled', 'true')
    fireEvent.click(submit)
    expect(login).not.toHaveBeenCalled()
    expect(screen.getByRole('alert')).toHaveTextContent(STAR_LOGIN_AGREEMENT_HINT)

    fireEvent.click(screen.getByRole('checkbox', { name: /我已阅读并同意/ }))
    expect(screen.queryByRole('alert')).toBeNull()
    expect(submit).toHaveAttribute('aria-disabled', 'false')

    fireEvent.click(submit)
    await waitFor(() => expect(onSignedIn).toHaveBeenCalledWith(SIGNED_IN, true))
    expect(login).toHaveBeenCalledWith({ account: '13800138000', code: '123456', activate: true })
    expect(window.localStorage.getItem(STAR_LOGIN_AGREED_STORAGE_KEY)).toBe('1')
  })

  it('signs in by password with an email and keeps the service error on failure', async () => {
    window.localStorage.setItem(STAR_LOGIN_AGREED_STORAGE_KEY, '1')
    const login = vi.spyOn(starApi, 'login').mockRejectedValue(new Error('密码错误'))
    const { onSignedIn } = renderScreen()
    expect(screen.getByRole('checkbox', { name: /我已阅读并同意/ })).toBeChecked()

    fireEvent.click(screen.getByRole('tab', { name: '密码登录' }))
    fireEvent.change(screen.getByLabelText('邮箱'), { target: { value: 'me@example.test' } })
    fireEvent.change(screen.getByLabelText('密码'), { target: { value: 'secret' } })
    fireEvent.click(screen.getByRole('button', { name: '登录' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('密码错误')
    expect(login).toHaveBeenCalledWith({ account: 'me@example.test', password: 'secret', activate: true })
    expect(onSignedIn).not.toHaveBeenCalled()
  })

  it('opens 用户协议 inside the app without its links or scripts, and 「暂未发布」 for a missing 隐私政策', async () => {
    renderScreen()
    await settle()

    fireEvent.click(screen.getByRole('button', { name: '《用户协议》' }))
    const dialog = screen.getByTestId('star-legal-dialog')
    expect(dialog).toHaveTextContent('第一条')
    expect(dialog).toHaveTextContent('完整条款')
    expect(dialog.querySelector('a, script, img')).toBeNull()
    expect(document.body.querySelector('a[href]')).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: '我知道了' }))
    expect(screen.queryByTestId('star-legal-dialog')).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: '《隐私政策》' }))
    expect(screen.getByTestId('star-legal-dialog')).toHaveTextContent('暂未发布')
  })

  it('says 「暂未发布」 when the console has published nothing', async () => {
    vi.spyOn(starApi, 'legalDocs').mockResolvedValue({ docs: [] })
    renderScreen()
    await settle()

    fireEvent.click(screen.getByRole('button', { name: '《用户协议》' }))
    expect(screen.getByTestId('star-legal-dialog')).toHaveTextContent('暂未发布')
  })

  it('closes on Esc, but an Esc in the legal dialog only closes that dialog', async () => {
    const { onClose } = renderScreen()
    await settle()

    fireEvent.click(screen.getByRole('button', { name: '《隐私政策》' }))
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByTestId('star-legal-dialog')).toBeNull()
    expect(onClose).not.toHaveBeenCalled()

    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(1)

    fireEvent.click(screen.getByRole('button', { name: '暂不登录' }))
    expect(onClose).toHaveBeenCalledTimes(2)
  })

  // logo也不动有些电脑: Windows reports reduced motion whenever its animation
  // effects are off. The blobs stop for it (starLogin.css); the star turns.
  it('keeps the star turning under reduced motion', () => {
    const original = window.matchMedia
    window.matchMedia = vi.fn().mockReturnValue({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() }) as never
    try {
      renderScreen()
      const card = screen.getByTestId('star-login-card')
      expect(card).toHaveAttribute('data-animate', 'true')
      expect(card).not.toHaveClass('is-still')
      expect(Array.from(card.querySelectorAll('img.star-login-logo')).map(image => image.getAttribute('src')))
        .toEqual([BRAND_LOGO_ROTATING_SRC.light, BRAND_LOGO_ROTATING_SRC.dark])
    } finally {
      window.matchMedia = original
    }
  })

  it('holds the card still while the window is hidden', () => {
    const visibility = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden')
    try {
      renderScreen()
      const card = screen.getByTestId('star-login-card')
      expect(card).toHaveAttribute('data-animate', 'false')
      expect(card).toHaveClass('is-still')
      // The still first frame of the star, in both inks.
      expect(Array.from(card.querySelectorAll('img.star-login-logo')).map(image => image.getAttribute('src')))
        .toEqual([BRAND_LOGO_SRC.light, BRAND_LOGO_SRC.dark])
    } finally {
      visibility.mockRestore()
    }
  })

  it('offers the STAR Work sign-in behind the same agreement', async () => {
    const starWork = vi.spyOn(starApi, 'loginWithStarWork').mockResolvedValue(SIGNED_IN)
    const { onSignedIn } = renderScreen({ status: { ...SIGNED_OUT, starWorkSignInAvailable: true } })

    fireEvent.click(screen.getByRole('button', { name: '使用本机 STAR Work 的登录' }))
    expect(starWork).not.toHaveBeenCalled()
    expect(screen.getByRole('alert')).toHaveTextContent(STAR_LOGIN_AGREEMENT_HINT)

    fireEvent.click(screen.getByRole('checkbox', { name: /我已阅读并同意/ }))
    fireEvent.click(screen.getByRole('switch', { name: '登录后把 STAR 设为默认对话模型' }))
    fireEvent.click(screen.getByRole('button', { name: '使用本机 STAR Work 的登录' }))
    await waitFor(() => expect(onSignedIn).toHaveBeenCalledWith(SIGNED_IN, false))
    expect(starWork).toHaveBeenCalledWith(false)
  })
})

describe('StarDialogs sign-in', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    window.localStorage.removeItem(STAR_LOGIN_AGREED_STORAGE_KEY)
    useStarStore.setState({ status: null, loginOpen: false })
  })

  it('opens the full-window StarLoginDialog from the store and closes it once signed in', async () => {
    window.localStorage.setItem(STAR_LOGIN_AGREED_STORAGE_KEY, '1')
    vi.spyOn(starApi, 'legalDocs').mockResolvedValue({ docs: [] })
    vi.spyOn(starApi, 'login').mockResolvedValue(SIGNED_IN)
    vi.spyOn(starApi, 'quota').mockResolvedValue(null as never)
    vi.spyOn(starApi, 'catalog').mockResolvedValue({ catalog: null } as never)
    const fetchProviders = vi.fn().mockResolvedValue(undefined)
    useProviderStore.setState({ fetchProviders } as never)
    useUIStore.setState({ toasts: [] })
    useStarStore.setState({ status: SIGNED_OUT, loginOpen: true })
    render(<StarDialogs />)

    expect(screen.getByTestId('star-login-dialog')).toHaveClass('star-login-screen')
    fireEvent.change(screen.getByLabelText('手机号或邮箱'), { target: { value: 'me@example.test' } })
    fireEvent.change(screen.getByLabelText('6位验证码'), { target: { value: '654321' } })
    fireEvent.click(screen.getByRole('button', { name: '登录' }))

    await waitFor(() => expect(useStarStore.getState().loginOpen).toBe(false))
    expect(screen.queryByTestId('star-login-dialog')).toBeNull()
    expect(useStarStore.getState().status).toEqual(SIGNED_IN)
    expect(fetchProviders).toHaveBeenCalled()
    expect(useUIStore.getState().toasts.at(-1)?.message).toBe('已登录 STAR：小星')
  })
})
