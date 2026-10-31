import { act, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ModelPolicyProvider } from '@/lib/modelPolicy'
import { useStarBrandStore } from '@/stores/starBrandStore'
import { starUserName, useStarStore } from '@/stores/starStore'
import { StarLoginRequiredNotice } from './StarLoginRequiredNotice'
import { FIRST_TIP_AFTER_S, STAR_REPLY_TIPS, StarReplyTip } from './StarReplyTip'

// 「star需要跟随后台设置的名称来展示」: the STAR pages' own texts name the product
// the STAR console sets (StarStatus.brandName), STAR until it arrives.
describe('STAR texts follow the console brand name', () => {
  afterEach(() => {
    act(() => {
      useStarBrandStore.getState().setName('STAR')
      useStarStore.setState({ status: null })
    })
  })

  const notice = () => render(
    <ModelPolicyProvider value="star-only">
      <StarLoginRequiredNotice fallback={null} />
    </ModelPolicyProvider>,
  )

  it('asks to sign in to STAR by default and to the console name once it is known', () => {
    notice()
    expect(screen.getByRole('button', { name: '登录 STAR 账号' })).toBeTruthy()

    act(() => {
      useStarBrandStore.getState().setName('PRIVO')
    })
    expect(screen.getByRole('button', { name: '登录 PRIVO 账号' })).toBeTruthy()
    expect(screen.getByRole('alert').textContent).toContain('还没有登录 PRIVO 账号')
    expect(screen.getByRole('alert').textContent).not.toMatch(/\bSTAR\b/)
  })

  it('names an anonymous user after the product', () => {
    useStarBrandStore.getState().setName('PRIVO')
    expect(starUserName(null)).toBe('PRIVO 用户')
  })

  it('fills the name into the tips shown while a reply runs', () => {
    const random = vi.spyOn(Math, 'random').mockReturnValue(0.1)
    try {
      useStarStore.setState({ replyTipsEnabled: true })
      useStarBrandStore.getState().setName('PRIVO')
      render(<StarReplyTip elapsedSeconds={FIRST_TIP_AFTER_S} />)
      expect(screen.getByTestId('star-reply-tip').textContent).toBe('小技巧：输入 @ 可以引用项目里的文件，PRIVO 会先读它再回答')
      for (const tip of STAR_REPLY_TIPS) expect(tip).not.toMatch(/\bSTAR\b/)
    } finally {
      random.mockRestore()
    }
  })
})
