import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { NormalizedSkill } from '@/types/market'
import type { SessionListItem } from '@/types/session'
import type { SessionTurnCheckpoint } from '@/api/sessions'
import type { StarMediaTask } from '@/api/star'
import { ApiError } from '@/api/client'
import { AGENT_TEAMS_NOTICE_STORAGE_KEY, dismissAgentTeamsNotice, isAgentTeamsNoticeDismissed } from '@/lib/agentTeamsNotice'
import { resetProducedFilesCache } from '@/pages/star/files/producedFiles'
import { useMarketStore } from '@/stores/marketStore'
import { useSessionStore } from '@/stores/sessionStore'
import { useSettingsStore } from '@/stores/settingsStore'
import { useStarStore } from '@/stores/starStore'
import { MARKET_TAB_ID, STAR_PAGE_TAB_PREFIX, useTabStore } from '@/stores/tabStore'
import { useUIStore } from '@/stores/uiStore'
import { pickPopularSkills, resetPopularSkillsCache, useCapabilityMenu, type CapabilityMenuComposerHandlers } from './useCapabilityMenu'

const mocks = vi.hoisted(() => ({
  marketList: vi.fn(),
  marketInstall: vi.fn(),
  sessionsList: vi.fn(),
  turnCheckpoints: vi.fn(),
}))

vi.mock('@/api/agents', () => ({ agentsApi: { list: vi.fn().mockResolvedValue({ activeAgents: [], allAgents: [] }) } }))
vi.mock('@/api/connectors', () => ({ connectorsApi: { list: vi.fn().mockResolvedValue({ items: [] }) } }))
vi.mock('@/api/workflows', () => ({ workflowsApi: { list: vi.fn().mockResolvedValue({ workflows: [] }) } }))
vi.mock('@/api/computerUse', () => ({ computerUseApi: { getStatus: vi.fn().mockRejectedValue(new Error('off')), getAuthorizedApps: vi.fn() } }))
vi.mock('@/api/market', () => ({ marketApi: { list: mocks.marketList, install: mocks.marketInstall } }))
vi.mock('@/api/sessions', () => ({ sessionsApi: { list: mocks.sessionsList, getTurnCheckpoints: mocks.turnCheckpoints } }))
vi.mock('@/stores/skillStore', () => ({ useSkillStore: { getState: () => ({ fetchSkills: vi.fn().mockResolvedValue(undefined) }) } }))

function marketSkill(id: string, overrides: Partial<NormalizedSkill> = {}): NormalizedSkill {
  return {
    id,
    source: 'clawhub',
    slug: id,
    name: id,
    summary: `${id} summary`,
    author: { handle: 'someone' },
    stats: { downloads: 1 },
    tags: [],
    securityStatus: 'verified',
    installState: 'installable',
    ...overrides,
  }
}

function handlers(): CapabilityMenuComposerHandlers {
  return {
    onInsertMention: vi.fn(),
    onInsertSlashText: vi.fn(),
    onAttachment: vi.fn(),
    onSlashTrigger: vi.fn(),
    onSaveWorkflow: vi.fn(),
    onReferencesChanged: vi.fn(),
    onClose: vi.fn(),
  }
}

function renderMenu(composer = handlers()) {
  const view = renderHook(() => useCapabilityMenu({ open: true, cwd: '/repo', references: [], handlers: composer }))
  return { ...view, composer }
}

function skillChildKeys(result: { current: ReturnType<typeof useCapabilityMenu> }) {
  return result.current.sections[0]!.items.find(item => item.key === 'skills')!.children!.map(item => item.key)
}

beforeEach(() => {
  localStorage.removeItem(AGENT_TEAMS_NOTICE_STORAGE_KEY)
  resetPopularSkillsCache()
  resetProducedFilesCache()
  mocks.marketList.mockReset().mockResolvedValue({ items: [marketSkill('excalidraw'), marketSkill('pptx')], nextCursor: null, sources: {} })
  mocks.marketInstall.mockReset()
  mocks.sessionsList.mockReset().mockResolvedValue({ sessions: [], total: 0 })
  mocks.turnCheckpoints.mockReset().mockResolvedValue({ checkpoints: [] })
  useMarketStore.setState({ installingIds: new Set(), installError: null })
  useSettingsStore.setState({ agentTeamsEnabled: true, locale: 'en' })
  useUIStore.setState({ pendingMarketTarget: null, toasts: [] })
  useTabStore.setState({ tabs: [], activeTabId: null })
  useSessionStore.setState({ sessions: [] })
  useStarStore.setState({ tasks: [] })
})

