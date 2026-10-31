import { useMemo } from 'react'
import { resolveAssistantName } from '../lib/assistantName'
import { useModelPolicy } from '../lib/modelPolicy'
import { useProviderStore } from '../stores/providerStore'
import { useSessionRuntimeStore } from '../stores/sessionRuntimeStore'
import { useSettingsStore } from '../stores/settingsStore'
import { useStarStore } from '../stores/starStore'

/**
 * The display name of the model selected for a session (`runtimeKey` is the
 * session id, or `DRAFT_RUNTIME_SELECTION_KEY` for the new-session page), for
 * texts that name the assistant. Falls back to a neutral "AI".
 */
export function useAssistantName(runtimeKey?: string | null): string {
  const selection = useSessionRuntimeStore(state => (runtimeKey ? state.selections[runtimeKey] : undefined))
  const providers = useProviderStore(state => state.providers)
  const activeId = useProviderStore(state => state.activeId)
  const activeProviderName = useSettingsStore(state => state.activeProviderName)
  const currentModelId = useSettingsStore(state => state.currentModel?.id)
  const availableModels = useSettingsStore(state => state.availableModels)
  const starModels = useStarStore(state => state.catalog?.chat)
  const starOnly = useModelPolicy() === 'star-only'
  return useMemo(
    () => resolveAssistantName({
      selection,
      providers,
      activeId,
      activeProviderName,
      currentModelId,
      starModels,
      availableModels,
      starOnly,
    }),
    [selection, providers, activeId, activeProviderName, currentModelId, starModels, availableModels, starOnly],
  )
}
