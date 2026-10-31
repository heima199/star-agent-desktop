import { CORE_ID, type GraphLayer, type GraphModel, type GraphNode } from './memoryGraphModel'
import type { GraphTheme, GraphView, Rgb, ScreenRect } from './memoryGraphRenderer'
import {
  NEBULA_TONE_TOKENS,
  PARTICLE_LAYERS,
  buildNebulaLayout,
  nebulaHitTest,
  particleAlpha,
  particleAt,
  seedNebulaParticles,
  type NebulaLayout,
  type NebulaParticles,
  type NebulaStar,
} from './memoryNebulaModel'

/**
 * Canvas renderer for the 记忆星云 form. It takes the same calls as
 * `MemoryGraphRenderer`, so the page drives either one the same way, and
 * draws the layout from `memoryNebulaModel`: soft hazes for the clouds,
 * thousands of drifting grains batched into a few dozen fills, a glowing
 * core for every important node and faint threads for the links.
 *
 * Colours come from the theme the page reads off the root (the ink, the
 * ground and the categorical series tokens). On a dark ground the light adds
 * up into a glow; on a light one the same field reads as tinted dust.
 */

/** The graph's theme plus one colour per nebula tone, in `NEBULA_TONE_TOKENS` order. */
export type NebulaTheme = GraphTheme & { tones: Rgb[] }

const TAU = Math.PI * 2
const TONES = NEBULA_TONE_TOKENS.length
const ALPHA_LEVELS = 5
/** Stars drawn with a glow sprite per frame; dimmer ones join the grain batches. */
const MAX_GLOWS = 240
/** Stars at least this important get a glowing core. */
const GLOW_IMPORTANCE = 0.42
const SPRITE_SIZE = 64
const LABEL_MARGIN = 6

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value))
const rgba = ([r, g, b]: Rgb, alpha: number) => `rgba(${r}, ${g}, ${b}, ${clamp(alpha, 0, 1).toFixed(3)})`
const mix = (from: Rgb, to: Rgb, t: number): Rgb => [
  Math.round(from[0] + (to[0] - from[0]) * t),
  Math.round(from[1] + (to[1] - from[1]) * t),
  Math.round(from[2] + (to[2] - from[2]) * t),
]

function overlaps(a: ScreenRect, b: ScreenRect): boolean {
  return a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height
}

export class MemoryNebulaRenderer {
  private readonly ctx: CanvasRenderingContext2D
  private theme: NebulaTheme
  private layout: NebulaLayout | null = null
  private particles: NebulaParticles = seedNebulaParticles(null, 0)
  private budget = 0
  private width = 0
  private height = 0
  private dpr = 1
  private view: GraphView = { scale: 1, x: 0, y: 0 }
  private chain: Set<string> | null = null
  private focusId: string | null = null
  private focusGroup = -1
  private layers: Record<GraphLayer, boolean> = { L3: true, L2: true, L1: true }
  private occluders: ScreenRect[] = []
  private readonly reducedMotion: boolean
  private raf = 0
  private lastTick = 0
  private time = 0
  private running = false
  /** `tone * ALPHA_LEVELS + level` → fill style. */
  private grainStyles: string[] = []
  /** Per tone: the opaque colour of a star's bright core. */
  private coreStyles: string[] = []
  /** Per tone: a soft radial glow, drawn scaled. */
  private sprites: Array<HTMLCanvasElement | null> = []
  private starHot = new Uint8Array(0)
  private bucketX: Float32Array[] = []
  private bucketY: Float32Array[] = []
  private bucketS: Float32Array[] = []
  private readonly bucketCount = new Int32Array(TONES * ALPHA_LEVELS)
  private readonly point = new Float32Array(2)

  constructor(private readonly canvas: HTMLCanvasElement, theme: NebulaTheme, reducedMotion: boolean) {
    const context = canvas.getContext('2d')
    if (!context) throw new Error('2D canvas unavailable')
    this.ctx = context
    this.theme = theme
    this.reducedMotion = reducedMotion
    this.buildStyles()
  }

  setTheme(theme: NebulaTheme): void {
    this.theme = theme
    this.buildStyles()
    this.requestDraw()
  }

