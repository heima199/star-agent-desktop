import { CORE_ID, RINGS, hashString, random, type GraphLayer, type GraphModel, type GraphNode } from './memoryGraphModel'

/**
 * Layout of the 记忆星云 (memory nebula): the graph's nodes drawn as soft
 * clouds of drifting dust instead of rings.
 *
 * Nodes gather by what they are, not by project: one cloud per memory type,
 * one for the conversations, and the MEMORY.md indexes as a halo round the
 * core. Inside a cloud the most important node sits at the heart and burns
 * brightest; the rest spiral out from it.
 *
 * Pure: no canvas and no clock. Positions are world units in the same space
 * the graph uses and fit inside the graph's extent, so one view transform and
 * one "fit" serve both forms. Particle motion is a function of time, so the
 * renderer only has to ask where each grain is now.
 */

export type NebulaGroupKey = 'index' | 'user' | 'feedback' | 'project' | 'reference' | 'other' | 'session'

/** Colour slot of a cloud; `NEBULA_TONE_TOKENS[tone]` is the token it is read from. */
export type NebulaTone = 0 | 1 | 2 | 3 | 4 | 5 | 6

/**
 * The theme tokens the clouds are tinted with: the ink for the core and the
 * indexes, the categorical series for the memory types, the neutral series
 * slot for conversations, and the secondary ink for untyped memories.
 */
export const NEBULA_TONE_TOKENS = [
  '--color-text-primary',
  '--color-series-1',
  '--color-series-2',
  '--color-series-3',
  '--color-series-4',
  '--color-series-5',
  '--color-text-secondary',
] as const

export type NebulaGroupSpec = { key: NebulaGroupKey; label: string; layer: GraphLayer; tone: NebulaTone }

/** Every cloud the nebula can have, in the order they go round the core. */
export const NEBULA_GROUPS: readonly NebulaGroupSpec[] = [
  { key: 'index', label: '索引', layer: 'L3', tone: 0 },
  { key: 'user', label: '用户', layer: 'L2', tone: 1 },
  { key: 'feedback', label: '反馈', layer: 'L2', tone: 2 },
  { key: 'project', label: '项目', layer: 'L2', tone: 3 },
  { key: 'reference', label: '参考', layer: 'L2', tone: 4 },
  { key: 'other', label: '未分类', layer: 'L2', tone: 6 },
  { key: 'session', label: '会话', layer: 'L1', tone: 5 },
]

export type NebulaGroup = NebulaGroupSpec & {
  count: number
  /** Centre of the cloud; the index halo is centred on the core. */
  x: number
  y: number
  /** Outer world radius of the cloud. */
  radius: number
  /** Inner radius of the index halo; 0 for a cloud. */
  inner: number
}

export type NebulaStar = {
  node: GraphNode
  /** Index into `groups`; -1 for the core. */
  group: number
  tone: NebulaTone
  /** The layer toggle that hides it; null for the core, which never hides. */
  layer: GraphLayer | null
  x: number
  y: number
  /** 0..1: how bright and how large the star is drawn. */
  importance: number
  /** World radius of the star's bright core. */
  size: number
}

export type NebulaLink = { from: number; to: number; strength: number }

export type NebulaLayout = {
  groups: NebulaGroup[]
  /** The core first, then every other node, grouped by cloud. */
  stars: NebulaStar[]
  /** Graph node id → index into `stars`. */
  starIndex: Map<string, number>
  links: NebulaLink[]
  /** World radius that holds everything, labels included. */
  extent: number
}

/** World radius the whole nebula is scaled to: the graph's outer ring. */
export const NEBULA_RADIUS = RINGS.L1.outer
export const MAX_NEBULA_LINKS = 2400
export const CORE_STAR_SIZE = 9

const TAU = Math.PI * 2
const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5))
const CLOUD_GAP = 28
const HALO_CLEARANCE = 36
const DAY_MS = 86_400_000
const RECENT_DAYS = 30

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value))

export function nebulaGroupOf(node: GraphNode): NebulaGroupKey | null {
  if (node.kind === 'core') return null
  if (node.kind === 'index') return 'index'
  if (node.kind === 'session') return 'session'
  const type = node.memory?.type
  return type === 'user' || type === 'feedback' || type === 'project' || type === 'reference' ? type : 'other'
}

