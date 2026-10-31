import type { MemoryGraphCluster, MemoryGraphData, MemoryGraphMemory, MemoryGraphSession } from '../../../types/memory'

/**
 * World layout of the 记忆图谱 (memory graph): three rings around a core,
 * after DeepTutor's L1/L2/L3 model.
 *
 *   core — the synthesis everything flows into (user CLAUDE.md)
 *   L3   — one MEMORY.md index per project
 *   L2   — the memory files ("facts")
 *   L1   — the conversations they were written in ("raw events")
 *
 * Each project owns an angular wedge across all three rings, so a memory sits
 * between the conversation it came from and the index that lists it. World
 * units are CSS pixels at 100% zoom; the renderer maps them to the screen.
 */

export type GraphLayer = 'L3' | 'L2' | 'L1'
export type GraphNodeKind = 'core' | 'index' | 'memory' | 'session'
export type MemoryShape = 'circle' | 'diamond' | 'square' | 'triangle' | 'ring'

export type GraphNode = {
  id: string
  kind: GraphNodeKind
  layer: GraphLayer
  /** -1 for the core. */
  cluster: number
  x: number
  y: number
  angle: number
  radius: number
  /** World radius of the mark. */
  size: number
  shape: MemoryShape
  label: string
  memory?: MemoryGraphMemory
  session?: MemoryGraphSession
}

/** Outer node → inner node: the direction memory consolidates in. */
export type GraphEdge = {
  from: string
  to: string
  /** 1 for a real link, lower for "belongs to the same project". */
  strength: number
}

export type GraphCluster = {
  index: number
  data: MemoryGraphCluster
  name: string
  startAngle: number
  endAngle: number
  midAngle: number
}

export type GraphModel = {
  nodes: GraphNode[]
  byId: Map<string, GraphNode>
  edges: GraphEdge[]
  clusters: GraphCluster[]
  /** Node id → ids one step inward / outward. */
  inward: Map<string, string[]>
  outward: Map<string, string[]>
  counts: { L3: number; L2: number; L1: number }
  /** Radius that fits everything, labels included. */
  extent: number
  userMemory: MemoryGraphData['userMemory']
}

export const CORE_ID = 'core'

export const RINGS = {
  core: 40,
  L3: { inner: 88, outer: 176 },
  L2: { inner: 220, outer: 344 },
  L1: { inner: 388, outer: 540 },
} as const

export const MEMORY_TYPE_LABELS: Record<string, string> = {
  user: '用户',
  feedback: '反馈',
  project: '项目',
  reference: '参考',
}

const TYPE_SHAPES: Record<string, MemoryShape> = {
  user: 'circle',
  feedback: 'diamond',
  project: 'square',
  reference: 'triangle',
}

const TAU = Math.PI * 2
const CLUSTER_GAP = 0.07

export function memoryNodeId(clusterId: string, path: string): string {
  return `memory:${clusterId}:${path}`
}

export function sessionNodeId(clusterId: string, sessionId: string): string {
  return `session:${clusterId}:${sessionId}`
}

export function indexNodeId(clusterId: string): string {
  return `index:${clusterId}`
}

/** The last segment of a project path, for labels. */
export function shortProjectName(label: string): string {
  const parts = label.replace(/[\\/]+$/, '').split(/[\\/]/).filter(Boolean)
  return parts[parts.length - 1] || label || '未命名项目'
}

