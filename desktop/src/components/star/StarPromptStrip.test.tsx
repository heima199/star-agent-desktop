import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import '@testing-library/jest-dom'

const api = vi.hoisted(() => ({
  promptStrip: vi.fn(),
  promptFacets: vi.fn(),
  promptList: vi.fn(),
  promptDetail: vi.fn(),
  markPromptUsed: vi.fn(),
}))

vi.mock('../../api/star', () => ({
  starApi: api,
  starErrorText: (error: unknown) => String(error),
}))

import { StarPromptLibraryDialog } from './StarPromptStrip'

const card = {
  id: '0b6f3c1e-8f4a-4c2b-9d7e-5a1b2c3d4e5f',
  title: '电流玻璃球交互组件',
  summary: '可拖动的玻璃球',
  coverUrl: 'https://cdn.example.test/cover.png',
  group: 'frontend' as const,
  subcategory: 'fe-motion',
  tags: ['动效'],
  promptChars: 12,
  excerpt: '做一个…',
  invokePath: '/chat' as const,
}

describe('StarPromptLibraryDialog', () => {
  beforeEach(() => {
    for (const mock of Object.values(api)) mock.mockReset()
    api.promptList.mockResolvedValue({ items: [card], total: 1, page: 1, pageSize: 24, hasMore: false })
    // Even if an old server still sent the source fields, nothing of them shows.
    api.promptDetail.mockResolvedValue({
      ...card,
      prompt: '做一个电流玻璃球',
      promptTruncated: false,
      meta: {},
      siteName: 'React Bits',
      homepage: 'https://reactbits.example.test/glass',
      authorName: 'someone',
    })
  })

  // 模板提示词不允许查看来源.
  it('shows a prompt without its source link, site or author', async () => {
    const onUse = vi.fn()
    render(<StarPromptLibraryDialog mode="code" initialItemId={card.id} facets={null} onClose={() => {}} onUse={onUse} />)

    const fill = await screen.findByRole('button', { name: '填入输入框' })
    expect(screen.getByRole('button', { name: '复制正文' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '查看来源' })).not.toBeInTheDocument()
    expect(screen.getByText('前端动效组件 · 8 字')).toBeInTheDocument()
    expect(document.body).not.toHaveTextContent('React Bits')
    expect(document.body).not.toHaveTextContent('someone')

    fireEvent.click(fill)
    expect(onUse).toHaveBeenCalledWith(expect.objectContaining({ prompt: '做一个电流玻璃球' }))
  })

  it('lists cards by category instead of by source site', async () => {
    render(<StarPromptLibraryDialog mode="code" initialItemId={null} facets={null} onClose={() => {}} onUse={() => {}} />)

    await waitFor(() => expect(screen.getByRole('button', { name: /电流玻璃球交互组件/ })).toBeInTheDocument())
    const tile = screen.getByRole('button', { name: /电流玻璃球交互组件/ })
    expect(tile).toHaveTextContent('前端动效组件')
    expect(screen.getByTestId('star-prompt-library')).not.toHaveTextContent(/SuperDesign|React Bits|YouMind|Revid/)
  })
})
