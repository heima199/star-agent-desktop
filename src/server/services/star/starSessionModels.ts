/**
 * Session model choices for the STAR provider: every chat model in the
 * cached STAR catalog, after the provider's own slot models. Read from disk
 * only, so listing models never waits on the network.
 */

import type { SessionModelOption } from '../../../shared/sessionDelegation.js'
import { resolveModelReasoningProfile } from '../../../shared/modelReasoning.js'
import type { SavedProvider } from '../../types/provider.js'
import { readStarCatalog } from './starCatalog.js'
import { STAR_PRESET_ID } from './starConfig.js'

export function appendStarSessionModels(catalog: SessionModelOption[], providers: readonly SavedProvider[]): void {
  const starProviders = providers.filter(provider => provider.presetId === STAR_PRESET_ID)
  if (!starProviders.length) return
  const models = readStarCatalog()?.chat ?? []
  if (!models.length) return
  for (const provider of starProviders) {
    const providerName = catalog.find(item => item.providerId === provider.id)?.providerName ?? provider.name
    const known = new Set(catalog.filter(item => item.providerId === provider.id).map(item => item.modelId))
    for (const model of models) {
      if (known.has(model.id)) continue
      known.add(model.id)
      const profile = resolveModelReasoningProfile(model.id, provider.apiFormat)
      catalog.push({
        providerId: provider.id,
        providerName,
        modelId: model.id,
        modelName: model.name,
        supportedEfforts: [...(profile?.supportedReasoningEfforts ?? [])],
        ...(profile?.defaultReasoningEffort ? { defaultEffort: profile.defaultReasoningEffort } : {}),
        isProviderDefault: false,
        isDefault: false,
      })
    }
  }
}
