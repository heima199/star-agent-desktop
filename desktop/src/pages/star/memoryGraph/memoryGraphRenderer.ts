import { CORE_ID, RINGS, random, type GraphCluster, type GraphLayer, type GraphModel, type GraphNode, type MemoryShape } from './memoryGraphModel'

/**
 * Canvas renderer for the 记忆图谱: monochrome by design, so it paints with
 * the theme's ink on the theme's ground and nothing else.
 *
 * The particles are the point of the page. Three bands of orbiting dust trace
 * the L3/L2/L1 rings, every link streams particles inward the way memory
 * consolidates (conversation → memory → index → core), and the core throws a
 * corona. On a dark ground everything glows additively; on a light one the
 * same field reads as graphite dust.
 */

export type GraphView = { scale: number; x: number; y: number }
/** A rect in canvas CSS pixels. */
export type ScreenRect = { x: number; y: number; width: number; height: number }
export type Rgb = [number, number, number]
export type GraphTheme = { ink: Rgb; background: string; dark: boolean; font: string }

const TAU = Math.PI * 2
const ALPHA_LEVELS = 6
const CORONA = 180
const MAX_FLOWS = 1600
const MAX_HALOS = 90

const lerp = (from: number, to: number, t: number) => from + (to - from) * t
const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value))

/** Parses `#rgb`, `#rrggbb` and `rgb()/rgba()` into RGB; null for anything else. */
export function parseCssColor(value: string): Rgb | null {
  const text = value.trim()
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(text)
  if (hex) {
    const digits = hex[1]!.length === 3 ? hex[1]!.split('').map((digit) => digit + digit).join('') : hex[1]!
    return [Number.parseInt(digits.slice(0, 2), 16), Number.parseInt(digits.slice(2, 4), 16), Number.parseInt(digits.slice(4, 6), 16)]
  }
  const rgb = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)/i.exec(text)
  return rgb ? [Number(rgb[1]), Number(rgb[2]), Number(rgb[3])] : null
}

export class MemoryGraphRenderer {
  private readonly ctx: CanvasRenderingContext2D
  private model: GraphModel | null = null
  private theme: GraphTheme
  private width = 0
  private height = 0
  private dpr = 1
  private view: GraphView = { scale: 1, x: 0, y: 0 }
  private chain: Set<string> | null = null
  private focusId: string | null = null
  private focusCluster = -1
  private layers: Record<GraphLayer, boolean> = { L3: true, L2: true, L1: true }
  private occluders: ScreenRect[] = []
  private readonly reducedMotion: boolean
  private raf = 0
  private lastTick = 0
  private time = 0
  private running = false
  private inkStyles: string[] = []

  private dustCount = 0
  private dustAngle = new Float32Array(0)
  private dustRadius = new Float32Array(0)
  private dustSpeed = new Float32Array(0)
  private dustSize = new Float32Array(0)
  private dustPhase = new Float32Array(0)
  private dustAlpha = new Float32Array(0)

  /** Per edge: x0 y0 cx cy x1 y1 in world units. */
  private edgeGeometry = new Float32Array(0)
  private edgeStrength = new Float32Array(0)
  private edgeLayers: Array<[GraphLayer, GraphLayer]> = []
  private edgeHot = new Uint8Array(0)
  private flowEdge = new Int32Array(0)
  private flowT = new Float32Array(0)
  private flowSpeed = new Float32Array(0)

  private readonly coronaAngle = new Float32Array(CORONA)
  private readonly coronaDistance = new Float32Array(CORONA)
  private readonly coronaSpeed = new Float32Array(CORONA)
  private readonly coronaSize = new Float32Array(CORONA)

  private readonly bucketX: Float32Array[] = []
  private readonly bucketY: Float32Array[] = []
  private readonly bucketS: Float32Array[] = []
  private readonly bucketCount = new Int32Array(ALPHA_LEVELS)

