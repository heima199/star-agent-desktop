/**
 * The `star-only` model policy (config/modelPolicy.ts): the provider API keeps
 * reads, ordering, deletes and the STAR provider working, and refuses every
 * route that adds, imports, edits or switches to another model service.
 */
import { describe, test, expect, beforeEach, afterEach } from 'bun:test'
import * as fs from 'fs/promises'
import * as path from 'path'
import * as os from 'os'
import { ProviderService } from '../services/providerService.js'
import { handleProvidersApi } from '../api/providers.js'
import { getServerModelPolicy, MODEL_POLICY_ENV } from '../config/modelPolicy.js'
import { STAR_PRESET_ID } from '../services/star/starConfig.js'
import { diagnosticsService } from '../services/diagnosticsService.js'
import type { CreateProviderInput } from '../types/provider.js'

let tmpDir: string
const saved: Record<string, string | undefined> = {}

function setEnv(name: string, value: string | undefined) {
  if (!(name in saved)) saved[name] = process.env[name]
  if (value === undefined) delete process.env[name]
  else process.env[name] = value
}

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'provider-star-only-test-'))
  setEnv('CLAUDE_CONFIG_DIR', tmpDir)
  setEnv('HOME', tmpDir)
  setEnv(MODEL_POLICY_ENV, 'star-only')
})

afterEach(async () => {
  await diagnosticsService.drainForMigration()
  for (const [name, value] of Object.entries(saved)) {
    if (value === undefined) delete process.env[name]
    else process.env[name] = value
    delete saved[name]
  }
  await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => undefined)
})

function call(method: string, urlStr: string, body?: Record<string, unknown>) {
  const url = new URL(urlStr, 'http://localhost:3456')
  const init: RequestInit = { method }
  if (body) {
    init.headers = { 'Content-Type': 'application/json' }
    init.body = JSON.stringify(body)
  }
  return handleProvidersApi(new Request(url.toString(), init), url, url.pathname.split('/').filter(Boolean))
}

function customInput(overrides?: Partial<CreateProviderInput>): CreateProviderInput {
  return {
    presetId: 'custom',
    name: 'My own API',
    baseUrl: 'https://api.example.com',
    apiKey: 'sk-test-key-123',
    apiFormat: 'anthropic',
    models: { main: 'model-main', haiku: 'model-haiku', sonnet: 'model-sonnet', opus: 'model-opus' },
    ...overrides,
  }
}

describe('getServerModelPolicy', () => {
  test('reads star-only from the environment and defaults to any', () => {
    expect(getServerModelPolicy({ [MODEL_POLICY_ENV]: 'star-only' })).toBe('star-only')
    expect(getServerModelPolicy({ [MODEL_POLICY_ENV]: ' STAR-ONLY ' })).toBe('star-only')
    expect(getServerModelPolicy({ [MODEL_POLICY_ENV]: 'something-else' })).toBe('any')
    expect(getServerModelPolicy({})).toBe('any')
  })
})

describe('provider API under the star-only policy', () => {
  test('refuses adding, importing and reconfiguring other model services', async () => {
    const custom = await new ProviderService().addProvider(customInput())

    const refused = [
      await call('POST', '/api/providers', customInput() as unknown as Record<string, unknown>),
      await call('POST', '/api/providers/cc-switch/import', { sourceIds: ['claude:x'] }),
      await call('PUT', '/api/providers/settings', { env: { ANTHROPIC_BASE_URL: 'https://api.example.com' } }),
      await call('POST', '/api/providers/official'),
      await call('POST', '/api/providers/test', { baseUrl: 'https://api.example.com', apiKey: 'sk-x', modelId: 'm', apiFormat: 'anthropic' }),
      await call('POST', '/api/providers/models', { baseUrl: 'https://api.example.com', apiKey: 'sk-x' }),
      await call('PUT', `/api/providers/${custom.id}`, { name: 'Renamed' }),
      await call('POST', `/api/providers/${custom.id}/activate`),
      await call('POST', `/api/providers/${custom.id}/test`),
      await call('PUT', `/api/providers/${custom.id}/models`, { models: { main: 'x' } }),
    ]
    for (const response of refused) {
      expect(response.status).toBe(403)
      expect((await response.json()).error).toBe('FORBIDDEN')
    }

    const { providers, activeId } = await new ProviderService().listProviders()
    expect(providers.map(provider => provider.name)).toEqual(['My own API'])
    expect(activeId).not.toBe(custom.id)
  })

  test('keeps reads, ordering, deletes and the STAR provider working', async () => {
    const svc = new ProviderService()
    const star = await svc.addProvider(customInput({ presetId: STAR_PRESET_ID, name: 'STAR', apiFormat: 'openai_chat' }))
    const custom = await svc.addProvider(customInput())

    expect((await call('GET', '/api/providers')).status).toBe(200)
    expect((await call('GET', '/api/providers/presets')).status).toBe(200)
    expect((await call('PUT', '/api/providers/reorder', { orderedIds: [custom.id, star.id] })).status).toBe(200)

    const activated = await call('POST', `/api/providers/${star.id}/activate`)
    expect(activated.status).toBe(200)
    expect((await svc.listProviders()).activeId).toBe(star.id)

    expect((await call('DELETE', `/api/providers/${custom.id}`)).status).toBe(200)
    expect((await svc.listProviders()).providers.map(provider => provider.id)).toEqual([star.id])
  })

  test('without the policy the upstream routes are unchanged', async () => {
    setEnv(MODEL_POLICY_ENV, undefined)
    const created = await call('POST', '/api/providers', customInput() as unknown as Record<string, unknown>)
    expect(created.status).toBeLessThan(300)
    const { providers } = await new ProviderService().listProviders()
    expect(providers.map(provider => provider.name)).toEqual(['My own API'])
  })
})
