import { useEffect, useRef, useState } from 'react'
import idleSheet from '../../assets/star-mascot/idle.webp'
import restingSheet from '../../assets/star-mascot/resting.webp'
import thinkingSheet from '../../assets/star-mascot/thinking.webp'
import workingSheet from '../../assets/star-mascot/working.webp'
import { cx } from '@/lib/cx'
import { useStarBrand } from '@/stores/starBrandStore'
import type { ChatState } from '../../types/chat'

export type MascotState = 'idle' | 'thinking' | 'working' | 'resting'

/**
 * The sheets are built by scripts/build-star-mascot-sprites.cjs from the
 * source vector animations: 151 frames of 160 px, 16 per row, played at the
 * source's 151 frames per 5.04 s.
 */
const SHEET = { frames: 151, columns: 16, cell: 160, fps: 151 / 5.041666667 }
const SHEETS: Record<MascotState, string> = { idle: idleSheet, thinking: thinkingSheet, working: workingSheet, resting: restingSheet }
export const MASCOT_STATE_LABELS: Record<MascotState, string> = { idle: '空闲', thinking: '思考中', working: '工作中', resting: '休息中' }
/** Idle this long, with no turn and no input, and the mascot takes a rest. */
export const MASCOT_REST_AFTER_MS = 3 * 60_000
/** CSS size of the mascot; it rises this much minus its 8px overlap above the card. */
export const COMPOSER_MASCOT_SIZE = 64
/**
 * Room the transcript keeps under its last row while the mascot is shown:
 * the part of the mascot above the card, plus the list's usual 16px.
 */
export const COMPOSER_MASCOT_INSET = COMPOSER_MASCOT_SIZE - 8 + 16

/** What the session is doing, as one of the mascot's four animations. */
export function mascotStateFor(chatState: ChatState | undefined): Exclude<MascotState, 'resting'> {
  switch (chatState) {
    case 'thinking':
    case 'compacting':
      return 'thinking'
    case 'streaming':
    case 'tool_executing':
      return 'working'
    default:
      // Idle, or waiting on the user's approval.
      return 'idle'
  }
}

const sheets = new Map<string, HTMLImageElement>()

function loadSheet(url: string): HTMLImageElement {
  let image = sheets.get(url)
  if (!image) {
    image = new Image()
    image.decoding = 'async'
    image.src = url
    sheets.set(url, image)
  }
  return image
}

/**
 * The STAR character on the composer's top-right corner: thinking while the
 * model thinks, working while it writes or runs tools, idle while waiting and
 * resting after a few quiet minutes. It plays on a canvas from a sprite sheet
 * and stops drawing whenever it is off screen, the window is in the back, or
 * its composer says so (`paused`: a tab kept mounted behind the active one).
 */
export function ComposerMascot({ chatState, paused = false, size = COMPOSER_MASCOT_SIZE, className }: { chatState?: ChatState; paused?: boolean; size?: number; className?: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const brand = useStarBrand()
  const active = mascotStateFor(chatState)
  const [resting, setResting] = useState(false)
  const state: MascotState = active === 'idle' && resting ? 'resting' : active

  useEffect(() => {
    if (active !== 'idle') {
      setResting(false)
      return
    }
    let timer = window.setTimeout(() => setResting(true), MASCOT_REST_AFTER_MS)
    const wake = () => {
      setResting(false)
      window.clearTimeout(timer)
      timer = window.setTimeout(() => setResting(true), MASCOT_REST_AFTER_MS)
    }
    window.addEventListener('keydown', wake)
    window.addEventListener('pointerdown', wake)
    return () => {
      window.clearTimeout(timer)
      window.removeEventListener('keydown', wake)
      window.removeEventListener('pointerdown', wake)
    }
  }, [active])

  // Fetch the other three sheets once this one is up, so a state change never blanks.
  useEffect(() => {
    const timer = window.setTimeout(() => {
      for (const url of Object.values(SHEETS)) loadSheet(url)
    }, 1500)
    return () => window.clearTimeout(timer)
  }, [])

  useEffect(() => {
    const canvas = canvasRef.current
    const context = canvas?.getContext('2d')
    if (!canvas || !context) return
    const dpr = Math.min(3, window.devicePixelRatio || 1)
    canvas.width = Math.round(size * dpr)
    canvas.height = Math.round(size * dpr)
    context.imageSmoothingQuality = 'high'
    const image = loadSheet(SHEETS[state])
    const reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false
    let raf = 0
    let frame = -1
    let onScreen = true
    const start = performance.now()

    const draw = (index: number): boolean => {
      if (!image.complete || !image.naturalWidth) return false
      context.clearRect(0, 0, canvas.width, canvas.height)
      context.drawImage(
        image,
        (index % SHEET.columns) * SHEET.cell,
        Math.floor(index / SHEET.columns) * SHEET.cell,
        SHEET.cell,
        SHEET.cell,
        0,
        0,
        canvas.width,
        canvas.height,
      )
      frame = index
      return true
    }
    const tick = (now: number) => {
      raf = requestAnimationFrame(tick)
      const index = Math.floor(((now - start) / 1000) * SHEET.fps) % SHEET.frames
      if (index !== frame) draw(index)
    }
    const sync = () => {
      cancelAnimationFrame(raf)
      raf = 0
      // Paused while its tab is kept mounted out of sight: nothing to draw for.
      if (paused) return
      if (reducedMotion) {
        draw(0)
        return
      }
      if (onScreen && !document.hidden) raf = requestAnimationFrame(tick)
    }
    const onLoad = () => sync()
    image.addEventListener('load', onLoad)
    const visibility = typeof IntersectionObserver === 'undefined'
      ? null
      : new IntersectionObserver(([entry]) => {
        onScreen = Boolean(entry?.isIntersecting)
        sync()
      })
    visibility?.observe(canvas)
    document.addEventListener('visibilitychange', sync)
    sync()
    return () => {
      cancelAnimationFrame(raf)
      image.removeEventListener('load', onLoad)
      visibility?.disconnect()
      document.removeEventListener('visibilitychange', sync)
    }
  }, [paused, size, state])

  return (
    <canvas
      ref={canvasRef}
      aria-hidden="true"
      data-testid="composer-mascot"
      data-mascot-state={state}
      title={`${brand.name} ${MASCOT_STATE_LABELS[state]}`}
      className={cx('pointer-events-none select-none', className)}
      style={{ width: size, height: size }}
    />
  )
}