afterEach(() => {
  vi.clearAllMocks()
})

describe('pickPopularSkills', () => {
  it('keeps installable, cleanly scanned skills that need no key, editor picks first', () => {
    const picked = pickPopularSkills([
      marketSkill('plain'),
      marketSkill('installed', { installState: 'installed' }),
      marketSkill('flagged', { securityStatus: 'flagged' }),
      marketSkill('unknown', { securityStatus: 'unknown' }),
      marketSkill('benign', { securityStatus: 'benign' }),
      marketSkill('needs-key', { requiresApiKey: true }),
      marketSkill('pick', { featured: true }),
    ])
    expect(picked.map(skill => skill.id)).toEqual(['pick', 'plain', 'benign'])
  })
})

describe('useCapabilityMenu', () => {
  it('opens the market at a connector and closes the menu', () => {
    const { result, composer } = renderMenu()
    act(() => result.current.onAction({ type: 'market', section: 'plugins', connectorId: 'github' }))
    expect(useUIStore.getState().pendingMarketTarget).toEqual({ section: 'plugins', connectorId: 'github' })
    expect(useTabStore.getState().activeTabId).toBe(MARKET_TAB_ID)
    expect(composer.onClose).toHaveBeenCalled()
  })

  it('reads the curated catalog once for every composer', async () => {
    const first = renderMenu()
    await waitFor(() => expect(skillChildKeys(first.result)).toContain('market-skill:excalidraw'))
    const second = renderMenu()
    await waitFor(() => expect(skillChildKeys(second.result)).toContain('market-skill:excalidraw'))
    expect(mocks.marketList).toHaveBeenCalledTimes(1)
    expect(mocks.marketList).toHaveBeenCalledWith({ scope: 'catalog', installed: 'installable', limit: 30 })
  })

  it('installs a suggested skill in place and reloads the mention list', async () => {
    mocks.marketInstall.mockResolvedValue({ ok: true, installedPath: '/skills/excalidraw', skill: marketSkill('excalidraw', { installState: 'installed' }) })
    const { result, composer } = renderMenu()
    await waitFor(() => expect(skillChildKeys(result)).toContain('market-skill:excalidraw'))

    await act(async () => {
      result.current.onAction({ type: 'installSkill', id: 'excalidraw', name: 'excalidraw' })
    })
    await waitFor(() => expect(composer.onReferencesChanged).toHaveBeenCalledTimes(1))
    expect(mocks.marketInstall).toHaveBeenCalledWith('excalidraw', undefined)
    expect(composer.onClose).not.toHaveBeenCalled()
    expect(skillChildKeys(result)).not.toContain('market-skill:excalidraw')
    expect(skillChildKeys(result)).toContain('market-skill:pptx')
    expect(useUIStore.getState().toasts.at(-1)).toMatchObject({ type: 'success' })

    // Another composer opened later does not offer the installed skill again.
    const later = renderMenu()
    await waitFor(() => expect(skillChildKeys(later.result)).toContain('market-skill:pptx'))
    expect(skillChildKeys(later.result)).not.toContain('market-skill:excalidraw')
  })

  it('keeps the suggestion and reports why when an install fails', async () => {
    mocks.marketInstall.mockRejectedValue(new Error('network down'))
    const { result, composer } = renderMenu()
    await waitFor(() => expect(skillChildKeys(result)).toContain('market-skill:excalidraw'))

    await act(async () => {
      result.current.onAction({ type: 'installSkill', id: 'excalidraw', name: 'excalidraw' })
    })
    await waitFor(() => expect(useUIStore.getState().toasts.at(-1)).toMatchObject({ type: 'error' }))
    expect(composer.onReferencesChanged).not.toHaveBeenCalled()
    expect(skillChildKeys(result)).toContain('market-skill:excalidraw')
  })

  it('asks before arming Agent Team, and arms only after the user confirms', () => {
    const { result, composer } = renderMenu()
    act(() => result.current.onAction({ type: 'toggleAgentTeam' }))
    expect(result.current.agentTeamArmed).toBe(false)
    expect(result.current.agentTeamsNotice.open).toBe(true)
    expect(composer.onClose).toHaveBeenCalled()

    act(() => result.current.agentTeamsNotice.onClose())
    expect(result.current.agentTeamsNotice.open).toBe(false)
    expect(result.current.agentTeamArmed).toBe(false)

    act(() => result.current.onAction({ type: 'toggleAgentTeam' }))
    act(() => result.current.agentTeamsNotice.onConfirm({ dontRemind: false }))
    expect(result.current.agentTeamsNotice.open).toBe(false)
    expect(result.current.agentTeamArmed).toBe(true)
    expect(isAgentTeamsNoticeDismissed()).toBe(false)

    // Turning it off never asks.
    act(() => result.current.onAction({ type: 'toggleAgentTeam' }))
    expect(result.current.agentTeamArmed).toBe(false)
    expect(result.current.agentTeamsNotice.open).toBe(false)
  })

  it('stops asking once the user chose not to be reminded', () => {
    const first = renderMenu()
    act(() => first.result.current.onAction({ type: 'toggleAgentTeam' }))
    act(() => first.result.current.agentTeamsNotice.onConfirm({ dontRemind: true }))
    expect(first.result.current.agentTeamArmed).toBe(true)
    first.unmount()

    const second = renderMenu()
    act(() => second.result.current.onAction({ type: 'toggleAgentTeam' }))
    expect(second.result.current.agentTeamsNotice.open).toBe(false)
    expect(second.result.current.agentTeamArmed).toBe(true)
  })

  it('arms Agent Team until disarmed, and never while Settings turns it off', () => {
    dismissAgentTeamsNotice()
    const { result, rerender } = renderMenu()
    act(() => result.current.onAction({ type: 'toggleAgentTeam' }))
    expect(result.current.agentTeamArmed).toBe(true)
    act(() => result.current.disarmAgentTeam())
    expect(result.current.agentTeamArmed).toBe(false)

    act(() => result.current.onAction({ type: 'toggleAgentTeam' }))
    act(() => useSettingsStore.setState({ agentTeamsEnabled: false }))
    rerender()
    expect(result.current.agentTeamArmed).toBe(false)
    expect(result.current.sections[1]!.items[0]!.action).toEqual({ type: 'settings', tab: 'general' })
  })
})