  setSize(width: number, height: number, dpr: number): void {
    this.width = width
    this.height = height
    this.dpr = dpr
    this.canvas.width = Math.max(1, Math.round(width * dpr))
    this.canvas.height = Math.max(1, Math.round(height * dpr))
    // Grains follow the area, so a large window is as dense as a small one.
    const wanted = Math.round(clamp((width * height) / 210, 1200, 4200))
    if (Math.abs(wanted - this.budget) > this.budget * 0.2) {
      this.budget = wanted
      this.reseed()
    }
    this.requestDraw()
  }

  setView(view: GraphView): void {
    this.view = view
    this.requestDraw()
  }

  setModel(model: GraphModel | null): void {
    this.layout = model ? buildNebulaLayout(model) : null
    this.reseed()
    this.applyChain()
    this.requestDraw()
  }

  /** The highlighted chain (hover or lock) and the node the user points at. Project wedges do not apply here. */
  setFocus(chain: Set<string> | null, focusId: string | null, _focusCluster: number): void {
    this.chain = chain
    this.focusId = focusId
    this.applyChain()
    this.requestDraw()
  }

  setLayers(layers: Record<GraphLayer, boolean>): void {
    this.layers = { ...layers }
    this.requestDraw()
  }

  /** Panels the page lays over the canvas; cloud labels stay out from under them. */
  setOccluders(rects: ScreenRect[]): void {
    this.occluders = rects
    this.requestDraw()
  }