  constructor(private readonly canvas: HTMLCanvasElement, theme: GraphTheme, reducedMotion: boolean) {
    const context = canvas.getContext('2d')
    if (!context) throw new Error('2D canvas unavailable')
    this.ctx = context
    this.theme = theme
    this.reducedMotion = reducedMotion
    this.inkStyles = this.buildInkStyles()
    for (let index = 0; index < CORONA; index += 1) this.resetCorona(index, Math.random())
  }

  setTheme(theme: GraphTheme): void {
    this.theme = theme
    this.inkStyles = this.buildInkStyles()
    this.requestDraw()
  }

  setSize(width: number, height: number, dpr: number): void {
    this.width = width
    this.height = height
    this.dpr = dpr
    this.canvas.width = Math.max(1, Math.round(width * dpr))
    this.canvas.height = Math.max(1, Math.round(height * dpr))
    // Dust follows the area so a large window is as dense as a small one.
    const wanted = Math.round(clamp((width * height) / 190, 900, 3800))
    if (Math.abs(wanted - this.dustCount) > this.dustCount * 0.2) this.seedDust(wanted)
    this.requestDraw()
  }

  setView(view: GraphView): void {
    this.view = view
    this.requestDraw()
  }

  setModel(model: GraphModel | null): void {
    this.model = model
    this.buildEdges()
    this.applyChain()
    this.requestDraw()
  }

  /** The highlighted chain (hover or lock), and the node the user points at. */
  setFocus(chain: Set<string> | null, focusId: string | null, focusCluster: number): void {
    this.chain = chain
    this.focusId = focusId
    this.focusCluster = focusCluster
    this.applyChain()
    this.requestDraw()
  }

  setLayers(layers: Record<GraphLayer, boolean>): void {
    this.layers = { ...layers }
    this.requestDraw()
  }

  /** Panels the page lays over the canvas. Wedge labels slide out from under them. */
  setOccluders(rects: ScreenRect[]): void {
    this.occluders = rects
    this.requestDraw()
  }

  start(): void {
    if (this.running) return
    this.running = true
    if (this.reducedMotion) {
      this.draw()
      return
    }
    this.lastTick = performance.now()
    const tick = (now: number) => {
      if (!this.running) return
      const dt = Math.min(0.05, Math.max(0, (now - this.lastTick) / 1000))
      this.lastTick = now
      this.advance(dt)
      this.draw()
      this.raf = requestAnimationFrame(tick)
    }
    this.raf = requestAnimationFrame(tick)
  }

  stop(): void {
    this.running = false
    if (this.raf) cancelAnimationFrame(this.raf)
    this.raf = 0
  }

  destroy(): void {
    this.stop()
    this.model = null
  }

  /** Draws one frame now when the loop is not running (paused or reduced motion). */
  requestDraw(): void {
    if (!this.running || this.reducedMotion) this.draw()
  }

  /** The node under a screen point, if any; the core counts as a node. */
  hitTest(x: number, y: number): GraphNode | null {
    if (!this.model) return null
    const { scale } = this.view
    let best: GraphNode | null = null
    let bestDistance = Number.POSITIVE_INFINITY
    for (const node of this.model.nodes) {
      if (node.kind !== 'core' && !this.layers[node.layer]) continue
      const [sx, sy] = this.toScreen(node.x, node.y)
      const reach = Math.max(node.size * scale, node.kind === 'core' ? 14 : 3) + 6
      const distance = Math.hypot(x - sx, y - sy)
      if (distance <= reach && distance < bestDistance) {
        best = node
        bestDistance = distance
      }
    }
    return best
  }

  /** The project wedge under a screen point, or -1. */
  clusterAt(x: number, y: number): number {
    if (!this.model) return -1
    const wx = (x - this.view.x) / this.view.scale
    const wy = (y - this.view.y) / this.view.scale
    const radius = Math.hypot(wx, wy)
    if (radius < RINGS.core || radius > RINGS.L1.outer + 40) return -1
    const angle = Math.atan2(wy, wx)
    for (const cluster of this.model.clusters) {
      let relative = angle - cluster.startAngle
      while (relative < 0) relative += TAU
      while (relative >= TAU) relative -= TAU
      if (relative <= cluster.endAngle - cluster.startAngle) return cluster.index
    }
    return -1
  }

