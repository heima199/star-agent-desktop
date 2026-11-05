import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import { useSettingsStore } from '../stores/settingsStore'
import { useStarBrandStore } from '../stores/starBrandStore'
import { loadLocale, translate, useTranslation } from '.'
import { en } from './locales/en'
import { zh } from './locales/zh'
import { zh as zhTW } from './locales/zh-TW'
import { jp } from './locales/jp'
import { kr } from './locales/kr'

// 「star需要跟随后台设置的名称来展示」（只替换品牌词）: texts name the product with
// {brand} / {brandAgent} / {brandCode}, filled from the name the STAR console sets.
describe('brand placeholders in translations', () => {
  // zh-TW, jp and kr load on demand (i18n/index.ts).
  beforeAll(async () => {
    await Promise.all((['zh-TW', 'jp', 'kr'] as const).map((locale) => loadLocale(locale)))
  })

  afterEach(() => {
    act(() => {
      useStarBrandStore.getState().setName('STAR')
      useSettingsStore.getState().setLocale('zh')
    })
  })

  it('shows STAR until the console name arrives', () => {
    expect(translate('en', 'ideLaunch.title')).toBe('Open this project in STAR Code')
    // No console name yet: "STAR WORK", never "STAR STAR WORK"
    expect(translate('zh', 'settings.mcp.scopeDesc.user')).toBe('写入你的全局 STAR WORK 配置，对所有项目生效。')
    expect(translate('zh', 'settings.about.community')).toBe('加入 STAR 交流群')
  })

  it('fills the console name into every brand placeholder', () => {
    useStarBrandStore.getState().setName('PRIVO')
    expect(translate('zh', 'ideLaunch.title')).toBe('在 PRIVO Code 中打开当前项目')
    expect(translate('en', 'empty.subtitle')).toContain('PRIVO STAR WORK is ready')
    expect(translate('zh', 'model.signInStar')).toBe('登录 PRIVO 使用模型')
    expect(translate('kr', 'settings.providers.ccSwitch.unavailableSchema')).not.toMatch(/\{brand/)
  })

  it('does not double a name that already ends with the product word', () => {
    useStarBrandStore.getState().setName('PRIVO Code')
    expect(translate('en', 'ideLaunch.openFailed')).toBe('Could not open PRIVO Code')
  })

  it('lets explicit params win over the injected name', () => {
    useStarBrandStore.getState().setName('PRIVO')
    expect(translate('en', 'ideLaunch.title', { brandCode: 'Other Code' })).toBe('Open this project in Other Code')
    expect(translate('en', 'ideLaunch.title', undefined, 'Acme')).toBe('Open this project in Acme Code')
    // Texts without a placeholder are untouched, params still interpolate.
    expect(translate('kr', 'session.timeMinutes', { n: 5 })).toBe('5분 전')
  })

  it('re-renders translated texts when the name changes', () => {
    act(() => {
      useSettingsStore.getState().setLocale('zh')
    })
    const { result } = renderHook(() => useTranslation())
    const initial = result.current
    expect(result.current('settings.about.community')).toBe('加入 STAR 交流群')

    act(() => {
      useStarBrandStore.getState().setName('PRIVO')
    })
    expect(result.current).not.toBe(initial)
    expect(result.current('settings.about.community')).toBe('加入 PRIVO 交流群')
  })

  it('leaves no standalone brand STAR in any locale text', () => {
    // Identifiers (STAR_…, star-saas) and markers such as STAR-DEBUG are not the brand.
    const brandWord = /(?<![A-Za-z0-9_\-./{])STAR(?![A-Za-z0-9_-])/
    for (const [name, strings] of Object.entries({ en, zh, 'zh-TW': zhTW, jp, kr })) {
      const offenders = Object.entries(strings as Record<string, string>)
        .filter(([, text]) => brandWord.test(text))
        .map(([key, text]) => `${key}: ${text}`)
      expect(offenders, `${name} still spells the brand out`).toEqual([])
    }
  })
})
