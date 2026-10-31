import { useCallback, useEffect, useRef, useState, type CSSProperties, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent } from 'react'
import { Loader2, Maximize, Minimize, Pause, Play, RotateCcw, Volume2, VolumeX } from 'lucide-react'
import { cx } from '@/lib/cx'

export type StarVideoPlayerProps = {
  src: string
  /** Sizes the frame. The video follows its own aspect inside it. */
  className?: string
  /** Sizes the <video> (max height in a chat, viewport bounds in the viewer). */
  videoClassName?: string
  style?: CSSProperties
  autoPlay?: boolean
  loop?: boolean
  muted?: boolean
  poster?: string
  /** Counter-scales the control bar when the player sits inside a zoomed canvas. */
  chromeScale?: number
  onError?: () => void
  /** Accessible name of the player. */
  label?: string
}

const HIDE_AFTER_MS = 2600
const HINT_FOR_MS = 2600
const SEEK_STEP_S = 5
const RATIOS: Array<[number, string]> = [
  [16 / 9, '16:9'], [9 / 16, '9:16'], [4 / 3, '4:3'], [3 / 4, '3:4'], [1, '1:1'], [21 / 9, '21:9'], [3 / 2, '3:2'], [2 / 3, '2:3'],
]
/** Round icon buttons on the bar, in the lightbox palette every theme shares. */
const ICON_BUTTON = 'flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[var(--color-lightbox-control-bg)] opacity-85 transition-opacity hover:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-lightbox-control-bg)]'

export function formatClock(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '00:00'
  const total = Math.floor(seconds)
  const hours = Math.floor(total / 3600)
  const pad = (value: number) => String(value).padStart(2, '0')
  const rest = `${pad(Math.floor((total % 3600) / 60))}:${pad(total % 60)}`
  return hours > 0 ? `${hours}:${rest}` : rest
}

/** The nearest common ratio name ("9:16"), or the pixel size when none is close. */
export function ratioLabel(width: number, height: number): string | null {
  if (!width || !height) return null
  const ratio = width / height
  let best = RATIOS[0]!
  let distance = Number.POSITIVE_INFINITY
  for (const entry of RATIOS) {
    const next = Math.abs(Math.log(entry[0] / ratio))
    if (next < distance) {
      distance = next
      best = entry
    }
  }
  return distance < 0.04 ? best[1] : `${width}×${height}`
}

/**
 * The one video player of the app: a floating control bar under the picture
 * (progress, play, replay, time, volume, picture ratio, fullscreen) that hides
 * while playing and comes back on any mouse move, tap or key.
 */