it('lean exposes only file attachment and local commands, including after a standard menu', async () => {
  const composer = handlers()
  const { result, rerender } = renderHook(({ lean }) => useCapabilityMenu({ open: true, lean, cwd: '/repo', references: [], handlers: composer }), { initialProps: { lean: false } })
  await waitFor(() => expect(mocks.marketList).toHaveBeenCalled())
  rerender({ lean: true })
  const rows = result.current.sections.flatMap(section => section.items)
  // 我的文件 puts file pills in the draft: the lean counterpart of attaching a file.
  expect(rows.map(item => item.key)).toEqual(['add-files', 'my-files', 'slash-commands'])
  expect(rows.map(item => item.action?.type)).toEqual(['attachment', undefined, 'slashTrigger'])
  expect(result.current.sections.flatMap(section => section.searchOnly ?? [])).toEqual([])
  act(() => result.current.onAction({ type: 'toggleAgentTeam' }))
  expect(result.current.agentTeamArmed).toBe(false)
  act(() => result.current.onAction({ type: 'insertSlashText', command: 'agent forbidden' }))
  expect(composer.onInsertSlashText).not.toHaveBeenCalled()
})

it('keeps explicit installed skills in lean while blocking plugin mentions', () => {
  const composer = handlers()
  const skill = { id: 'review', name: 'review', displayName: 'Review', source: 'user', modelText: '/review', description: 'Review code', kind: 'skill' as const }
  const plugin = { id: 'browser', name: 'browser', displayName: 'Browser', source: 'plugin', modelText: '/browser', description: 'Browser', kind: 'plugin' as const }
  const { result } = renderHook(() => useCapabilityMenu({ open: true, lean: true, cwd: '/repo', references: [skill, plugin], handlers: composer }))
  expect(result.current.sections.flatMap(section => section.items).find(item => item.key === 'skills')?.children?.find(item => item.key === 'skills:all')?.children).toEqual([
    expect.objectContaining({ action: { type: 'insertMention', reference: skill } }),
  ])
  act(() => result.current.onAction({ type: 'insertMention', reference: skill }))
  expect(composer.onInsertMention).toHaveBeenCalledWith(skill)
  act(() => result.current.onAction({ type: 'insertMention', reference: plugin }))
  expect(composer.onInsertMention).toHaveBeenCalledTimes(1)
})

