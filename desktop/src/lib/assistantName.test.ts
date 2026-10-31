import { describe, expect, it } from 'vitest'
import { ASSISTANT_FALLBACK_NAME, resolveAssistantName, type AssistantNameContext } from './assistantName'
import { getPermissionTitle } from '../components/chat/permissionPresentation'
import { translate } from '../i18n'
import type { SavedProvider } from '../types/provider'

const starProvider = {
  id: 'star-1',
  presetId: 'star-saas',
  name: 'STAR',
  models: { main: 'gpt-5.6', haiku: '', sonnet: '', opus: '' },
} as unknown as SavedProvider

const otherProvider = {
  id: 'other-1',
  presetId: 'custom',
  name: 'Mine',
  models: { main: 'my-model', haiku: '', sonnet: '', opus: '' },
} as unknown as SavedProvider

const starModels = [
  { id: 'gpt-5.6', name: 'GPT-5.6' },
  { id: 'deepseek-v4-pro', name: 'DeepSeek V4 Pro' },
]

function context(overrides: Partial<AssistantNameContext> = {}): AssistantNameContext {
  return {
    providers: [starProvider, otherProvider],
    activeId: 'star-1',
    activeProviderName: null,
    starModels,
    starOnly: true,
    ...overrides,
  }
}

describe('resolveAssistantName', () => {
  it("names the session's selected STAR model the way the picker does", () => {
    expect(resolveAssistantName(context({ selection: { providerId: 'star-1', modelId: 'deepseek-v4-pro' } })))
      .toBe('DeepSeek V4 Pro')
  })

  it("falls back to the default provider's main model when the session made no choice", () => {
    expect(resolveAssistantName(context())).toBe('GPT-5.6')
  })

  it('shows the bare model id, without the 1M tag, when the catalog does not know it', () => {
    expect(resolveAssistantName(context({ selection: { providerId: 'star-1', modelId: 'kimi-k2.5[1m]' } })))
      .toBe('kimi-k2.5')
  })

  it('uses a neutral name when the STAR app has no STAR model to name', () => {
    expect(resolveAssistantName(context({ selection: { providerId: 'other-1', modelId: 'my-model' } })))
      .toBe(ASSISTANT_FALLBACK_NAME)
    expect(resolveAssistantName(context({ providers: [], activeId: null }))).toBe(ASSISTANT_FALLBACK_NAME)
    expect(resolveAssistantName(context({ selection: { providerId: 'star-1', modelId: '  ' } }))).toBe(ASSISTANT_FALLBACK_NAME)
  })

  it('names any provider model outside star-only, from the provider catalog', () => {
    expect(resolveAssistantName(context({
      starOnly: false,
      selection: { providerId: null, modelId: 'claude-opus-4-8' },
      availableModels: [{ id: 'claude-opus-4-8', name: 'Opus 4.8' }],
    }))).toBe('Opus 4.8')
  })
})

describe('texts that name the assistant', () => {
  const t = (key: Parameters<typeof translate>[1], params?: Record<string, string | number>) => translate('zh', key, params)

  it('never falls back to "Claude" in a permission title', () => {
    expect(getPermissionTitle('Bash', { command: 'ls' }, t)).toBe(translate('zh', 'permission.allowBash', { actor: ASSISTANT_FALLBACK_NAME }))
    expect(getPermissionTitle('Bash', { command: 'ls' }, t, 'GPT-5.6')).toContain('GPT-5.6')
    expect(getPermissionTitle('Bash', { command: 'ls' }, t)).not.toContain('Claude')
  })

  it('puts the model into every chat text in all five locales', () => {
    for (const locale of ['en', 'zh', 'zh-TW', 'jp', 'kr'] as const) {
      for (const key of [
        'chat.placeholder',
        'chat.placeholderQuestionPending',
        'empty.heroSubtitle',
        'permission.planPreviewTitle',
        'question.needsInput',
        'question.chatRequested',
        'mobile.approval.questionTitle',
      ] as const) {
        const text = translate(locale, key, { model: 'GPT-5.6' })
        expect(text, `${locale} ${key}`).toContain('GPT-5.6')
        expect(text, `${locale} ${key}`).not.toContain('Claude')
      }
    }
  })

  it('describes settings and modes without naming Claude', () => {
    for (const locale of ['en', 'zh', 'zh-TW', 'jp', 'kr'] as const) {
      for (const key of [
        'settings.computerUse.description',
        'settings.computerUse.enableRiskScreen',
        'settings.general.outputStyleBuiltin.default.description',
        'permMode.autoModeDesc',
        'chat.capabilities.computerUseDescription',
        'settings.adapters.description',
      ] as const) {
        expect(translate(locale, key), `${locale} ${key}`).not.toContain('Claude')
      }
    }
  })
})