export function StarVideoPlayer({ src, className, videoClassName, style, autoPlay = false, loop = false, muted = false, poster, chromeScale = 1, onError, label = '视频播放器' }: StarVideoPlayerProps) {
  const rootRef = useRef<HTMLDivElement>(null)
  const videoRef = useRef<HTMLVideoElement>(null)
  const trackRef = useRef<HTMLDivElement>(null)
  const hideTimer = useRef<number | undefined>(undefined)
  const hintTimer = useRef<number | undefined>(undefined)
  const hintedRef = useRef(false)
  const [playing, setPlaying] = useState(false)
  const [current, setCurrent] = useState(0)
  const [duration, setDuration] = useState(0)
  const [buffered, setBuffered] = useState(0)
  const [volume, setVolume] = useState(1)
  const [isMuted, setIsMuted] = useState(muted)
  const [waiting, setWaiting] = useState(false)
  const [controlsVisible, setControlsVisible] = useState(true)
  const [hint, setHint] = useState(false)
  const [fullscreen, setFullscreen] = useState(false)
  const [fit, setFit] = useState<'contain' | 'cover'>('contain')
  const [ratio, setRatio] = useState<string | null>(null)
  const [scrubbing, setScrubbing] = useState(false)

  const hideLater = useCallback(() => {
    window.clearTimeout(hideTimer.current)
    hideTimer.current = window.setTimeout(() => {
      const video = videoRef.current
      if (!video || video.paused) return
      setControlsVisible(false)
      // The first time the bar goes away, say how to bring it back.
      if (!hintedRef.current) {
        hintedRef.current = true
        setHint(true)
        window.clearTimeout(hintTimer.current)
        hintTimer.current = window.setTimeout(() => setHint(false), HINT_FOR_MS)
      }
    }, HIDE_AFTER_MS)
  }, [])

  /** Any sign of the user: show the bar, and hide it again later while playing. */
  const poke = useCallback(() => {
    setControlsVisible(true)
    setHint(false)
    if (videoRef.current && !videoRef.current.paused) hideLater()
  }, [hideLater])

  useEffect(() => () => {
    window.clearTimeout(hideTimer.current)
    window.clearTimeout(hintTimer.current)
  }, [])

  useEffect(() => {
    const onChange = () => setFullscreen(document.fullscreenElement === rootRef.current)
    document.addEventListener('fullscreenchange', onChange)
    return () => document.removeEventListener('fullscreenchange', onChange)
  }, [])

  const togglePlay = useCallback(() => {
    const video = videoRef.current
    if (!video) return
    if (video.paused || video.ended) void video.play().catch(() => undefined)
    else video.pause()
  }, [])

  const replay = () => {
    const video = videoRef.current
    if (!video) return
    video.currentTime = 0
    void video.play().catch(() => undefined)
    poke()
  }

  const seekTo = (seconds: number) => {
    const video = videoRef.current
    if (!video || !Number.isFinite(video.duration)) return
    video.currentTime = Math.min(video.duration, Math.max(0, seconds))
    setCurrent(video.currentTime)
  }

  const seekFromPointer = (clientX: number) => {
    const track = trackRef.current
    if (!track || !duration) return
    const rect = track.getBoundingClientRect()
    seekTo(((clientX - rect.left) / Math.max(1, rect.width)) * duration)
  }

  const toggleMute = () => {
    const video = videoRef.current
    if (!video) return
    video.muted = !video.muted
    if (!video.muted && video.volume === 0) video.volume = 0.6
  }

  const changeVolume = (next: number) => {
    const video = videoRef.current
    if (!video) return
    video.volume = Math.min(1, Math.max(0, next))
    video.muted = video.volume === 0
  }

  const toggleFullscreen = useCallback(() => {
    const root = rootRef.current
    if (!root) return
    if (document.fullscreenElement) void document.exitFullscreen().catch(() => undefined)
    else void root.requestFullscreen?.().catch(() => undefined)
  }, [])

  const onKeyDown = (event: ReactKeyboardEvent) => {
    if (event.target instanceof HTMLInputElement) return
    const video = videoRef.current
    if (!video) return
    const key = event.key.toLowerCase()
    if (key === ' ' || key === 'k') togglePlay()
    else if (key === 'arrowleft') seekTo(video.currentTime - SEEK_STEP_S)
    else if (key === 'arrowright') seekTo(video.currentTime + SEEK_STEP_S)
    else if (key === 'arrowup') changeVolume(video.volume + 0.1)
    else if (key === 'arrowdown') changeVolume(video.volume - 0.1)
    else if (key === 'm') toggleMute()
    else if (key === 'f') toggleFullscreen()
    else return
    event.preventDefault()
    poke()
  }

  const onTrackPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    event.stopPropagation()
    event.currentTarget.setPointerCapture(event.pointerId)
    setScrubbing(true)
    seekFromPointer(event.clientX)
  }

  const played = duration ? Math.min(100, (current / duration) * 100) : 0
  const loaded = duration ? Math.min(100, (buffered / duration) * 100) : 0
  const silent = isMuted || volume === 0
  const chrome: CSSProperties | undefined = chromeScale !== 1
    ? { transform: `scale(${chromeScale})`, transformOrigin: 'bottom left', width: `${100 / chromeScale}%` }
    : undefined

  return (
    <div
      ref={rootRef}
      role="group"
      aria-label={label}
      tabIndex={0}
      data-testid="star-video-player"
      className={cx(
        'group/player relative overflow-hidden bg-[var(--color-media-bg)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-border-focus)]',
        fullscreen ? 'flex h-full w-full items-center justify-center' : '',
        !controlsVisible && playing ? 'cursor-none' : '',
        className,
      )}
      style={style}
      onPointerMove={poke}
      onPointerDown={poke}
      onFocus={poke}
      onKeyDown={onKeyDown}
    >
      <video
        ref={videoRef}
        src={src}
        poster={poster}
        autoPlay={autoPlay}
        loop={loop}
        muted={muted}
        playsInline
        preload="metadata"
        className={cx('block', fit === 'cover' ? 'object-cover' : 'object-contain', fullscreen ? 'h-full w-full' : videoClassName ?? 'w-full')}
        onClick={togglePlay}
        onDoubleClick={toggleFullscreen}
        onPlay={() => { setPlaying(true); hideLater() }}
        onPause={() => { setPlaying(false); setControlsVisible(true) }}
        onEnded={() => { setPlaying(false); setControlsVisible(true) }}
        onTimeUpdate={(event) => { if (!scrubbing) setCurrent(event.currentTarget.currentTime) }}
        onLoadedMetadata={(event) => {
          const video = event.currentTarget
          setDuration(Number.isFinite(video.duration) ? video.duration : 0)
          setRatio(ratioLabel(video.videoWidth, video.videoHeight))
        }}
        onDurationChange={(event) => setDuration(Number.isFinite(event.currentTarget.duration) ? event.currentTarget.duration : 0)}
        onProgress={(event) => {
          const ranges = event.currentTarget.buffered
          setBuffered(ranges.length ? ranges.end(ranges.length - 1) : 0)
        }}
        onWaiting={() => setWaiting(true)}
        onPlaying={() => setWaiting(false)}
        onCanPlay={() => setWaiting(false)}
        onVolumeChange={(event) => { setVolume(event.currentTarget.volume); setIsMuted(event.currentTarget.muted) }}
        onError={() => onError?.()}
      />

      {waiting ? (
        <span className="pointer-events-none absolute inset-0 flex items-center justify-center"><Loader2 size={28} className="animate-spin text-[var(--color-lightbox-control-bg)]" aria-label="正在缓冲" /></span>
      ) : null}

      {hint && !controlsVisible ? (
        <span className="pointer-events-none absolute inset-x-0 bottom-6 text-center text-[12px] text-[var(--color-lightbox-control-bg)] opacity-80">移动鼠标或轻触画面，显示控制</span>
      ) : null}

      <div
        className={cx(
          // A container, so a narrow player drops replay and the ratio before the time.
          '@container absolute inset-x-3 bottom-3 transition-[opacity,transform] duration-200 motion-reduce:transition-none',
          controlsVisible ? 'opacity-100' : 'pointer-events-none translate-y-1 opacity-0',
        )}
        style={chrome}
        // The bar is the player's own: a click on it must not toggle playback,
        // and a press must not start a drag in a host (the design canvas).
        onPointerDown={(event) => { event.stopPropagation(); poke() }}
        onClick={(event) => event.stopPropagation()}
        onDoubleClick={(event) => event.stopPropagation()}
      >
        <div className="rounded-[var(--radius-lg)] bg-[var(--color-lightbox-scrim)] px-4 pb-2.5 pt-2.5 backdrop-blur-md">
          <div
            ref={trackRef}
            role="slider"
            tabIndex={0}
            aria-label="播放进度"
            aria-valuemin={0}
            aria-valuemax={Math.round(duration)}
            aria-valuenow={Math.round(current)}
            aria-valuetext={`${formatClock(current)} / ${formatClock(duration)}`}
            className="relative h-4 cursor-pointer focus-visible:outline-none"
            onPointerDown={onTrackPointerDown}
            onPointerMove={(event) => { if (scrubbing) seekFromPointer(event.clientX) }}
            onPointerUp={(event) => {
              setScrubbing(false)
              if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
            }}
          >
            <span className="absolute inset-x-0 top-1/2 h-[3px] -translate-y-1/2 rounded-full bg-[var(--color-lightbox-control-bg)] opacity-25" />
            <span className="absolute left-0 top-1/2 h-[3px] -translate-y-1/2 rounded-full bg-[var(--color-lightbox-control-bg)] opacity-25" style={{ width: `${loaded}%` }} />
            <span className="absolute left-0 top-1/2 h-[3px] -translate-y-1/2 rounded-full bg-[var(--color-lightbox-control-bg)]" style={{ width: `${played}%` }} />
            <span className="absolute top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full bg-[var(--color-lightbox-control-bg)] shadow-[var(--shadow-dropdown)]" style={{ left: `${played}%` }} />
          </div>
          <div className="mt-1.5 flex items-center gap-2.5 text-[var(--color-lightbox-control-bg)]">
            <button
              type="button"
              aria-label={playing ? '暂停' : '播放'}
              onClick={togglePlay}
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[var(--color-lightbox-control-bg)] text-[var(--color-lightbox-control-fg)] transition-transform hover:scale-105 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-lightbox-control-bg)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--color-media-bg)]"
            >
              {playing ? <Pause size={15} fill="currentColor" aria-hidden="true" /> : <Play size={15} fill="currentColor" className="ml-0.5" aria-hidden="true" />}
            </button>
            <span className="hidden shrink-0 @xs:flex">
              <button type="button" aria-label="重新播放" title="重新播放" onClick={replay} className={ICON_BUTTON}><RotateCcw size={16} aria-hidden="true" /></button>
            </span>
            <span className="min-w-0 truncate text-[13px] tabular-nums">
              <span className="font-semibold">{formatClock(current)}</span>
              <span className="opacity-60"> / {formatClock(duration)}</span>
            </span>
            <span className="flex-1" />
            <span className="group/volume flex items-center">
              <input
                type="range"
                min={0}
                max={1}
                step={0.05}
                value={silent ? 0 : volume}
                aria-label="音量"
                onChange={(event) => changeVolume(Number(event.currentTarget.value))}
                className="w-0 cursor-pointer opacity-0 transition-[width,opacity] duration-150 [accent-color:var(--color-lightbox-control-bg)] focus:w-16 focus:opacity-100 group-hover/volume:w-16 group-hover/volume:opacity-100"
              />
              <button type="button" aria-label={silent ? '取消静音' : '静音'} title={silent ? '取消静音' : '静音'} onClick={toggleMute} className={ICON_BUTTON}>
                {silent ? <VolumeX size={16} aria-hidden="true" /> : <Volume2 size={16} aria-hidden="true" />}
              </button>
            </span>
            {ratio ? (
              <button
                type="button"
                onClick={() => setFit((value) => (value === 'contain' ? 'cover' : 'contain'))}
                title={`画面比例 ${ratio} · 点击${fit === 'contain' ? '铺满画面' : '完整显示'}`}
                aria-label={`画面比例 ${ratio}，${fit === 'contain' ? '完整显示' : '铺满画面'}`}
                className="hidden shrink-0 rounded-[var(--radius-sm)] px-1.5 text-[13px] font-semibold tabular-nums opacity-85 transition-opacity hover:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-lightbox-control-bg)] @sm:block"
              >
                {ratio}
              </button>
            ) : null}
            <button type="button" aria-label={fullscreen ? '退出全屏' : '全屏'} title={fullscreen ? '退出全屏' : '全屏'} onClick={toggleFullscreen} className={ICON_BUTTON}>
              {fullscreen ? <Minimize size={16} aria-hidden="true" /> : <Maximize size={16} aria-hidden="true" />}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
