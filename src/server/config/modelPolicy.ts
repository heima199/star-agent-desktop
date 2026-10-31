/**
 * Which model services clients of this server may configure.
 *
 * - `any` (default): the upstream behavior, every provider route works.
 * - `star-only`: models come from the STAR platform only. The STAR desktop app
 *   starts its sidecar with `CC_HAHA_MODEL_POLICY=star-only`. The STAR sign-in
 *   manages the `star-saas` provider itself (services/star/starAccountService),
 *   and the provider API refuses to add, import, edit or switch to any other
 *   model service. The desktop UI already hides those paths
 *   (desktop/src/lib/modelPolicy.ts); this check keeps H5 and other API clients
 *   from going around the UI.
 */
export type ServerModelPolicy = 'any' | 'star-only'

export const MODEL_POLICY_ENV = 'CC_HAHA_MODEL_POLICY'

export function getServerModelPolicy(env: NodeJS.ProcessEnv = process.env): ServerModelPolicy {
  return env[MODEL_POLICY_ENV]?.trim().toLowerCase() === 'star-only' ? 'star-only' : 'any'
}
