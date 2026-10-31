import { describe, expect, it } from 'vitest'
import type { MemoryGraphCluster, MemoryGraphData, MemoryGraphMemory, MemoryGraphSession } from '../../../types/memory'
import { CORE_ID, buildGraphModel, memoryNodeId, sessionNodeId } from './memoryGraphModel'
import {
  NEBULA_GROUPS,
  NEBULA_RADIUS,
  PARTICLE_LAYERS,
  buildNebulaLayout,
  nebulaGroupOf,
  nebulaHitTest,
  particleAlpha,
  particleAt,
  seedNebulaParticles,
  type NebulaLayout,
} from './memoryNebulaModel'

const DAY = 86_400_000
const NOW = Date.parse('2025-06-01T00:00:00.000Z')
const iso = (daysAgo: number) => new Date(NOW - daysAgo * DAY).toISOString()

function memory(path: string, type: string | undefined, overrides: Partial<MemoryGraphMemory> = {}): MemoryGraphMemory {
  return { path, title: path.replace(/\.md$/, ''), type, updatedAt: iso(40), bytes: 100, indexed: false, sessionId: null, ...overrides }
}

function session(id: string, messageCount: number): MemoryGraphSession {
  return { id, title: `会话 ${id}`, createdAt: iso(50), modifiedAt: iso(45), messageCount, projectPath: '/work', projectRoot: null, workDir: null, workDirExists: false }
}

function cluster(id: string, memories: MemoryGraphMemory[], sessions: MemoryGraphSession[], indexed = true): MemoryGraphCluster {
  return {
    id,
    label: `/work/${id}`,
    isCurrent: false,
    memoryDir: `/home/me/.claude/projects/${id}/memory`,
    index: { exists: indexed, updatedAt: iso(1), links: memories.length },
    memories,
    memoryTotal: memories.length,
    sessions,
    sessionTotal: sessions.length,
  }
}

function graphOf(...clusters: MemoryGraphCluster[]): MemoryGraphData {
  return { generatedAt: iso(0), userMemory: { exists: true, bytes: 10, updatedAt: iso(0) }, clusters }
}

const DATA = graphOf(
  cluster('alpha', [
    // Indexed, written by a conversation, fresh and described: the most important user memory.
    memory('user_tone.md', 'user', { indexed: true, sessionId: 's1', updatedAt: iso(1), description: '回答要简洁' }),
    memory('user_lang.md', 'user'),
    memory('feedback_tests.md', 'feedback', { indexed: true }),
    memory('project_stack.md', 'project'),
    memory('reference_api.md', 'reference'),
    memory('loose.md', undefined),
  ], [session('s1', 40), session('s2', 2)]),
  cluster('beta', [memory('user_editor.md', 'user', { indexed: true })], [session('s3', 8)], false),
)

const model = buildGraphModel(DATA)
const layout = buildNebulaLayout(model)

const groupOf = (key: string) => layout.groups.find((group) => group.key === key)!
const starOf = (id: string) => layout.stars[layout.starIndex.get(id)!]!
const distance = (ax: number, ay: number, bx: number, by: number) => Math.hypot(ax - bx, ay - by)