/** The newest memory's timestamp: "recent" is measured against the data, not the clock. */
export function newestMemoryTime(model: GraphModel): number {
  let newest = 0
  for (const node of model.nodes) {
    const time = node.memory ? Date.parse(node.memory.updatedAt) : Number.NaN
    if (Number.isFinite(time) && time > newest) newest = time
  }
  return newest
}

function linked(model: GraphModel, ids: string[] | undefined, kind: GraphNode['kind']): number {
  let count = 0
  for (const id of ids ?? []) if (model.byId.get(id)?.kind === kind) count += 1
  return count
}

/**
 * How much a node matters, 0..1. The core is the synthesis of everything; an
 * index matters by how much it lists; a memory by being indexed, by the
 * conversations that wrote it and by how fresh it is; a conversation by its
 * length and by whether it left a memory behind.
 */
export function nodeImportance(node: GraphNode, model: GraphModel, newest = newestMemoryTime(model)): number {
  if (node.kind === 'core') return 1
  if (node.kind === 'index') {
    if (node.shape === 'ring') return 0.3
    return clamp(0.62 + 0.06 * Math.sqrt(model.outward.get(node.id)?.length ?? 0), 0, 0.9)
  }
  if (node.kind === 'memory') {
    const memory = node.memory
    const updated = memory ? Date.parse(memory.updatedAt) : Number.NaN
    const age = newest > 0 && Number.isFinite(updated) ? (newest - updated) / DAY_MS : Number.POSITIVE_INFINITY
    const fresh = clamp(1 - age / RECENT_DAYS, 0, 1)
    return clamp(
      0.34
        + (memory?.indexed ? 0.14 : 0)
        + Math.min(0.2, 0.1 * linked(model, model.outward.get(node.id), 'session'))
        + (memory?.description ? 0.04 : 0)
        + 0.18 * fresh,
      0,
      1,
    )
  }
  const messages = node.session?.messageCount ?? 0
  return clamp(0.1 + Math.min(0.24, Math.log2(1 + messages) * 0.03) + (linked(model, model.inward.get(node.id), 'memory') ? 0.18 : 0), 0, 1)
}

export function starSize(importance: number): number {
  return 0.8 + Math.pow(clamp(importance, 0, 1), 1.3) * 5.2
}

/** Clouds grow with the square root of what they hold, so one big type cannot swallow the field. */
function cloudRadius(key: NebulaGroupKey, count: number): number {
  return key === 'session' ? clamp(48 + 10 * Math.sqrt(count), 60, 200) : clamp(34 + 15 * Math.sqrt(count), 46, 170)
}

/** Smallest angle between two directions, 0..π. */
function angleBetween(a: number, b: number): number {
  const turn = Math.abs(a - b) % TAU
  return turn > Math.PI ? TAU - turn : turn
}

type Member = { node: GraphNode; importance: number }

