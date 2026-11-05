/**
 * What a STAR image or video job will cost, before it is started.
 *
 * The catalog gives one base price per model, while the console charges an
 * image by the tier of its size and a video by its resolution and seconds.
 * The console's own estimate endpoints (`/image/credits`, `/video/credits`)
 * run the same rule as its charge, so they are asked first, with the job's
 * values resolved here exactly as the job will send them. Offline, the
 * console's rule with its default settings stands in (`exact: false`).
 */
import { starRequest } from './starClient.js'
import { readStarCatalog, refreshStarCatalog, type StarCatalog } from './starCatalog.js'
import {
  chargedImageTier,
  clampImageCount,
  imageTierCost,
  normalizeTier,
  pickDuration,
  pickImageModel,
  pickImageSize,
  pickResolution,
  pickVideoModel,
  videoCostAt,
  type StarVideoType,
} from './starMediaModels.js'
import { readStarSession } from './starSession.js'

export type StarImageEstimateInput = {
  model?: string
  ratio?: string
  resolution?: string
  count?: number
  /** Whether the job has reference images (picks among models that edit). */
  edit?: boolean
}

export type StarVideoEstimateInput = {
  model?: string
  type?: StarVideoType
  duration?: number
  resolution?: string
}

export type StarCreditEstimate = {
  /** Credits for the whole job; undefined when no price is known. */
  credits?: number
  /** True when the console priced it; false for the offline rule. */
  exact: boolean
  model?: string
  /** Image: the size sent and the tier it is charged at (lower than asked when the model draws no larger). */
  size?: string
  tier?: '1k' | '2k' | '4k'
  /** Video: the seconds and resolution the job will run at. */
  duration?: number
  resolution?: string
}

const CACHE_MS = 60_000
const cache = new Map<string, { at: number; credits: number }>()

/** `actual` from a console estimate, or undefined (no price, unknown model, unreachable). */
async function consoleCredits(apiPath: string): Promise<number | undefined> {
  const hit = cache.get(apiPath)
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.credits
  try {
    const payload = await starRequest<unknown>('GET', apiPath, {
      token: readStarSession()?.token,
      timeoutMs: 8_000,
      retryOnDisconnect: false,
    })
    const record = payload && typeof payload === 'object' ? payload as Record<string, unknown> : {}
    const body = record.data && typeof record.data === 'object' ? record.data as Record<string, unknown> : record
    const actual = Number(body.actual)
    // The console answers 0 for a model it cannot resolve.
    if (!Number.isFinite(actual) || actual <= 0) return undefined
    cache.set(apiPath, { at: Date.now(), credits: actual })
    return actual
  } catch {
    return undefined
  }
}

async function loadCatalog(): Promise<StarCatalog | null> {
  return readStarCatalog() ?? await refreshStarCatalog().catch(() => null)
}

export async function estimateStarImageCredits(input: StarImageEstimateInput, catalog?: StarCatalog | null): Promise<StarCreditEstimate> {
  const list = catalog === undefined ? await loadCatalog() : catalog
  const model = pickImageModel(list, input.model?.trim() || undefined, Boolean(input.edit), input.ratio)
  if (!model) return { exact: false }
  const count = clampImageCount(input.count)
  const size = pickImageSize(model, input.ratio, normalizeTier(input.resolution))
  const tier = chargedImageTier(size)
  const perImage = await consoleCredits(`/image/credits?model=${encodeURIComponent(model.id)}&size=${encodeURIComponent(size)}`)
  const fallback = imageTierCost(model, tier)
  const one = perImage ?? fallback
  return {
    ...(one !== undefined ? { credits: one * count } : {}),
    exact: perImage !== undefined,
    model: model.id,
    size,
    tier,
  }
}

export async function estimateStarVideoCredits(input: StarVideoEstimateInput, catalog?: StarCatalog | null): Promise<StarCreditEstimate> {
  const list = catalog === undefined ? await loadCatalog() : catalog
  const model = pickVideoModel(list, input.model?.trim() || undefined, input.type ?? 'txt2video', input.duration)
  if (!model) return { exact: false }
  const duration = pickDuration(model, input.duration)
  const resolution = pickResolution(model, input.resolution)
  const credits = await consoleCredits(
    `/video/credits?model=${encodeURIComponent(model.id)}&resolution=${encodeURIComponent(resolution)}&duration=${duration}`,
  )
  const fallback = videoCostAt(model, duration, resolution)
  const value = credits ?? fallback
  return {
    ...(value !== undefined ? { credits: value } : {}),
    exact: credits !== undefined,
    model: model.id,
    duration,
    resolution,
  }
}

/** For tests. */
export function clearStarEstimateCache(): void {
  cache.clear()
}