describe('buildNebulaLayout', () => {
  it('gathers every graph node into one cloud per kind and memory type', () => {
    expect(layout.stars).toHaveLength(model.nodes.length)
    for (const node of model.nodes) expect(layout.starIndex.has(node.id)).toBe(true)
    expect(layout.groups.map((group) => [group.key, group.count])).toEqual([
      ['index', 2], ['user', 3], ['feedback', 1], ['project', 1], ['reference', 1], ['other', 1], ['session', 3],
    ])
    for (const star of layout.stars) {
      if (star.node.id === CORE_ID) {
        expect(star.group).toBe(-1)
        continue
      }
      const group = layout.groups[star.group]!
      expect(group.key).toBe(nebulaGroupOf(star.node))
      expect(star.tone).toBe(NEBULA_GROUPS.find((spec) => spec.key === group.key)!.tone)
      expect(star.layer).toBe(group.layer)
    }
  })

  it('keeps each cloud\'s stars inside it, the clouds apart, and everything inside the graph\'s extent', () => {
    const halo = groupOf('index')
    const clouds = layout.groups.filter((group) => group.key !== 'index')
    for (const star of layout.stars) {
      if (star.group < 0) continue
      const group = layout.groups[star.group]!
      const fromCentre = distance(star.x, star.y, group.x, group.y)
      if (group.key === 'index') {
        expect(fromCentre).toBeGreaterThanOrEqual(group.inner)
        expect(fromCentre).toBeLessThanOrEqual(group.radius)
      } else {
        expect(fromCentre).toBeLessThanOrEqual(group.radius)
      }
    }
    for (const [index, a] of clouds.entries()) {
      // Clear of the index halo round the core…
      expect(distance(a.x, a.y, 0, 0) - a.radius).toBeGreaterThan(halo.radius)
      // …and of every other cloud.
      for (const b of clouds.slice(index + 1)) expect(distance(a.x, a.y, b.x, b.y)).toBeGreaterThanOrEqual(a.radius + b.radius)
      expect(distance(a.x, a.y, 0, 0) + a.radius).toBeLessThanOrEqual(NEBULA_RADIUS + 1e-6)
    }
    // The same extent as the graph, so the page's fit frames both forms alike.
    expect(layout.extent).toBe(model.extent)
  })

  it('puts the most important member at the heart of its cloud and draws it largest', () => {
    const user = groupOf('user')
    const members = layout.stars.filter((star) => star.group === layout.groups.indexOf(user))
    const nearest = [...members].sort((a, b) => distance(a.x, a.y, user.x, user.y) - distance(b.x, b.y, user.x, user.y))[0]!
    const tone = starOf(memoryNodeId('alpha', 'user_tone.md'))
    const editor = starOf(memoryNodeId('beta', 'user_editor.md'))
    const lang = starOf(memoryNodeId('alpha', 'user_lang.md'))
    expect(nearest).toBe(tone)
    expect(tone.importance).toBeGreaterThan(editor.importance)
    expect(editor.importance).toBeGreaterThan(lang.importance)
    expect(tone.size).toBeGreaterThan(editor.size)
    expect(editor.size).toBeGreaterThan(lang.size)
    // A long conversation that left a memory outshines a short one that did not.
    expect(starOf(sessionNodeId('alpha', 's1')).importance).toBeGreaterThan(starOf(sessionNodeId('alpha', 's2')).importance)
    // The core is the brightest and largest of all.
    const core = starOf(CORE_ID)
    expect(core.importance).toBe(1)
    for (const star of layout.stars) expect(core.size).toBeGreaterThanOrEqual(star.size)
  })

  it('lays the same graph out the same way every time', () => {
    const again = buildNebulaLayout(buildGraphModel(DATA))
    expect(again.stars.map((star) => [star.node.id, star.x, star.y])).toEqual(layout.stars.map((star) => [star.node.id, star.x, star.y]))
    expect(again.groups).toEqual(layout.groups)
  })

  it('keeps a faint link for every graph edge, between the same nodes', () => {
    expect(layout.links).toHaveLength(model.edges.length)
    model.edges.forEach((edge, index) => {
      expect(layout.links[index]).toEqual({ from: layout.starIndex.get(edge.from), to: layout.starIndex.get(edge.to), strength: edge.strength })
    })
  })

  it('draws an empty graph as the core alone', () => {
    const empty = buildNebulaLayout(buildGraphModel(graphOf()))
    expect(empty.groups).toEqual([])
    expect(empty.stars.map((star) => star.node.id)).toEqual([CORE_ID])
    expect(empty.links).toEqual([])
    expect(nebulaHitTest(empty, { scale: 1, x: 100, y: 100 }, 100, 100, { L3: true, L2: true, L1: true })?.id).toBe(CORE_ID)
  })
})

