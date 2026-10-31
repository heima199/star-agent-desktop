import { describe, expect, it } from 'bun:test'
import { normalizeStarPromptCard } from '../services/star/starPromptLibrary.js'

const raw = {
  id: '0b6f3c1e-8f4a-4c2b-9d7e-5a1b2c3d4e5f',
  title: '  电流玻璃球交互组件  ',
  summary: '可拖动的玻璃球',
  coverUrl: 'https://cdn.example.test/cover.png',
  group: 'frontend',
  subcategory: 'fe-motion',
  siteName: 'React Bits',
  homepage: 'https://reactbits.example.test/glass',
  authorName: 'someone',
  tags: ['动效', 'React'],
  promptChars: 1200,
  excerpt: '做一个…',
  invokePath: '/chat',
}

describe('normalizeStarPromptCard', () => {
  it('keeps the card content', () => {
    expect(normalizeStarPromptCard(raw)).toEqual({
      id: raw.id,
      title: '电流玻璃球交互组件',
      summary: '可拖动的玻璃球',
      coverUrl: 'https://cdn.example.test/cover.png',
      group: 'frontend',
      subcategory: 'fe-motion',
      tags: ['动效', 'React'],
      promptChars: 1200,
      excerpt: '做一个…',
      invokePath: '/chat',
    })
  })

  // 模板提示词不允许查看来源: the origin never leaves the proxy.
  it('drops the source site, link and author', () => {
    const card = normalizeStarPromptCard(raw)
    expect(card).not.toBeNull()
    for (const field of ['siteName', 'homepage', 'authorName']) {
      expect(card).not.toHaveProperty(field)
    }
    expect(JSON.stringify(card)).not.toContain('reactbits')
    expect(JSON.stringify(card)).not.toContain('React Bits')
  })

  it('rejects an item without a valid id', () => {
    expect(normalizeStarPromptCard({ ...raw, id: 'not-a-uuid' })).toBeNull()
    expect(normalizeStarPromptCard(null)).toBeNull()
  })
})
