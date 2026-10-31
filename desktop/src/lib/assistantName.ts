import { STAR_PROVIDER_PRESET_ID } from './modelPolicy'
import { resolveDefaultRuntimeSelection } from './runtimeSelection'
import type { SavedProvider } from '../types/provider'
import type { RuntimeSelection } from '../types/runtime'

/**
 * The name the UI gives the assistant when no model is known (signed out, a
 * provider that is not offered, no model yet). Language-neutral on purpose: it
 * reads the same in all five locales.
 */
export const ASSISTANT_FALLBACK_NAME = 'AI'

type NamedModel = { id: string; name: string }

export type AssistantNameContext = {
  /** The session's (or the draft's) own choice; absent means the default provider applies. */
  selection?: RuntimeSelection | null
  providers: readonly SavedProvider[]
  activeId: string | null
  activeProviderName: string | null
  currentModelId?: string
  /** The STAR account's chat catalog; the picker names STAR models from it. */
  starModels?: readonly NamedModel[]
  /** The active provider's models (official catalogs carry display names). */
  availableModels?: readonly NamedModel[]
  /** `star-only`: only a STAR model counts as known, as in the model picker. */
  starOnly?: boolean
}

function baseModelId(id: string): string {
  return id.trim().replace(/\[1m\]$/i, '').replace(/:1m$/i, '').trim()
}

function nameFrom(models: readonly NamedModel[] | undefined, modelId: string): string | undefined {
  if (!models?.length) return undefined
  const base = baseModelId(modelId)
  const hit = models.find(model => model.id === modelId) ?? models.find(model => baseModelId(model.id) === base)
  return hit?.name?.trim() || undefined
}

/**
 * The display name of the model that will answer — the same name the model
 * picker shows for the selection (STAR catalog name, then the provider's model
 * name, then the bare model id) — or {@link ASSISTANT_FALLBACK_NAME}.
 */
export function resolveAssistantName(context: AssistantNameContext): string {
  const selection = context.selection ?? resolveDefaultRuntimeSelection(
    context.activeId,
    context.activeProviderName,
    [...context.providers],
    context.currentModelId,
  )
  const modelId = selection.modelId?.trim()
  if (!modelId) return ASSISTANT_FALLBACK_NAME
  if (context.starOnly) {
    const starProviderId = context.providers.find(provider => provider.presetId === STAR_PROVIDER_PRESET_ID)?.id ?? null
    if (starProviderId === null || selection.providerId !== starProviderId) return ASSISTANT_FALLBACK_NAME
  }
  return nameFrom(context.starModels, modelId) ?? nameFrom(context.availableModels, modelId) ?? baseModelId(modelId)
}