describe('seedNebulaParticles', () => {
  const particles = seedNebulaParticles(layout, 3000)
  const point = new Float32Array(2)

  it('seeds the asked-for number of grains, the same ones every time', () => {
    expect(particles.count).toBe(3000)
    const again = seedNebulaParticles(layout, 3000)
    expect(Array.from(again.orbit)).toEqual(Array.from(particles.orbit))
    expect(Array.from(again.tone)).toEqual(Array.from(particles.tone))
  })

  it('tints every grain like the cloud or star it belongs to', () => {
    const tones = new Set([0, ...layout.groups.map((group) => group.tone)])
    // Anchors are stored as float32, so the cloud centres are looked up the same way.
    const cloudTones = new Map(layout.groups.filter((group) => group.key !== 'index').map((group) => [`${Math.fround(group.x)},${Math.fround(group.y)}`, group]))
    let swarms = 0
    let clouds = 0
    for (let index = 0; index < particles.count; index += 1) {
      expect(tones.has(particles.tone[index]!)).toBe(true)
      expect(particles.layer[index]!).toBeLessThan(PARTICLE_LAYERS.length)
      const star = particles.star[index]!
      if (star >= 0) {
        swarms += 1
        const owner = layout.stars[star]!
        expect(particles.tone[index]).toBe(owner.tone)
        expect(PARTICLE_LAYERS[particles.layer[index]!]).toBe(owner.layer)
        continue
      }
      const cloud = cloudTones.get(`${particles.anchorX[index]},${particles.anchorY[index]}`)
      if (!cloud) continue
      clouds += 1
      expect(particles.tone[index]).toBe(cloud.tone)
      // Cloud dust stays in a soft disc round its cloud, whenever you look.
      for (const time of [0, 37, 600]) {
        particleAt(particles, index, time, point)
        expect(distance(point[0]!, point[1]!, cloud.x, cloud.y)).toBeLessThanOrEqual(cloud.radius * 1.15 + 4.3)
      }
    }
    expect(swarms).toBeGreaterThan(0)
    expect(clouds).toBeGreaterThan(particles.count / 4)
  })

  it('drifts slowly: no grain moves more than 12 world units in a second', () => {
    const before = new Float32Array(2)
    let fastest = 0
    for (let index = 0; index < particles.count; index += 1) {
      for (const time of [0, 10, 95.5]) {
        particleAt(particles, index, time, before)
        particleAt(particles, index, time + 1, point)
        fastest = Math.max(fastest, distance(before[0]!, before[1]!, point[0]!, point[1]!))
      }
    }
    expect(fastest).toBeGreaterThan(0)
    expect(fastest).toBeLessThan(12)
  })

  it('twinkles every grain between a quarter of its alpha and all of it', () => {
    for (let index = 0; index < particles.count; index += 97) {
      for (const time of [0, 1.3, 42]) {
        const alpha = particleAlpha(particles, index, time)
        expect(alpha).toBeGreaterThanOrEqual(particles.alpha[index]! * 0.24 - 1e-6)
        expect(alpha).toBeLessThanOrEqual(particles.alpha[index]! + 1e-6)
      }
    }
  })

  it('fills an empty sky with the core\'s corona and field dust only', () => {
    const empty = seedNebulaParticles(buildNebulaLayout(buildGraphModel(graphOf())), 500)
    expect(empty.count).toBe(500)
    expect(new Set(empty.tone)).toEqual(new Set([0]))
    expect(new Set(empty.layer)).toEqual(new Set([0]))
    expect(new Set(empty.star)).toEqual(new Set([-1]))
    expect(seedNebulaParticles(null, 0).count).toBe(0)
  })
})

describe('nebulaHitTest', () => {
  const view = { scale: 0.8, x: 400, y: 300 }
  const layers = { L3: true, L2: true, L1: true }
  const screen = (layoutStar: NebulaLayout['stars'][number]) => [layoutStar.x * view.scale + view.x, layoutStar.y * view.scale + view.y] as const

  it('finds the star under the pointer, the same graph node the page locks', () => {
    const star = starOf(memoryNodeId('alpha', 'user_tone.md'))
    const [x, y] = screen(star)
    expect(nebulaHitTest(layout, view, x + 2, y - 2, layers)).toBe(star.node)
    expect(nebulaHitTest(layout, view, -500, -500, layers)).toBeNull()
    expect(nebulaHitTest(null, view, x, y, layers)).toBeNull()
  })

  it('skips stars on hidden layers but always finds the core', () => {
    const star = starOf(memoryNodeId('alpha', 'user_tone.md'))
    const [x, y] = screen(star)
    expect(nebulaHitTest(layout, view, x, y, { ...layers, L2: false })?.kind).not.toBe('memory')
    expect(nebulaHitTest(layout, view, view.x, view.y, { L3: false, L2: false, L1: false })?.id).toBe(CORE_ID)
  })
})