  toScreen(wx: number, wy: number): [number, number] {
    return [wx * this.view.scale + this.view.x, wy * this.view.scale + this.view.y]
  }

  // ── setup ────────────────────────────────────────────────

  private buildInkStyles(): string[] {
    const [r, g, b] = this.theme.ink
    return Array.from({ length: ALPHA_LEVELS }, (_, level) => `rgba(${r}, ${g}, ${b}, ${this.levelAlpha(level).toFixed(3)})`)
  }

  private levelAlpha(level: number): number {
    // Light grounds need denser ink to read; dark ones glow additively.
    const top = this.theme.dark ? 0.95 : 0.8
    return top * Math.pow((level + 1) / ALPHA_LEVELS, 1.35)
  }

  private ink(alpha: number): string {
    const [r, g, b] = this.theme.ink
    return `rgba(${r}, ${g}, ${b}, ${clamp(alpha, 0, 1).toFixed(3)})`
  }

  private seedDust(count: number): void {
    this.dustCount = count
    this.dustAngle = new Float32Array(count)
    this.dustRadius = new Float32Array(count)
    this.dustSpeed = new Float32Array(count)
    this.dustSize = new Float32Array(count)
    this.dustPhase = new Float32Array(count)
    this.dustAlpha = new Float32Array(count)
    for (let index = 0; index < count; index += 1) {
      const band = random(index * 13 + 1)
      const spread = random(index * 31 + 7)
      let radius: number
      if (band < 0.1) radius = lerp(RINGS.core * 0.6, RINGS.L3.inner, spread)
      else if (band < 0.31) radius = lerp(RINGS.L3.inner - 6, RINGS.L3.outer + 6, spread)
      else if (band < 0.6) radius = lerp(RINGS.L2.inner - 6, RINGS.L2.outer + 6, spread)
      else if (band < 0.92) radius = lerp(RINGS.L1.inner - 6, RINGS.L1.outer + 6, spread)
      else radius = RINGS.L1.outer + 12 + spread * spread * 170
      this.dustRadius[index] = radius
      this.dustAngle[index] = random(index * 47 + 3) * TAU
      // Inner rings turn faster, like a disc.
      this.dustSpeed[index] = (0.016 + 0.055 * (1 - Math.min(1, radius / 720))) * (0.65 + random(index * 59 + 11) * 0.7)
      this.dustSize[index] = 0.55 + Math.pow(random(index * 71 + 5), 2.2) * 1.9
      this.dustPhase[index] = random(index * 83 + 9) * TAU
      this.dustAlpha[index] = 0.22 + random(index * 97 + 13) * 0.78
    }
    for (let level = 0; level < ALPHA_LEVELS; level += 1) {
      this.bucketX[level] = new Float32Array(count * 3 + MAX_FLOWS * 3 + CORONA)
      this.bucketY[level] = new Float32Array(count * 3 + MAX_FLOWS * 3 + CORONA)
      this.bucketS[level] = new Float32Array(count * 3 + MAX_FLOWS * 3 + CORONA)
    }
  }