  /** Runs the one animation loop; reduced motion gets a single still frame instead. */
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
      this.time += Math.min(0.05, Math.max(0, (now - this.lastTick) / 1000))
      this.lastTick = now
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
    this.layout = null
    this.particles = seedNebulaParticles(null, 0)
  }

  /** Draws one frame now when the loop is not running (paused or reduced motion). */
  requestDraw(): void {
    if (!this.running || this.reducedMotion) this.draw()
  }

  hitTest(x: number, y: number): GraphNode | null {
    return nebulaHitTest(this.layout, this.view, x, y, this.layers)
  }

  /** The nebula has no project wedges. */
  clusterAt(_x: number, _y: number): number {
    return -1
  }

  // ── setup ────────────────────────────────────────────────

  private tone(index: number): Rgb {
    return this.theme.tones[index] ?? this.theme.ink
  }

  private ink(alpha: number): string {
    return rgba(this.theme.ink, alpha)
  }

  private buildStyles(): void {
    // Light grounds need denser colour to read; dark ones glow additively.
    const top = this.theme.dark ? 0.95 : 0.85
    this.grainStyles = []
    for (let tone = 0; tone < TONES; tone += 1) {
      for (let level = 0; level < ALPHA_LEVELS; level += 1) {
        this.grainStyles.push(rgba(this.tone(tone), top * Math.pow((level + 1) / ALPHA_LEVELS, 1.3)))
      }
    }
    this.coreStyles = Array.from({ length: TONES }, (_, tone) => rgba(mix(this.tone(tone), this.theme.ink, this.theme.dark ? 0.45 : 0.15), 1))
    this.sprites = Array.from({ length: TONES }, (_, tone) => this.buildSprite(this.tone(tone)))
  }

  private buildSprite(color: Rgb): HTMLCanvasElement | null {
    const sprite = document.createElement('canvas')
    sprite.width = SPRITE_SIZE
    sprite.height = SPRITE_SIZE
    const ctx = sprite.getContext('2d')
    if (!ctx) return null
    const half = SPRITE_SIZE / 2
    const gradient = ctx.createRadialGradient(half, half, 0, half, half, half)
    gradient.addColorStop(0, rgba(color, 1))
    gradient.addColorStop(0.2, rgba(color, 0.5))
    gradient.addColorStop(0.5, rgba(color, 0.14))
    gradient.addColorStop(1, rgba(color, 0))
    ctx.fillStyle = gradient
    ctx.fillRect(0, 0, SPRITE_SIZE, SPRITE_SIZE)
    return sprite
  }

  private reseed(): void {
    this.particles = seedNebulaParticles(this.layout, this.budget)
    // A bucket may receive every grain and star of its tone, so it is sized for that.
    const perTone = new Int32Array(TONES)
    for (let index = 0; index < this.particles.count; index += 1) perTone[this.particles.tone[index]!]! += 1
    for (const star of this.layout?.stars ?? []) perTone[star.tone]! += 1
    for (let tone = 0; tone < TONES; tone += 1) {
      for (let level = 0; level < ALPHA_LEVELS; level += 1) {
        const bucket = tone * ALPHA_LEVELS + level
        this.bucketX[bucket] = new Float32Array(perTone[tone]!)
        this.bucketY[bucket] = new Float32Array(perTone[tone]!)
        this.bucketS[bucket] = new Float32Array(perTone[tone]!)
      }
    }
  }

  private applyChain(): void {
    const stars = this.layout?.stars ?? []
    this.starHot = new Uint8Array(stars.length)
    this.focusGroup = -1
    stars.forEach((star, index) => {
      if (this.chain?.has(star.node.id)) this.starHot[index] = 1
      if (star.node.id === this.focusId) this.focusGroup = star.group
    })
  }

  private visible(star: NebulaStar): boolean {
    return !star.layer || this.layers[star.layer]
  }

  // ── drawing ──────────────────────────────────────────────

  private draw(): void {
    const ctx = this.ctx
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0)
    ctx.globalCompositeOperation = 'source-over'
    ctx.globalAlpha = 1
    ctx.fillStyle = this.theme.background
    ctx.fillRect(0, 0, this.width, this.height)
    const glow: GlobalCompositeOperation = this.theme.dark ? 'lighter' : 'source-over'
    ctx.globalCompositeOperation = glow
    this.drawHaze()
    ctx.globalCompositeOperation = 'source-over'
    this.drawLinks()
    ctx.globalCompositeOperation = glow
    this.bucketCount.fill(0)
    this.collectGrains()
    const bright = this.collectStars()
    this.flushGrains()
    this.drawBrightStars(bright)
    this.drawCore()
    ctx.globalAlpha = 1
    ctx.globalCompositeOperation = 'source-over'
    this.drawFocusRing()
    this.drawLabels()
  }

  /** One soft glow per cloud, breathing slowly; the index halo is a ring round the core. */
  private drawHaze(): void {
    const layout = this.layout
    if (!layout) return
    const ctx = this.ctx
    const { scale } = this.view
    const strength = this.theme.dark ? 1 : 0.6
    layout.groups.forEach((group, index) => {
      if (!this.layers[group.layer]) return
      const cx = group.x * scale + this.view.x
      const cy = group.y * scale + this.view.y
      const radius = group.radius * scale * 1.3
      if (cx + radius < 0 || cy + radius < 0 || cx - radius > this.width || cy - radius > this.height) return
      const quiet = this.chain && this.focusGroup !== index ? 0.5 : 1
      const breath = 1 + Math.sin(this.time * 0.4 + index * 1.7) * 0.08
      const peak = 0.13 * strength * quiet * breath
      const color = this.tone(group.tone)
      const gradient = ctx.createRadialGradient(cx, cy, 0, cx, cy, radius)
      if (group.key === 'index') {
        gradient.addColorStop(0, rgba(color, 0))
        gradient.addColorStop(0.45, rgba(color, peak))
        gradient.addColorStop(0.75, rgba(color, peak * 0.4))
      } else {
        gradient.addColorStop(0, rgba(color, peak))
        gradient.addColorStop(0.45, rgba(color, peak * 0.45))
      }
      gradient.addColorStop(1, rgba(color, 0))
      ctx.fillStyle = gradient
      ctx.beginPath()
      ctx.arc(cx, cy, radius, 0, TAU)
      ctx.fill()
    })
  }

  private drawLinks(): void {
    const layout = this.layout
    if (!layout || layout.links.length === 0) return
    const ctx = this.ctx
    const { scale, x: ox, y: oy } = this.view
    for (const hot of [false, true]) {
      ctx.beginPath()
      let drawn = 0
      for (const link of layout.links) {
        const from = layout.stars[link.from]!
        const to = layout.stars[link.to]!
        if (!this.visible(from) || !this.visible(to)) continue
        if ((this.starHot[link.from] === 1 && this.starHot[link.to] === 1) !== hot) continue
        ctx.moveTo(from.x * scale + ox, from.y * scale + oy)
        ctx.lineTo(to.x * scale + ox, to.y * scale + oy)
        drawn += 1
      }
      if (!drawn) continue
      ctx.lineWidth = hot ? 1.1 : 0.6
      ctx.strokeStyle = this.ink(hot ? 0.42 : this.chain ? 0.025 : this.theme.dark ? 0.05 : 0.07)
      ctx.stroke()
    }
  }

  private push(tone: number, alpha: number, x: number, y: number, size: number): void {
    if (alpha <= 0.015 || x < -4 || y < -4 || x > this.width + 4 || y > this.height + 4) return
    const bucket = tone * ALPHA_LEVELS + Math.min(ALPHA_LEVELS - 1, Math.floor(alpha * ALPHA_LEVELS))
    const xs = this.bucketX[bucket]
    const at = this.bucketCount[bucket]!
    if (!xs || at >= xs.length) return
    xs[at] = x
    this.bucketY[bucket]![at] = y
    this.bucketS[bucket]![at] = size
    this.bucketCount[bucket] = at + 1
  }

  private collectGrains(): void {
    const p = this.particles
    const { scale, x: ox, y: oy } = this.view
    const time = this.time
    const sizeScale = clamp(scale * 1.1, 0.7, 1.8)
    const point = this.point
    for (let index = 0; index < p.count; index += 1) {
      const layer = PARTICLE_LAYERS[p.layer[index]!]
      if (layer && !this.layers[layer]) continue
      particleAt(p, index, time, point)
      const star = p.star[index]!
      // A lit chain keeps its own swarms bright and lets the rest of the sky recede.
      const gain = this.chain ? (star >= 0 && this.starHot[star] === 1 ? 1.35 : 0.5) : 1
      this.push(p.tone[index]!, particleAlpha(p, index, time) * gain, point[0]! * scale + ox, point[1]! * scale + oy, p.size[index]! * sizeScale)
    }
  }

  /** Batches the dim stars with the grains and returns the ones that get a glow. */
  private collectStars(): number[] {
    const layout = this.layout
    if (!layout) return []
    const { scale, x: ox, y: oy } = this.view
    const bright: number[] = []
    layout.stars.forEach((star, index) => {
      if (star.group < 0 || !this.visible(star)) return
      const x = star.x * scale + ox
      const y = star.y * scale + oy
      if (x < -30 || y < -30 || x > this.width + 30 || y > this.height + 30) return
      const hot = this.starHot[index] === 1
      if ((hot || star.importance >= GLOW_IMPORTANCE || star.node.id === this.focusId) && bright.length < MAX_GLOWS) {
        bright.push(index)
        return
      }
      this.push(star.tone, this.starAlpha(star, index), x, y, Math.max(1.4, star.size * scale))
    })
    return bright
  }

  private starAlpha(star: NebulaStar, index: number): number {
    const twinkle = 0.86 + 0.14 * Math.sin(this.time * 1.1 + index * 2.39)
    return (this.chain ? (this.starHot[index] === 1 ? 1 : 0.2) : 0.5 + 0.5 * star.importance) * twinkle
  }

  private flushGrains(): void {
    const ctx = this.ctx
    for (let bucket = 0; bucket < this.bucketCount.length; bucket += 1) {
      const count = this.bucketCount[bucket]!
      if (!count) continue
      const xs = this.bucketX[bucket]!
      const ys = this.bucketY[bucket]!
      const sizes = this.bucketS[bucket]!
      ctx.beginPath()
      for (let index = 0; index < count; index += 1) {
        const size = sizes[index]!
        ctx.rect(xs[index]! - size / 2, ys[index]! - size / 2, size, size)
      }
      ctx.fillStyle = this.grainStyles[bucket]!
      ctx.fill()
    }
  }

  /** The important stars: a glow sprite and a bright disc each. */
  private drawBrightStars(bright: number[]): void {
    const layout = this.layout
    if (!layout) return
    const ctx = this.ctx
    const { scale, x: ox, y: oy } = this.view
    const glowScale = clamp(scale, 0.6, 1.8)
    const glowStrength = this.theme.dark ? 0.75 : 0.45
    for (const index of bright) {
      const star = layout.stars[index]!
      const x = star.x * scale + ox
      const y = star.y * scale + oy
      const alpha = this.starAlpha(star, index)
      const sprite = this.sprites[star.tone]
      if (sprite) {
        const glow = (star.size * 3.2 + 4) * glowScale
        ctx.globalAlpha = clamp(alpha * glowStrength, 0, 1)
        ctx.drawImage(sprite, x - glow, y - glow, glow * 2, glow * 2)
      }
      ctx.globalAlpha = clamp(alpha, 0, 1)
      ctx.fillStyle = this.coreStyles[star.tone]!
      ctx.beginPath()
      ctx.arc(x, y, Math.max(1.5, star.size * scale * 0.5), 0, TAU)
      ctx.fill()
    }
    ctx.globalAlpha = 1
  }

  /** The synthesis everything flows into: the largest, brightest star. */
  private drawCore(): void {
    const ctx = this.ctx
    const { scale } = this.view
    const x = this.view.x
    const y = this.view.y
    const quiet = this.chain && !this.chain.has(CORE_ID) ? 0.45 : 1
    const pulse = this.reducedMotion ? 1 : 1 + Math.sin(this.time * 1.2) * 0.06
    const strength = this.theme.dark ? 1 : 0.6
    const radius = Math.max(28, 64 * scale) * pulse
    const gradient = ctx.createRadialGradient(x, y, 0, x, y, radius)
    gradient.addColorStop(0, this.ink(0.5 * strength * quiet))
    gradient.addColorStop(0.3, this.ink(0.16 * strength * quiet))
    gradient.addColorStop(1, this.ink(0))
    ctx.fillStyle = gradient
    ctx.beginPath()
    ctx.arc(x, y, radius, 0, TAU)
    ctx.fill()
    ctx.globalAlpha = quiet
    ctx.fillStyle = this.coreStyles[0]!
    ctx.beginPath()
    ctx.arc(x, y, Math.max(4.5, 9 * scale * 0.6), 0, TAU)
    ctx.fill()
    ctx.globalAlpha = 1
  }

  private drawFocusRing(): void {
    const layout = this.layout
    const index = this.focusId ? layout?.starIndex.get(this.focusId) : undefined
    if (!layout || index === undefined) return
    const star = layout.stars[index]!
    if (!this.visible(star)) return
    const { scale } = this.view
    const radius = star.group < 0 ? Math.max(4.5, 9 * scale * 0.6) : Math.max(1.5, star.size * scale * 0.5)
    const ctx = this.ctx
    ctx.beginPath()
    ctx.arc(star.x * scale + this.view.x, star.y * scale + this.view.y, radius + 5, 0, TAU)
    ctx.lineWidth = 1.2
    ctx.strokeStyle = this.ink(0.85)
    ctx.stroke()
  }

  /** The core's name, and each cloud's kind and size above it, kept clear of the panels and of each other. */
  private drawLabels(): void {
    const ctx = this.ctx
    const font = this.theme.font
    const { scale } = this.view
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.font = `600 12px ${font}`
    ctx.fillStyle = this.ink(this.chain && !this.chain.has(CORE_ID) ? 0.4 : 0.85)
    ctx.fillText('综合', this.view.x, this.view.y + Math.max(4.5, 9 * scale * 0.6) + 14)
    const layout = this.layout
    if (!layout) return
    const taken: ScreenRect[] = []
    layout.groups.forEach((group, index) => {
      if (!this.layers[group.layer]) return
      const text = `${group.label} · ${group.count}`
      const x = group.x * scale + this.view.x
      // Clouds are labelled over their top edge; the index halo under its bottom edge, clear of the core.
      const y = group.key === 'index' ? this.view.y + group.radius * scale + 12 : group.y * scale + this.view.y - group.radius * scale - 10
      const width = ctx.measureText(text).width
      const box: ScreenRect = { x: x - width / 2 - LABEL_MARGIN, y: y - 8 - LABEL_MARGIN, width: width + LABEL_MARGIN * 2, height: 16 + LABEL_MARGIN * 2 }
      if (box.x < 0 || box.y < 0 || box.x + box.width > this.width || box.y + box.height > this.height) return
      if (this.occluders.some((rect) => overlaps(rect, box)) || taken.some((rect) => overlaps(rect, box))) return
      taken.push(box)
      ctx.fillStyle = this.ink((this.chain && this.focusGroup !== index ? 0.35 : 0.72))
      ctx.fillText(text, x, y)
    })
  }
}