describe('the Agent mode row', () => {
  const runItems = (result: { current: ReturnType<typeof useCapabilityMenu> }) =>
    result.current.sections.flatMap(section => section.items).map(item => item.key)

  it('changes a draft to lean through the row, and drops an armed Agent Team with a notice', () => {
    dismissAgentTeamsNotice()
    const onChange = vi.fn()
    const { result } = renderHook(() => useCapabilityMenu({
      open: true, cwd: '/repo', references: [], handlers: handlers(), agentProfile: { value: 'standard', onChange },
    }))
    act(() => result.current.onAction({ type: 'toggleAgentTeam' }))
    expect(result.current.agentTeamArmed).toBe(true)

    act(() => result.current.onAction({ type: 'setAgentProfile', profile: 'lean' }))
    expect(onChange).toHaveBeenCalledWith('lean')
    expect(result.current.agentTeamArmed).toBe(false)
    expect(useUIStore.getState().toasts.some(toast => toast.message.includes('Agent Teams'))).toBe(true)
  })

  it('does not announce anything for a switch that dropped nothing, nor re-pick the current mode', () => {
    const onChange = vi.fn()
    const { result } = renderHook(() => useCapabilityMenu({
      open: true, cwd: '/repo', references: [], handlers: handlers(), agentProfile: { value: 'standard', onChange },
    }))
    act(() => result.current.onAction({ type: 'setAgentProfile', profile: 'standard' }))
    expect(onChange).not.toHaveBeenCalled()
    act(() => result.current.onAction({ type: 'setAgentProfile', profile: 'lean' }))
    expect(onChange).toHaveBeenCalledTimes(1)
    expect(useUIStore.getState().toasts).toEqual([])
  })

  it('shows a locked row that ignores a change, whichever way the action arrives', () => {
    const { result } = renderHook(() => useCapabilityMenu({
      open: true, lean: true, cwd: '/repo', references: [], handlers: handlers(), agentProfile: { value: 'lean' },
    }))
    const row = result.current.sections.flatMap(section => section.items).find(item => item.key === 'agent-profile')!
    expect(row.choice).toMatchObject({ value: 'lean', locked: true })
    expect(() => act(() => result.current.onAction({ type: 'setAgentProfile', profile: 'standard' }))).not.toThrow()
  })

  it('keeps the row in a lean menu while everything lean cannot run leaves it', () => {
    const { result } = renderHook(() => useCapabilityMenu({
      open: true, lean: true, cwd: '/repo', references: [], handlers: handlers(), agentProfile: { value: 'lean', onChange: vi.fn() },
    }))
    const items = runItems(result)
    expect(items).toContain('agent-profile')
    expect(items).toContain('add-files')
    expect(items).toContain('slash-commands')
    for (const gone of ['agent-team', 'computer-use', 'connectors', 'agents', 'workflows']) expect(items).not.toContain(gone)
  })

  it('has no row when the composer offers none', () => {
    const { result } = renderMenu()
    expect(runItems(result)).not.toContain('agent-profile')
  })
})