export function buildNebulaLayout(model: GraphModel): NebulaLayout {
  const newest = newestMemoryTime(model)
  const members = new Map<NebulaGroupKey, Member[]>()
  let core: GraphNode | undefined
  for (const node of model.nodes) {
    const key = nebulaGroupOf(node)
    if (!key) {
      core = node
      continue
    }
    const list = members.get(key) ?? []
    list.push({ node, importance: nodeImportance(node, model, newest) })
    members.set(key, list)
  }
  // The brightest member takes the heart of its cloud; ids break ties so the order is stable.
  for (const list of members.values()) {
    list.sort((a, b) => b.importance - a.importance || (a.node.id < b.node.id ? -1 : a.node.id > b.node.id ? 1 : 0))
  }

  const present = NEBULA_GROUPS.filter((spec) => (members.get(spec.key)?.length ?? 0) > 0)
  const indexCount = members.get('index')?.length ?? 0
  const haloInner = RINGS.core + 24
  const haloOuter = indexCount ? clamp(haloInner + 34 + 8 * Math.sqrt(indexCount), 110, 172) : haloInner
  const orbiting = present
    .filter((spec) => spec.key !== 'index')
    .map((spec) => ({ spec, count: members.get(spec.key)!.length, radius: cloudRadius(spec.key, members.get(spec.key)!.length) }))

  // Each cloud gets a share of the circle as wide as it is, the first centred at the top.
  const widths = orbiting.map((item) => item.radius * 2 + CLOUD_GAP)
  const totalWidth = widths.reduce((sum, width) => sum + width, 0) || 1
  const spans = widths.map((width) => (width / totalWidth) * TAU)
  const angles: number[] = []
  let cursor = -Math.PI / 2 - (spans[0] ?? 0) / 2
  for (const span of spans) {
    angles.push(cursor + span / 2)
    cursor += span
  }
  // Far enough out to clear the index halo, and for no two clouds to touch.
  let orbit = haloOuter + HALO_CLEARANCE + Math.max(0, ...orbiting.map((item) => item.radius))
  for (let a = 0; a < orbiting.length; a += 1) {
    for (let b = a + 1; b < orbiting.length; b += 1) {
      const chord = 2 * Math.sin(angleBetween(angles[a]!, angles[b]!) / 2)
      if (chord > 1e-6) orbit = Math.max(orbit, (orbiting[a]!.radius + orbiting[b]!.radius + CLOUD_GAP) / chord)
    }
  }
  const outer = Math.max(haloOuter, ...orbiting.map((item) => orbit + item.radius))
  // Scaled to the graph's outer ring, so both forms fill the same view.
  const scale = clamp(NEBULA_RADIUS / outer, 0.3, 1.5)

  const groups: NebulaGroup[] = present.map((spec) => {
    const count = members.get(spec.key)!.length
    if (spec.key === 'index') return { ...spec, count, x: 0, y: 0, radius: haloOuter * scale, inner: haloInner * scale }
    const at = orbiting.findIndex((item) => item.spec.key === spec.key)
    const angle = angles[at]!
    return { ...spec, count, x: Math.cos(angle) * orbit * scale, y: Math.sin(angle) * orbit * scale, radius: orbiting[at]!.radius * scale, inner: 0 }
  })

  const stars: NebulaStar[] = []
  if (core) stars.push({ node: core, group: -1, tone: 0, layer: null, x: 0, y: 0, importance: 1, size: CORE_STAR_SIZE })
  groups.forEach((group, groupIndex) => {
    const list = members.get(group.key)!
    const seed = hashString(`nebula:${group.key}`)
    list.forEach(({ node, importance }, rank) => {
      const [x, y] = group.key === 'index' ? haloSpot(group, rank, list.length, seed) : cloudSpot(group, rank, list.length, seed)
      stars.push({ node, group: groupIndex, tone: group.tone, layer: group.layer, x, y, importance, size: starSize(importance) })
    })
  })

  const starIndex = new Map(stars.map((star, index) => [star.node.id, index]))
  const links: NebulaLink[] = []
  for (const edge of model.edges) {
    const from = starIndex.get(edge.from)
    const to = starIndex.get(edge.to)
    if (from !== undefined && to !== undefined) links.push({ from, to, strength: edge.strength })
  }
  // A field this dense only needs its strongest threads; the sort is stable, so the cut is too.
  const kept = links.length > MAX_NEBULA_LINKS ? [...links].sort((a, b) => b.strength - a.strength).slice(0, MAX_NEBULA_LINKS) : links

  return { groups, stars, starIndex, links: kept, extent: Math.max(model.extent, outer * scale + 70) }
}

/** Vogel's sunflower over the cloud's disc: rank 0 at the centre, later ranks spiralling out. */
function cloudSpot(group: NebulaGroup, rank: number, count: number, seed: number): [number, number] {
  const base = group.radius * 0.8 * Math.sqrt(rank / Math.max(1, count))
  const jitter = rank ? (random(seed + rank * 7919) - 0.5) * group.radius * 0.12 : 0
  const radius = clamp(base + jitter, 0, group.radius * 0.88)
  const angle = random(seed) * TAU + rank * GOLDEN_ANGLE + (random(seed + rank * 104729) - 0.5) * 0.4
  return [group.x + Math.cos(angle) * radius, group.y + Math.sin(angle) * radius]
}

/** Indexes ring the core evenly, the most important at the top. */
function haloSpot(group: NebulaGroup, rank: number, count: number, seed: number): [number, number] {
  const step = TAU / count
  const angle = -Math.PI / 2 + rank * step + (random(seed + rank * 7919) - 0.5) * step * 0.4
  const radius = group.inner + (group.radius - group.inner) * (0.3 + random(seed + rank * 104729) * 0.45)
  return [Math.cos(angle) * radius, Math.sin(angle) * radius]
}

// ─── Particles ───────────────────────────────────────────────────────

