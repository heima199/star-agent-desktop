import { describe, expect, it } from 'vitest'
import { translate } from '../i18n'
import type { TranslationKey } from '../i18n/locales/en'
import { deriveSessionTitle, sessionTitleLabel } from './sessionTitle'

describe('deriveSessionTitle', () => {
  it('uses slash command metadata without showing raw XML tags', () => {
    const raw = [
      '<command-message>frontend-design</command-message>',
      '<command-name>/frontend-design</command-name>',
      '<command-args>@website 重新设计首页</command-args>',
    ].join('\n')

    expect(deriveSessionTitle(raw)).toBe('/frontend-design @website 重新设计首页')
  })
})

describe('sessionTitleLabel', () => {
  const zh = (key: TranslationKey) => translate('zh', key)
  const en = (key: TranslationKey) => translate('en', key)

  it('shows the placeholder names of a session without a title in the interface language', () => {
    expect(sessionTitleLabel('Untitled Session', zh)).toBe('未命名会话')
    expect(sessionTitleLabel('New Session', zh)).toBe('新会话')
    expect(sessionTitleLabel('  Untitled Session ', zh)).toBe('未命名会话')
  })

  it('keeps the English placeholder names in the English interface', () => {
    expect(sessionTitleLabel('Untitled Session', en)).toBe('Untitled Session')
    expect(sessionTitleLabel('New Session', en)).toBe('New Session')
  })

  it('uses the text for an empty title, which the caller may choose', () => {
    expect(sessionTitleLabel('', zh)).toBe('未命名')
    expect(sessionTitleLabel(undefined, zh)).toBe('未命名')
    expect(sessionTitleLabel(null, zh, 'session.untitled')).toBe('未命名会话')
  })

  it('leaves a real title alone, also one that only contains a placeholder name', () => {
    expect(sessionTitleLabel('季度复盘', zh)).toBe('季度复盘')
    expect(sessionTitleLabel('New Session plan', zh)).toBe('New Session plan')
    expect(sessionTitleLabel('untitled session', zh)).toBe('untitled session')
  })
})