export function buildGraphModel(data: MemoryGraphData): GraphModel {
  const nodes: GraphNode[] = []
  const edges: GraphEdge[] = []
  const clusters: GraphCluster[] = []
  const counts = { L3: 0, L2: 0, L1: 0 }

  nodes.push({
    id: CORE_ID,
    kind: 'core',
    layer: 'L3',
    cluster: -1,
    x: 0,
    y: 0,
    angle: 0,
    radius: 0,
    size: RINGS.core * 0.62,
    shape: 'circle',
    label: 'L3 综合',
  })

  const weights = data.clusters.map((cluster) => 1 + Math.sqrt(cluster.memories.length + cluster.sessions.length * 0.6))
  const totalWeight = weights.reduce((sum, weight) => sum + weight, 0) || 1
  const gap = data.clusters.length > 1 ? CLUSTER_GAP : 0
  const available = TAU - gap * data.clusters.length
  // The first project is centred at the top.
  let cursor = -Math.PI / 2 - (available * (weights[0] ?? 1)) / totalWeight / 2

  data.clusters.forEach((cluster, index) => {
    const span = (available * weights[index]!) / totalWeight
    const startAngle = cursor
    const endAngle = cursor + span
    const midAngle = (startAngle + endAngle) / 2
    cursor = endAngle + gap
    clusters.push({ index, data: cluster, name: shortProjectName(cluster.label), startAngle, endAngle, midAngle })

    const indexId = indexNodeId(cluster.id)
    const indexRadius = (RINGS.L3.inner + RINGS.L3.outer) / 2
    nodes.push({
      id: indexId,
      kind: 'index',
      layer: 'L3',
      cluster: index,
      ...polar(midAngle, indexRadius),
      angle: midAngle,
      radius: indexRadius,
      size: 7,
      shape: cluster.index.exists ? 'circle' : 'ring',
      label: cluster.index.exists ? 'MEMORY.md' : '未建索引',
    })
    if (cluster.index.exists) counts.L3 += 1
    edges.push({ from: indexId, to: CORE_ID, strength: cluster.index.exists ? 1 : 0.4 })

    const memoryPositions = placeInWedge(cluster.memories.length, startAngle, endAngle, RINGS.L2.inner, RINGS.L2.outer, hashString(cluster.id))
    cluster.memories.forEach((memory, memoryIndex) => {
      const position = memoryPositions[memoryIndex]!
      const id = memoryNodeId(cluster.id, memory.path)
      nodes.push({
        id,
        kind: 'memory',
        layer: 'L2',
        cluster: index,
        ...polar(position.angle, position.radius),
        angle: position.angle,
        radius: position.radius,
        size: 4.2,
        shape: (memory.type && TYPE_SHAPES[memory.type]) || 'ring',
        label: memory.title,
        memory,
      })
      edges.push({ from: id, to: indexId, strength: memory.indexed ? 1 : 0.45 })
    })
    counts.L2 += cluster.memoryTotal

    const linkedSessions = new Set(cluster.memories.flatMap((memory) => (memory.sessionId ? [memory.sessionId] : [])))
    const sessionPositions = placeInWedge(cluster.sessions.length, startAngle, endAngle, RINGS.L1.inner, RINGS.L1.outer, hashString(`${cluster.id}:sessions`))
    cluster.sessions.forEach((session, sessionIndex) => {
      const position = sessionPositions[sessionIndex]!
      const id = sessionNodeId(cluster.id, session.id)
      nodes.push({
        id,
        kind: 'session',
        layer: 'L1',
        cluster: index,
        ...polar(position.angle, position.radius),
        angle: position.angle,
        radius: position.radius,
        size: 2 + Math.min(3, Math.log2(1 + session.messageCount) * 0.55),
        shape: 'ring',
        label: session.title || '未命名会话',
        session,
      })
      // A conversation feeds the memories it wrote; one that wrote none still
      // belongs to its project's index.
      if (!linkedSessions.has(session.id)) edges.push({ from: id, to: indexId, strength: 0.25 })
    })
    for (const memory of cluster.memories) {
      if (memory.sessionId && cluster.sessions.some((session) => session.id === memory.sessionId)) {
        edges.push({ from: sessionNodeId(cluster.id, memory.sessionId), to: memoryNodeId(cluster.id, memory.path), strength: 1 })
      }
    }
    counts.L1 += cluster.sessionTotal
  })

  const byId = new Map(nodes.map((node) => [node.id, node]))
  const inward = new Map<string, string[]>()
  const outward = new Map<string, string[]>()
  for (const edge of edges) {
    if (!byId.has(edge.from) || !byId.has(edge.to)) continue
    inward.set(edge.from, [...(inward.get(edge.from) ?? []), edge.to])
    outward.set(edge.to, [...(outward.get(edge.to) ?? []), edge.from])
  }

  return {
    nodes,
    byId,
    edges: edges.filter((edge) => byId.has(edge.from) && byId.has(edge.to)),
    clusters,
    inward,
    outward,
    counts,
    extent: RINGS.L1.outer + 70,
    userMemory: data.userMemory,
  }
}

