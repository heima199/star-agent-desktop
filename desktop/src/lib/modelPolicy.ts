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
