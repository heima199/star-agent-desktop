import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

const seed = vi.hoisted(() => ({ seedStarComposer: vi.fn() }))
vi.mock('./starComposerSeed', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./starComposerSeed')>()),
  seedStarComposer: seed.seedStarComposer,
}))

import { useStarBrandStore } from '@/stores/starBrandStore'
import { findMarketSkill, runPluginAction } from '@/pages/star/market/marketActions'
import { MARKET_PLUGINS } from '@/pages/star/market/pluginCatalog'
import { marketSkillMarkdown } from '@/pages/star/market/skillCatalog'
import { matchStarPlugins } from '@/pages/star/StarPluginsPanel'
import { buildConversationMarkdown, buildTranscriptHtml, exportFileName, shareTitle, type ShareRound } from './share/conversationExport'
import { STAR_HERO_COPY } from './starHeroCopy'
import { starStudioTabTitle } from './starTabs'
import { StarCreateSentChip } from './StarCreateControl'
import { StarTaskTemplates } from './StarTaskTemplates'

// 「star需要跟随后台设置的名称来展示」（只替换品牌词）: the STAR surfaces that used
// to spell STAR out (catalog titles, export headers, hero copy, the 创作 tab)
// name the product the console sets, and STAR until it arrives.
describe('STAR surfaces follow the console brand name', () => {
  afterEach(() => {
    act(() => {
      useStarBrandStore.getState().setName('STAR')
    })
    seed.seedStarComposer.mockReset()
  })

  const setBrand = (name: string) => act(() => {
    useStarBrandStore.getState().setName(name)
  })

  it('names the studio tab and the new-session hero after the product', () => {
    expect(starStudioTabTitle()).toBe('STAR 创作')
    expect(STAR_HERO_COPY.work.title).toBe('Work with STAR')

    setBrand('PRIVO')
    expect(starStudioTabTitle()).toBe('PRIVO 创作')
    expect(STAR_HERO_COPY.work.title).toBe('Work with PRIVO')
    expect(STAR_HERO_COPY.design.title).toBe('Design with PRIVO')
    expect(STAR_HERO_COPY.design.subtitle).toContain('PRIVO 帮你生成')
  })

  it('heads a shared conversation with the product name', () => {
    setBrand('PRIVO')
    const rounds: ShareRound[] = [{ blocks: [
      { kind: 'user', id: 'u1', text: '画一只猫', attachments: [] },
      { kind: 'assistant', id: 'a1', markdown: '好的' },
    ] }]
    const markdown = buildConversationMarkdown({ title: '', rounds, generatedAt: new Date(2026, 9, 31, 8, 30) })
    expect(markdown).toContain('# PRIVO 对话')
    expect(markdown).toContain('> 由 PRIVO 生成 · ')
    expect(markdown).toContain('## PRIVO')
    expect(markdown).not.toMatch(/\bSTAR\b/)
    expect(shareTitle('  ')).toBe('PRIVO 对话')
    expect(exportFileName('', new Date(2026, 9, 31, 8, 30), 'md')).toBe('PRIVO 对话-20261031-0830.md')

    // The name is escaped in the transcript markup.
    setBrand('A&B')
    const html = buildTranscriptHtml({ prefix: 'p', title: 't', meta: 'm', footer: 'f', rounds, renderMarkdown: md => md, attachmentSlot: () => null })
    expect(html).toContain('<div class="p-brand">A&amp;B</div>')
    expect(html).toContain('<div class="p-label">A&amp;B</div>')
  })

  it('fills the name into plugin titles, prompts and skills', async () => {
    setBrand('PRIVO')
    expect(matchStarPlugins('').map(plugin => plugin.title)).toEqual(['PRIVO 绘图', 'PRIVO 视频', 'PRIVO 联网研究', 'PRIVO 文档与多模态', 'PRIVO 能力测试'])
    expect(matchStarPlugins('privo 绘图').map(plugin => plugin.name)).toEqual(['star-image'])
    // The placeholder itself is not searchable text.
    expect(matchStarPlugins('{brand}')).toEqual([])

    const imageGen = MARKET_PLUGINS.find(plugin => plugin.key === 'image-gen')!
    await runPluginAction(imageGen.action, imageGen.name)
    expect(seed.seedStarComposer).toHaveBeenCalledWith('用 PRIVO 绘图生成一张科技感产品主视觉海报，16:9')

    expect(marketSkillMarkdown(findMarketSkill('skill-finder')!)).toContain('在已安装技能与 PRIVO 技能市场中匹配')
  })

  it('shows and hands over the task templates with the name filled in', () => {
    setBrand('PRIVO')
    const onPick = vi.fn()
    render(<StarTaskTemplates onPick={onPick} />)
    const card = screen.getByTestId('star-task-template-daily-image')
    expect(card.textContent).toContain('用 PRIVO 文生图生成当天的社媒配图')
    fireEvent.click(card)
    expect(onPick.mock.calls[0]![0].prompt).toMatch(/^调用 PRIVO 文生图工具 mcp__plugin_star-image_star__star_text_to_image/)
    expect(onPick.mock.calls[0]![0].summary).not.toContain('{brand}')
  })

  it('labels a sent creation chip with the name and follows a change', () => {
    render(<StarCreateSentChip mode="text2image" />)
    expect(screen.getByTestId('star-create-sent-chip').textContent).toMatch(/^STAR · /)
    setBrand('PRIVO')
    expect(screen.getByTestId('star-create-sent-chip').textContent).toMatch(/^PRIVO · /)
  })
})