/**
 * The chain a node belongs to: everything it consolidates into (inward,
 * L1 → L2 → L3) and everything that feeds it (outward). The core's chain is
 * the whole graph, so it stops at the indexes rather than lighting everything.
 */
export function traceChain(model: GraphModel, id: string): Set<string> {
  const chain = new Set<string>([id])
  const walk = (start: string, links: Map<string, string[]>, depth: number) => {
    const queue: Array<[string, number]> = [[start, 0]]
    while (queue.length) {
      const [current, level] = queue.shift()!
      if (level >= depth) continue
      for (const next of links.get(current) ?? []) {
        if (chain.has(next)) continue
        chain.add(next)
        queue.push([next, level + 1])
      }
    }
  }
  walk(id, model.inward, 4)
  walk(id, model.outward, id === CORE_ID ? 1 : 4)
  return chain
}

function polar(angle: number, radius: number): { x: number; y: number } {
  return { x: Math.cos(angle) * radius, y: Math.sin(angle) * radius }
}

/**
 * Spreads `count` marks over the band [r0, r1] × [a0, a1] in rows whose
 * column count follows each row's arc length, with a stable jitter so the
 * field reads as organic without moving between renders.
 */
export function placeInWedge(count: number, a0: number, a1: number, r0: number, r1: number, seed: number): Array<{ angle: number; radius: number }> {
  if (count <= 0) return []
  const pad = Math.min(0.03, (a1 - a0) * 0.08)
  const start = a0 + pad
  const span = Math.max(0.0001, a1 - a0 - pad * 2)
  const inner = r0 + 12
  const outer = r1 - 12
  const depth = Math.max(1, outer - inner)
  const midArc = (span * (inner + outer)) / 2
  const cell = Math.sqrt((depth * midArc) / count)
  const rows = Math.max(1, Math.min(count, Math.round(depth / cell)))
  const rowRadius = (row: number) => inner + (depth * (row + 0.5)) / rows
  const arcs = Array.from({ length: rows }, (_, row) => rowRadius(row) * span)
  const totalArc = arcs.reduce((sum, arc) => sum + arc, 0)
  // Largest-remainder split, so the rows add up to exactly `count`.
  const shares = arcs.map((arc) => (count * arc) / totalArc)
  const perRow = shares.map((share) => Math.floor(share))
  let remaining = count - perRow.reduce((sum, value) => sum + value, 0)
  const byRemainder = shares.map((share, row) => [share - Math.floor(share), row] as const).sort((a, b) => b[0] - a[0])
  for (const [, row] of byRemainder) {
    if (remaining <= 0) break
    perRow[row]! += 1
    remaining -= 1
  }
  const positions: Array<{ angle: number; radius: number }> = []
  let item = 0
  for (let row = 0; row < rows && item < count; row += 1) {
    const cols = perRow[row]!
    for (let col = 0; col < cols && item < count; col += 1, item += 1) {
      const jitterA = (random(seed + item * 7919) - 0.5) * (span / cols) * 0.5
      const jitterR = (random(seed + item * 104729) - 0.5) * (depth / rows) * 0.55
      positions.push({ angle: start + (span * (col + 0.5)) / cols + jitterA, radius: rowRadius(row) + jitterR })
    }
  }
  while (positions.length < count) positions.push({ angle: start + span / 2, radius: (inner + outer) / 2 })
  return positions
}

export function hashString(value: string): number {
  let hash = 2166136261
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return hash >>> 0
}

/** Deterministic 0..1 from an integer seed (mulberry32 step). */
export function random(seed: number): number {
  let t = (seed + 0x6d2b79f5) >>> 0
  t = Math.imul(t ^ (t >>> 15), t | 1)
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296
}