  private buildEdges(): void {
    const model = this.model
    const edges = model?.edges ?? []
    this.edgeGeometry = new Float32Array(edges.length * 6)
    this.edgeStrength = new Float32Array(edges.length)
    this.edgeLayers = []
    this.edgeHot = new Uint8Array(edges.length)
    edges.forEach((edge, index) => {
      const from = model!.byId.get(edge.from)!
      const to = model!.byId.get(edge.to)!
      // The control point is the midpoint turned a little around the core, so
      // every stream bends the same way and the field reads as a vortex.
      const midX = (from.x + to.x) / 2
      const midY = (from.y + to.y) / 2
      const swirl = 0.2 + random(index * 17 + 3) * 0.12
      const cos = Math.cos(swirl)
      const sin = Math.sin(swirl)
      const shrink = 0.94
      this.edgeGeometry.set([from.x, from.y, (midX * cos - midY * sin) * shrink, (midX * sin + midY * cos) * shrink, to.x, to.y], index * 6)
      this.edgeStrength[index] = edge.strength
      this.edgeLayers.push([from.layer, to.layer])
    })
    const lanes: number[] = []
    edges.forEach((edge, index) => {
      const count = edge.strength >= 1 ? 3 : edge.strength >= 0.4 ? 2 : 1
      for (let lane = 0; lane < count; lane += 1) lanes.push(index)
    })
    const kept = lanes.length > MAX_FLOWS ? lanes.filter((_, index) => index % Math.ceil(lanes.length / MAX_FLOWS) === 0) : lanes
    this.flowEdge = Int32Array.from(kept)
    this.flowT = new Float32Array(kept.length)
    this.flowSpeed = new Float32Array(kept.length)
    for (let index = 0; index < kept.length; index += 1) {
      this.flowT[index] = random(index * 29 + 1)
      this.flowSpeed[index] = 1 / (1.7 + random(index * 37 + 5) * 2.1)
    }
  }

  private applyChain(): void {
    const model = this.model
    if (!model) return
    model.edges.forEach((edge, index) => {
      this.edgeHot[index] = this.chain && this.chain.has(edge.from) && this.chain.has(edge.to) ? 1 : 0
    })
  }

  private resetCorona(index: number, distance = 0): void {
    this.coronaAngle[index] = Math.random() * TAU
    this.coronaDistance[index] = distance
    this.coronaSpeed[index] = 0.18 + Math.random() * 0.42
    this.coronaSize[index] = 0.8 + Math.random() * 1.8
  }

  private advance(dt: number): void {
    this.time += dt
    for (let index = 0; index < this.flowT.length; index += 1) {
      const boost = this.edgeHot[this.flowEdge[index]!] ? 1.9 : 1
      let t = this.flowT[index]! + dt * this.flowSpeed[index]! * boost
      if (t >= 1) t -= 1
      this.flowT[index] = t
    }
    for (let index = 0; index < CORONA; index += 1) {
      const next = this.coronaDistance[index]! + dt * this.coronaSpeed[index]!
      if (next >= 1) this.resetCorona(index)
      else this.coronaDistance[index] = next
    }
  }

  // ── drawing ──────────────────────────────────────────────