describe('the 我的文件 row', () => {
  const myFiles = (result: { current: ReturnType<typeof useCapabilityMenu> }) =>
    result.current.sections.flatMap(section => section.items).find(item => item.key === 'my-files')

  function listedSession(id: string, title: string, modifiedAt: string): SessionListItem {
    return { id, title, createdAt: modifiedAt, modifiedAt, messageCount: 4, projectPath: 'C:\\work\\site', workDir: 'C:\\work\\site', workDirExists: true }
  }

  function checkpoint(startedAt: number, filesChanged: string[]): SessionTurnCheckpoint {
    return {
      target: { targetUserMessageId: `turn-${startedAt}`, userMessageIndex: 0, userMessageCount: 1 },
      code: { available: true, filesChanged, insertions: 1, deletions: 0 },
      startedAt,
    }
  }

  function starTask(overrides: Partial<StarMediaTask>): StarMediaTask {
    return {
      id: 'task-1', kind: 'image', mode: 'text2image', model: 'model', prompt: 'A red poster', params: {},
      references: { images: [], videos: [] }, status: 'succeeded', progress: 100, message: '', outputs: [],
      source: 'agent', createdAt: 0, updatedAt: 0, ...overrides,
    }
  }

  it('lists what recent conversations produced, newest first, as file pills to insert', async () => {
    useSessionStore.setState({ sessions: [
      listedSession('site', 'Landing page', '2026-05-02T10:00:00.000Z'),
      listedSession('huge', 'Huge session', '2026-05-02T09:00:00.000Z'),
    ] })
    mocks.turnCheckpoints.mockImplementation(async (sessionId: string) => {
      // Too large to read: skipped, the other conversations still list.
      if (sessionId === 'huge') throw new ApiError(413, { message: 'Workspace transcript exceeds the viewing budget' })
      return { checkpoints: [
        // Code and the agent's own notes are no deliverables.
        checkpoint(1_000, ['C:\\work\\site\\index.html', 'C:\\work\\site\\app.ts', 'C:\\work\\site\\.claude\\notes.md']),
        // The page written again, spelled another way: one entry at the later time.
        checkpoint(3_000, ['/C:/work/site/index.html', 'C:\\work\\site\\report.pdf']),
      ] }
    })
    useStarStore.setState({ tasks: [starTask({ sessionId: 'site', createdAt: 2_000, outputs: [
      { kind: 'image', url: 'https://cdn.example.test/a.png', file: 'C:\\work\\site\\star-outputs\\poster.png', name: 'poster.png' },
      // Kept online only: no local file to list.
      { kind: 'image', url: 'https://cdn.example.test/b.png', name: 'remote.png' },
    ] })] })

    const { result } = renderMenu()
    await waitFor(() => expect(myFiles(result)?.children?.map(child => child.label)).toEqual(['index.html', 'report.pdf', 'poster.png', 'View all files']))
    const [page] = myFiles(result)!.children!
    expect(page).toMatchObject({
      description: 'Landing page',
      action: { type: 'insertFileMention', mention: { label: 'index.html', path: 'C:/work/site/index.html', isDirectory: false } },
    })
    expect(mocks.turnCheckpoints).toHaveBeenCalledWith('huge', expect.anything())

    // A second composer opening right after reuses the list.
    const calls = mocks.turnCheckpoints.mock.calls.length
    const second = renderMenu()
    expect(myFiles(second.result)?.children?.map(child => child.label)).toContain('poster.png')
    await waitFor(() => expect(myFiles(second.result)?.children).toHaveLength(4))
    expect(mocks.turnCheckpoints).toHaveBeenCalledTimes(calls)
  })

  it('stays in a lean menu, and opens the 我的文件 page from its last row', async () => {
    const composer = handlers()
    const { result } = renderHook(() => useCapabilityMenu({ open: true, lean: true, cwd: '/repo', references: [], handlers: composer }))
    await waitFor(() => expect(myFiles(result)?.children?.map(child => child.key)).toEqual(['my-files:empty', 'my-files:all']))

    // File rows are the menu's to hand to the composer; the hook runs nothing for them.
    act(() => result.current.onAction({ type: 'insertFileMention', mention: { label: 'a.md', path: '/a.md', isDirectory: false } }))
    expect(composer.onClose).not.toHaveBeenCalled()

    act(() => result.current.onAction({ type: 'openMyFiles' }))
    expect(useTabStore.getState().activeTabId).toBe(`${STAR_PAGE_TAB_PREFIX}files`)
    expect(composer.onClose).toHaveBeenCalled()
  })
})