/** Struct of arrays: thousands of grains, no per-grain objects. */
export type NebulaParticles = {
  count: number
  /** What each grain circles: a cloud's centre, a star, or the core. */
  anchorX: Float32Array
  anchorY: Float32Array
  orbit: Float32Array
  angle: Float32Array
  /** Radians per second. */
  speed: Float32Array
  /** Amplitude of the slow in-and-out breath, in world units. */
  wobble: Float32Array
  phase: Float32Array
  /** Side of the grain in CSS pixels at 100% zoom. */
  size: Float32Array
  alpha: Float32Array
  tone: Uint8Array
  /** `PARTICLE_LAYERS[layer]` is the toggle that hides the grain; 0 never hides. */
  layer: Uint8Array
  /** The star a grain swarms round, -1 for cloud and field dust. */
  star: Int32Array
}

export const PARTICLE_LAYERS: ReadonlyArray<GraphLayer | null> = [null, 'L3', 'L2', 'L1']

const layerCode = (layer: GraphLayer | null) => (layer ? PARTICLE_LAYERS.indexOf(layer) : 0)

function allocate(count: number): NebulaParticles {
  return {
    count,
    anchorX: new Float32Array(count),
    anchorY: new Float32Array(count),
    orbit: new Float32Array(count),
    angle: new Float32Array(count),
    speed: new Float32Array(count),
    wobble: new Float32Array(count),
    phase: new Float32Array(count),
    size: new Float32Array(count),
    alpha: new Float32Array(count),
    tone: new Uint8Array(count),
    layer: new Uint8Array(count),
    star: new Int32Array(count).fill(-1),
  }
}

/** A stable 0..1 per (grain, purpose). */
function grain(index: number, purpose: number): number {
  return random((Math.imul(index + 1, 0x9e3779b1) ^ Math.imul(purpose + 1, 0x85ebca6b)) >>> 0)
}

/** A stable standard-normal value per (grain, purpose), Box–Muller. */
function gauss(index: number, purpose: number): number {
  return Math.sqrt(-2 * Math.log(1 - grain(index, purpose))) * Math.cos(TAU * grain(index, purpose + 1))
}

/** Index of the weight `u` (0..1) lands on. */
function pick(cumulative: number[], u: number): number {
  const target = u * (cumulative[cumulative.length - 1] ?? 0)
  let low = 0
  let high = cumulative.length - 1
  while (low < high) {
    const middle = (low + high) >> 1
    if (cumulative[middle]! > target) high = middle
    else low = middle + 1
  }
  return low
}

function cumulate(weights: number[]): number[] {
  let sum = 0
  return weights.map((weight) => (sum += weight))
}

/**
 * Seeds `count` grains over a layout: a faint field over everything, a
 * corona round the core, swarms round the brightest stars and the soft
 * clouds themselves. Deterministic, so a resize reseeds to the same sky.
 */
