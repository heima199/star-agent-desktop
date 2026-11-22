import { createContext, useContext } from 'react'

/**
 * Which model services the UI offers.
 *
 * - `any`: every provider the runtime supports (official logins, saved API
 *   providers), the upstream behavior and the default for components rendered
 *   on their own.
 * - `star-only`: the STAR platform's own models only. The picker lists the
 *   STAR catalog, and every "configure a provider" path asks for the STAR
 *   sign-in instead; users cannot connect their own API.
 *
 * The STAR app sets `star-only` once at its root (App.tsx).
 */
export type ModelPolicy = 'any' | 'star-only'

export const STAR_APP_MODEL_POLICY: ModelPolicy = 'star-only'

const ModelPolicyContext = createContext<ModelPolicy>('any')

export const ModelPolicyProvider = ModelPolicyContext.Provider

export function useModelPolicy(): ModelPolicy {
  return useContext(ModelPolicyContext)
}

/** Saved providers made from this preset are STAR's own model service. */
export const STAR_PROVIDER_PRESET_ID = 'star-saas'

/**
 * Whether the policy offers models of this provider.
 *
 * Under `star-only` that is the STAR provider alone, which exists only once
 * somebody has signed in. Claude official is the `null` provider, so a missing
 * STAR provider must never be compared with it as an id: before sign-in the
 * policy offers nothing.
 */
export function policyOffersProvider(
  policy: ModelPolicy,
  providerId: string | null,
  starProviderId: string | null,
): boolean {
  return policy !== 'star-only' || (starProviderId !== null && providerId === starProviderId)
}