  private draw(): void {
    const ctx = this.ctx
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0)
    ctx.globalCompositeOperation = 'source-over'
    ctx.globalAlpha = 1
    ctx.fillStyle = this.theme.background
    ctx.fillRect(0, 0, this.width, this.height)
    this.drawRays()
    this.drawRings()
    this.drawLinks()
    ctx.globalCompositeOperation = this.theme.dark ? 'lighter' : 'source-over'
    this.bucketCount.fill(0)
    this.collectDust()
    this.collectFlows()
    this.collectCorona()
    this.flushBuckets()
    this.drawCoreGlow()
    ctx.globalCompositeOperation = 'source-over'
    this.drawNodes()
    this.drawLabels()
  }

  private drawRays(): void {
    const model = this.model
    if (!model || model.clusters.length === 0) return
    const ctx = this.ctx
    const [cx, cy] = this.toScreen(0, 0)
    const outer = (RINGS.L1.outer + 36) * this.view.scale
    const inner = RINGS.core * this.view.scale
    for (const cluster of model.clusters) {
      const focused = cluster.index === this.focusCluster
      const dimmed = this.focusCluster >= 0 && !focused
      const peak = (focused ? 0.16 : 0.068) * (dimmed ? 0.5 : 1) * (this.theme.dark ? 1 : 0.75)
      const gradient = ctx.createRadialGradient(cx, cy, inner, cx, cy, outer)
      gradient.addColorStop(0, this.ink(peak))
      gradient.addColorStop(0.5, this.ink(peak * 0.42))
      gradient.addColorStop(1, this.ink(0))
      ctx.beginPath()
      ctx.moveTo(cx, cy)
      ctx.arc(cx, cy, outer, cluster.startAngle, cluster.endAngle)
      ctx.closePath()
      ctx.fillStyle = gradient
      ctx.fill()
    }
  }

  private drawRings(): void {
    const ctx = this.ctx
    const [cx, cy] = this.toScreen(0, 0)
    const scale = this.view.scale
    const bands: Array<[GraphLayer, { inner: number; outer: number }]> = [['L3', RINGS.L3], ['L2', RINGS.L2], ['L1', RINGS.L1]]
    for (const [layer, band] of bands) {
      const visible = this.layers[layer]
      ctx.beginPath()
      ctx.arc(cx, cy, band.outer * scale, 0, TAU)
      ctx.arc(cx, cy, band.inner * scale, 0, TAU, true)
      ctx.fillStyle = this.ink(visible ? 0.03 : 0.012)
      ctx.fill()
      ctx.lineWidth = 1
      ctx.strokeStyle = this.ink(visible ? 0.09 : 0.03)
      ctx.beginPath()
      ctx.arc(cx, cy, band.outer * scale, 0, TAU)
      ctx.stroke()
      ctx.beginPath()
      ctx.arc(cx, cy, band.inner * scale, 0, TAU)
      ctx.stroke()
    }
  }

  private edgeVisible(index: number): boolean {
    const layers = this.edgeLayers[index]
    return Boolean(layers && this.layers[layers[0]] && this.layers[layers[1]])
  }

  private drawLinks(): void {
    const model = this.model
    if (!model) return
    const ctx = this.ctx
    const { scale, x: ox, y: oy } = this.view
    const geometry = this.edgeGeometry
    for (const hot of [false, true]) {
      ctx.beginPath()
      let drawn = 0
      for (let index = 0; index < model.edges.length; index += 1) {
        if ((this.edgeHot[index] === 1) !== hot || !this.edgeVisible(index)) continue
        const at = index * 6
        ctx.moveTo(geometry[at]! * scale + ox, geometry[at + 1]! * scale + oy)
        ctx.quadraticCurveTo(geometry[at + 2]! * scale + ox, geometry[at + 3]! * scale + oy, geometry[at + 4]! * scale + ox, geometry[at + 5]! * scale + oy)
        drawn += 1
      }
      if (!drawn) continue
      ctx.lineWidth = hot ? 1.2 : 0.7
      ctx.strokeStyle = this.ink(hot ? 0.45 : this.chain ? 0.025 : 0.055)
      ctx.stroke()
    }
  }

  private push(alpha: number, x: number, y: number, size: number): void {
    if (alpha <= 0.012 || x < -4 || y < -4 || x > this.width + 4 || y > this.height + 4) return
    const level = Math.min(ALPHA_LEVELS - 1, Math.floor(alpha * ALPHA_LEVELS))
    const xs = this.bucketX[level]
    const at = this.bucketCount[level]!
    if (!xs || at >= xs.length) return
    xs[at] = x
    this.bucketY[level]![at] = y
    this.bucketS[level]![at] = size
    this.bucketCount[level] = at + 1
  }

  /** One fill per alpha level: thousands of grains cost a handful of draw calls. */
  private flushBuckets(): void {
    const ctx = this.ctx
    for (let level = 0; level < ALPHA_LEVELS; level += 1) {
      const count = this.bucketCount[level]!
      if (!count) continue
      const xs = this.bucketX[level]!
      const ys = this.bucketY[level]!
      const sizes = this.bucketS[level]!
      ctx.beginPath()
      for (let index = 0; index < count; index += 1) {
        const size = sizes[index]!
        ctx.rect(xs[index]! - size / 2, ys[index]! - size / 2, size, size)
      }
      ctx.fillStyle = this.inkStyles[level]!
      ctx.fill()
    }
  }

  private collectDust(): void {
    const { scale, x: ox, y: oy } = this.view
    const time = this.time
    const sizeScale = clamp(scale * 1.15, 0.7, 1.9)
    const focus = this.focusCluster >= 0 ? this.model?.clusters[this.focusCluster] : undefined
    const dim = this.chain ? 0.6 : 1
    for (let index = 0; index < this.dustCount; index += 1) {
      const angle = this.dustAngle[index]! + this.dustSpeed[index]! * time
      const radius = this.dustRadius[index]! + Math.sin(this.dustPhase[index]! + time * 0.55) * 2.6
      const twinkle = 0.55 + 0.45 * Math.sin(this.dustPhase[index]! * 2.3 + time * (0.7 + (index % 7) * 0.13))
      let gain = dim
      if (focus) {
        let relative = (angle - focus.startAngle) % TAU
        if (relative < 0) relative += TAU
        gain = relative <= focus.endAngle - focus.startAngle ? 1.4 : dim * 0.8
      }
      this.push(this.dustAlpha[index]! * twinkle * gain, Math.cos(angle) * radius * scale + ox, Math.sin(angle) * radius * scale + oy, this.dustSize[index]! * sizeScale)
    }
  }

  private collectFlows(): void {
    if (!this.model) return
    const { scale, x: ox, y: oy } = this.view
    const geometry = this.edgeGeometry
    const sizeScale = clamp(scale, 0.75, 1.6)
    for (let index = 0; index < this.flowEdge.length; index += 1) {
      const edge = this.flowEdge[index]!
      if (!this.edgeVisible(edge)) continue
      const hot = this.edgeHot[edge] === 1
      const base = (hot ? 1 : 0.3 + this.edgeStrength[edge]! * 0.4) * (this.chain && !hot ? 0.15 : 1)
      const t = this.flowT[index]!
      const at = edge * 6
      for (let trail = 0; trail < 3; trail += 1) {
        const step = t - trail * 0.022
        if (step < 0) break
        const rest = 1 - step
        const x = rest * rest * geometry[at]! + 2 * rest * step * geometry[at + 2]! + step * step * geometry[at + 4]!
        const y = rest * rest * geometry[at + 1]! + 2 * rest * step * geometry[at + 3]! + step * step * geometry[at + 5]!
        const fade = Math.sin(Math.PI * step)
        this.push(base * fade * (1 - trail * 0.38), x * scale + ox, y * scale + oy, (hot ? 2.3 : 1.5) * sizeScale * (1 - trail * 0.22))
      }
    }
  }

  private collectCorona(): void {
    const { scale, x: ox, y: oy } = this.view
    const quiet = this.chain && !this.chain.has(CORE_ID) ? 0.4 : 1
    for (let index = 0; index < CORONA; index += 1) {
      const distance = this.coronaDistance[index]!
      const radius = RINGS.core * 0.55 + distance * 92
      const angle = this.coronaAngle[index]! + distance * 0.35
      this.push(Math.pow(1 - distance, 1.6) * 0.85 * quiet, Math.cos(angle) * radius * scale + ox, Math.sin(angle) * radius * scale + oy, this.coronaSize[index]! * clamp(scale, 0.8, 1.6))
    }
  }

  private drawCoreGlow(): void {
    const ctx = this.ctx
    const [cx, cy] = this.toScreen(0, 0)
    const pulse = 1 + Math.sin(this.time * 1.6) * 0.07
    const radius = RINGS.core * 2.6 * this.view.scale * pulse
    const strength = this.theme.dark ? 1 : 0.55
    const gradient = ctx.createRadialGradient(cx, cy, 0, cx, cy, radius)
    gradient.addColorStop(0, this.ink(0.6 * strength))
    gradient.addColorStop(0.28, this.ink(0.2 * strength))
    gradient.addColorStop(1, this.ink(0))
    ctx.fillStyle = gradient
    ctx.beginPath()
    ctx.arc(cx, cy, radius, 0, TAU)
    ctx.fill()
  }

  private drawNodes(): void {
    const model = this.model
    if (!model) return
    const ctx = this.ctx
    const scale = this.view.scale
    let halos = 0
    for (const node of model.nodes) {
      if (node.kind === 'core' || !this.layers[node.layer]) continue
      const [x, y] = this.toScreen(node.x, node.y)
      if (x < -24 || y < -24 || x > this.width + 24 || y > this.height + 24) continue
      const inChain = this.chain ? this.chain.has(node.id) : false
      const alpha = this.chain ? (inChain ? 1 : 0.18) : node.kind === 'session' ? 0.62 : node.kind === 'memory' ? 0.92 : 1
      const size = Math.max(node.kind === 'session' ? 1.6 : node.kind === 'memory' ? 2.4 : 4, node.size * scale)
      if (inChain && halos < MAX_HALOS) {
        halos += 1
        this.halo(x, y, size * 4.4, node.id === this.focusId ? 0.42 : 0.22)
      }
      this.drawShape(node.shape, node.kind, x, y, size, alpha)
      if (node.id === this.focusId) {
        ctx.beginPath()
        ctx.arc(x, y, size + 4, 0, TAU)
        ctx.lineWidth = 1.2
        ctx.strokeStyle = this.ink(0.85)
        ctx.stroke()
      }
    }
    const [cx, cy] = this.toScreen(0, 0)
    const radius = Math.max(17, RINGS.core * 0.62 * scale)
    ctx.beginPath()
    ctx.arc(cx, cy, radius, 0, TAU)
    ctx.globalAlpha = 0.84
    ctx.fillStyle = this.theme.background
    ctx.fill()
    ctx.globalAlpha = 1
    ctx.lineWidth = this.focusId === CORE_ID ? 1.6 : 1
    ctx.strokeStyle = this.ink(this.focusId === CORE_ID ? 0.9 : 0.5)
    ctx.stroke()
  }

  private halo(x: number, y: number, radius: number, alpha: number): void {
    const ctx = this.ctx
    ctx.globalCompositeOperation = this.theme.dark ? 'lighter' : 'source-over'
    const gradient = ctx.createRadialGradient(x, y, 0, x, y, radius)
    gradient.addColorStop(0, this.ink(alpha))
    gradient.addColorStop(1, this.ink(0))
    ctx.fillStyle = gradient
    ctx.beginPath()
    ctx.arc(x, y, radius, 0, TAU)
    ctx.fill()
    ctx.globalCompositeOperation = 'source-over'
  }

  /** Memory types read by shape, since the page has no colour to spend on them. */
  private drawShape(shape: MemoryShape, kind: GraphNode['kind'], x: number, y: number, size: number, alpha: number): void {
    const ctx = this.ctx
    ctx.beginPath()
    if (shape === 'diamond') {
      ctx.moveTo(x, y - size * 1.25)
      ctx.lineTo(x + size * 1.25, y)
      ctx.lineTo(x, y + size * 1.25)
      ctx.lineTo(x - size * 1.25, y)
      ctx.closePath()
    } else if (shape === 'square') {
      ctx.rect(x - size * 0.9, y - size * 0.9, size * 1.8, size * 1.8)
    } else if (shape === 'triangle') {
      ctx.moveTo(x, y - size * 1.25)
      ctx.lineTo(x + size * 1.1, y + size * 0.8)
      ctx.lineTo(x - size * 1.1, y + size * 0.8)
      ctx.closePath()
    } else {
      ctx.arc(x, y, size, 0, TAU)
    }
    if (shape === 'ring') {
      ctx.lineWidth = kind === 'index' ? 1.4 : 1
      ctx.strokeStyle = this.ink(alpha)
      ctx.stroke()
      return
    }
    ctx.fillStyle = this.ink(alpha)
    ctx.fill()
    if (kind === 'index') {
      ctx.beginPath()
      ctx.arc(x, y, size + 3.5, 0, TAU)
      ctx.lineWidth = 1
      ctx.strokeStyle = this.ink(alpha * 0.6)
      ctx.stroke()
    }
  }

  private drawLabels(): void {
    const ctx = this.ctx
    const scale = this.view.scale
    const font = this.theme.font
    ctx.textBaseline = 'middle'
    ctx.textAlign = 'center'
    const [cx, cy] = this.toScreen(0, 0)
    ctx.font = `600 13px ${font}`
    ctx.fillStyle = this.ink(0.95)
    ctx.fillText('L3', cx, cy - 7)
    ctx.font = `400 11px ${font}`
    ctx.fillStyle = this.ink(0.6)
    ctx.fillText('综合', cx, cy + 9)
    const model = this.model
    if (!model) return
    for (const cluster of model.clusters) {
      const focused = cluster.index === this.focusCluster
      const dim = this.focusCluster >= 0 && !focused ? 0.45 : 1
      const span = cluster.endAngle - cluster.startAngle
      const name = truncate(cluster.name, 18)
      const rows: Array<[GraphLayer, number, string]> = [
        ['L2', RINGS.L2.outer + 18, `${cluster.data.memoryTotal} 条记忆`],
        ['L1', RINGS.L1.outer + 20, `${cluster.data.sessionTotal} 次会话`],
      ]
      for (const [layer, radius, detail] of rows) {
        if (!this.layers[layer]) continue
        // A sliver of a wedge cannot hold a label without colliding with its neighbours.
        if (!focused && span * radius * scale < 36) continue
        ctx.font = `600 12px ${font}`
        const nameWidth = ctx.measureText(name).width
        ctx.font = `400 11px ${font}`
        const width = Math.max(nameWidth, ctx.measureText(detail).width)
        // The wedge the user points at keeps its label even with nowhere clear to put it.
        const spot = this.labelSpot(cluster, radius, width) ?? (focused ? this.labelAt(cluster.midAngle, radius) : null)
        if (!spot) continue
        const [x, y, align] = spot
        ctx.textAlign = align
        ctx.font = `600 12px ${font}`
        ctx.fillStyle = this.ink(0.92 * dim)
        ctx.fillText(name, x, y - 7)
        ctx.font = `400 11px ${font}`
        ctx.fillStyle = this.ink(0.55 * dim)
        ctx.fillText(detail, x, y + 8)
      }
    }
  }

  /** A wedge label's anchor at `angle`, and the side its text grows to. */
  private labelAt(angle: number, radius: number): LabelSpot {
    const [x, y] = this.toScreen(Math.cos(angle) * radius, Math.sin(angle) * radius)
    const cos = Math.cos(angle)
    return [x, y, cos > 0.3 ? 'left' : cos < -0.3 ? 'right' : 'center']
  }

  /**
   * The first spot along the wedge's arc, from its middle outwards, where a
   * two-line label `width` wide stays on the canvas and out from under the
   * page's panels. Null when the wedge has none.
   */
  private labelSpot(cluster: GraphCluster, radius: number, width: number): LabelSpot | null {
    const half = (cluster.endAngle - cluster.startAngle) / 2
    for (const step of LABEL_STEPS) {
      const spot = this.labelAt(cluster.midAngle + step * half, radius)
      const [x, y, align] = spot
      const left = align === 'left' ? x : align === 'right' ? x - width : x - width / 2
      const box: ScreenRect = { x: left - LABEL_MARGIN, y: y - 15 - LABEL_MARGIN, width: width + LABEL_MARGIN * 2, height: 30 + LABEL_MARGIN * 2 }
      if (box.x < 0 || box.y < 0 || box.x + box.width > this.width || box.y + box.height > this.height) continue
      if (this.occluders.some((rect) => overlaps(rect, box))) continue
      return spot
    }
    return null
  }
}

type LabelSpot = [x: number, y: number, align: CanvasTextAlign]

/** Where along its wedge a label may sit: fractions of the half-span, nearest the middle first. */
const LABEL_STEPS = [0, 0.3, -0.3, 0.6, -0.6, 0.85, -0.85]
/** Clearance a label keeps from the canvas edge and the panels over it. */
const LABEL_MARGIN = 6

function overlaps(a: ScreenRect, b: ScreenRect): boolean {
  return a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height
}

function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text
}