export function seedNebulaParticles(layout: NebulaLayout | null, count: number): NebulaParticles {
  const total = Math.max(0, Math.floor(count))
  const p = allocate(total)
  const groups = layout?.groups ?? []
  const stars = layout?.stars ?? []
  const swarmed = stars.flatMap((star, index) => (star.group >= 0 ? [index] : []))
  const field = (layout ? layout.extent - 70 : NEBULA_RADIUS) * 1.02
  const ambient = Math.round(total * (groups.length ? 0.07 : 0.45))
  const corona = groups.length ? Math.round(total * 0.08) : total - ambient
  const swarm = swarmed.length ? Math.round(total * 0.2) : 0
  // Bigger clouds hold more dust, less than in proportion; the index halo, a thin ring, half as much again.
  const groupCumulative = cumulate(groups.map((group) => Math.pow(group.radius, 1.5) * (group.key === 'index' ? 0.5 : 1)))
  const starCumulative = cumulate(swarmed.map((index) => Math.pow(stars[index]!.importance, 2.2) + 0.01))

  for (let i = 0; i < total; i += 1) {
    p.angle[i] = grain(i, 1) * TAU
    p.phase[i] = grain(i, 2) * TAU
    p.wobble[i] = 1 + grain(i, 3) * 3.2
    p.size[i] = 0.45 + Math.pow(grain(i, 4), 2.2) * 1.6
    if (i < ambient) {
      // Field dust: barely there, barely moving.
      p.orbit[i] = Math.sqrt(grain(i, 5)) * field
      p.speed[i] = 0.004 + grain(i, 6) * 0.01
      p.alpha[i] = 0.06 + grain(i, 7) * 0.22
      p.size[i] = 0.45 + Math.pow(grain(i, 4), 2) * 0.8
    } else if (i < ambient + corona) {
      // The core's corona: dense near the centre, thinning outwards.
      const orbit = RINGS.core * 0.35 + Math.pow(grain(i, 5), 1.8) * 95
      p.orbit[i] = orbit
      p.speed[i] = (0.03 + grain(i, 6) * 0.06) / (1 + orbit / 140)
      p.alpha[i] = 0.25 + grain(i, 7) * 0.6
    } else if (i < ambient + corona + swarm) {
      // A swarm round a star, denser round the brighter ones.
      const index = swarmed[pick(starCumulative, grain(i, 8))]!
      const star = stars[index]!
      const orbit = star.size * 1.3 + Math.abs(gauss(i, 9)) * (4 + 14 * star.importance)
      p.anchorX[i] = star.x
      p.anchorY[i] = star.y
      p.orbit[i] = orbit
      p.speed[i] = (0.06 + grain(i, 6) * 0.1) / (1 + orbit / 40)
      p.wobble[i] = 0.6 + grain(i, 3) * 1.6
      p.alpha[i] = 0.25 + grain(i, 7) * 0.55
      p.size[i] = 0.5 + Math.pow(grain(i, 4), 2) * 1.3
      p.tone[i] = star.tone
      p.layer[i] = layerCode(star.layer)
      p.star[i] = index
    } else {
      // Cloud dust: a soft Gaussian round the cloud's centre, or a band for the index halo.
      const group = groups[pick(groupCumulative, grain(i, 8))]!
      let orbit: number
      if (group.key === 'index') {
        orbit = Math.max(0, group.inner + (group.radius - group.inner) * grain(i, 5) + gauss(i, 9) * 6)
      } else {
        p.anchorX[i] = group.x
        p.anchorY[i] = group.y
        orbit = Math.min(group.radius * 1.15, Math.abs(gauss(i, 9)) * group.radius * 0.5)
      }
      p.orbit[i] = orbit
      p.speed[i] = (0.018 + grain(i, 6) * 0.045) / (1 + orbit / 140)
      p.alpha[i] = 0.16 + grain(i, 7) * 0.6
      p.tone[i] = group.tone
      p.layer[i] = layerCode(group.layer)
    }
  }
  return p
}

/** Where grain `i` is at `time` seconds: a slow orbit of its anchor with a gentle radial breath. */
export function particleAt(p: NebulaParticles, i: number, time: number, out: Float32Array): void {
  const angle = p.angle[i]! + p.speed[i]! * time
  const orbit = p.orbit[i]! + Math.sin(p.phase[i]! + time * 0.35) * p.wobble[i]!
  out[0] = p.anchorX[i]! + Math.cos(angle) * orbit
  out[1] = p.anchorY[i]! + Math.sin(angle) * orbit
}

/** Grain `i`'s opacity at `time`: its own alpha, twinkling between 24% and 100% of it. */
export function particleAlpha(p: NebulaParticles, i: number, time: number): number {
  return p.alpha[i]! * (0.62 + 0.38 * Math.sin(p.phase[i]! * 2.3 + time * (0.45 + (i % 5) * 0.11)))
}

// ─── Picking ─────────────────────────────────────────────────────────

/** The star under a screen point, if any. Hidden layers do not count; the core always does. */
export function nebulaHitTest(
  layout: NebulaLayout | null,
  view: { scale: number; x: number; y: number },
  x: number,
  y: number,
  layers: Record<GraphLayer, boolean>,
): GraphNode | null {
  if (!layout) return null
  let best: GraphNode | null = null
  let bestDistance = Number.POSITIVE_INFINITY
  for (const star of layout.stars) {
    if (star.layer && !layers[star.layer]) continue
    const distance = Math.hypot(x - (star.x * view.scale + view.x), y - (star.y * view.scale + view.y))
    const reach = Math.max(star.size * view.scale, star.node.id === CORE_ID ? 14 : 3) + 6
    if (distance <= reach && distance < bestDistance) {
      best = star.node
      bestDistance = distance
    }
  }
  return best
}
