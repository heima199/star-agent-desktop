import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import {
  ChevronDown,
  Clapperboard,
  Columns2,
  Film,
  Image,
  Images,
  Layers,
  Palette,
  ScanEye,
  Video,
  Wand2,
  X,
  type LucideIcon,
} from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { SelectField } from '@/components/ui/SelectField'
import { useStarBrand } from '../../stores/starBrandStore'
import { useStarStore, formatStarCredits } from '../../stores/starStore'
import { useStarCreateStore } from '../../stores/starCreateStore'
import {
  STAR_CREATE_MODES,
  starCreateSpec,
  type StarCreateMode,
  type StarCreateParams,
} from '../../lib/starCreateRequest'
import {
  autoImageModel,
  autoVideoModel,
  IMAGE_RATIO_IGNORED,
  IMAGE_RATIOS,
  imageModelsFor,
  imageRatioIgnored,
  nearest,
  referenceVideoAvailable,
  videoCost,
  videoModelsFor,
  type ImageMode,
  type VideoMode,
} from '../../pages/star/starStudioModels'

export const STAR_CREATE_ICONS: Record<StarCreateMode, LucideIcon> = {
  text2image: Wand2,
  image2image: Image,
  multi2image: Images,
  text2video: Video,
  image2video: Film,
  frames2video: Columns2,
  multi2video: Layers,
  video2video: Clapperboard,
  vision: ScanEye,
}

const SECTIONS: { title: string; kind: 'image' | 'video' | 'vision' }[] = [
  { title: '图片', kind: 'image' },
  { title: '视频', kind: 'video' },
  { title: '理解', kind: 'vision' },
]

const VIDEO_RATIOS_FALLBACK = ['16:9', '9:16', '1:1']
const CHIP = 'inline-flex h-6 items-center rounded-full border px-2.5 text-[12px] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-border-focus)]'
const CHIP_ON = 'border-[var(--color-model-option-selected-border)] bg-[var(--color-model-option-selected-bg)] font-medium text-[var(--color-on-brand-soft)]'
const CHIP_OFF = 'border-[var(--color-border)] text-[var(--color-text-secondary)] hover:border-[var(--color-border-strong)] hover:text-[var(--color-text-primary)]'
const PANEL = 'absolute bottom-full left-0 z-[var(--z-dropdown)] mb-2 overflow-hidden rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-surface-container-lowest)] shadow-[var(--shadow-dropdown)]'

function useOutsideClose(open: boolean, ref: React.RefObject<HTMLElement | null>, onClose: () => void) {
  useEffect(() => {
    if (!open) return
    const onDown = (event: MouseEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) onClose()
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open, ref, onClose])
}

/** The mode list: what can be made in this chat. */
function ModeMenu({ current, onPick }: { current?: StarCreateMode; onPick: (mode: StarCreateMode) => void }) {
  const signedIn = useStarStore(s => s.status?.signedIn ?? false)
  // 视频参考 is listed only while some model takes reference videos.
  const videoReferenceOn = useStarStore(s => referenceVideoAvailable(s.catalog))
  const brand = useStarBrand()
  return (
    <div className={`${PANEL} w-[300px]`} role="menu" aria-label={`${brand.name} 创作`}>
      <div className="border-b border-[var(--color-border)] px-3 py-2">
        <div className="text-[13px] font-semibold text-[var(--color-text-primary)]">{brand.name} 创作</div>
        <div className="text-[11px] leading-4 text-[var(--color-text-tertiary)]">选一种方式，附上参考图或视频，直接在对话里生成</div>
      </div>
      {!signedIn ? (
        <div className="flex items-center gap-2 border-b border-[var(--color-border)] bg-[var(--color-surface-container-low)] px-3 py-2 text-[12px] text-[var(--color-text-secondary)]">
          <span className="min-w-0 flex-1">登录 {brand.name} 账号后才能生成</span>
          <Button size="sm" variant="secondary" onClick={() => useStarStore.getState().openLogin()}>登录</Button>
        </div>
      ) : null}
      <div className="max-h-[min(420px,60vh)] overflow-y-auto p-1">
        {SECTIONS.map(section => (
          <div key={section.kind} role="group" aria-label={section.title} className="py-0.5">
            <div className="px-2 pb-0.5 pt-1.5 text-[11px] font-medium text-[var(--color-text-tertiary)]">{section.title}</div>
            {STAR_CREATE_MODES.filter(spec => spec.kind === section.kind && (videoReferenceOn || spec.mode !== 'video2video')).map(spec => {
              const Icon = STAR_CREATE_ICONS[spec.mode]
              const active = spec.mode === current
              return (
                <button
                  key={spec.mode}
                  type="button"
                  role="menuitemradio"
                  aria-checked={active}
                  data-testid={`star-create-mode-${spec.mode}`}
                  onClick={() => onPick(spec.mode)}
                  className={`flex w-full items-center gap-2.5 rounded-[var(--radius-sm)] px-2 py-1.5 text-left transition-colors hover:bg-[var(--color-surface-hover)] ${active ? 'bg-[var(--color-surface-selected)]' : ''}`}
                >
                  <Icon size={15} strokeWidth={1.75} aria-hidden="true" className={active ? 'shrink-0 text-[var(--color-brand)]' : 'shrink-0 text-[var(--color-text-tertiary)]'} />
                  <span className="min-w-0 flex-1">
                    <span className="block text-[13px] text-[var(--color-text-primary)]">{spec.label}</span>
                    <span className="block truncate text-[11px] text-[var(--color-text-tertiary)]">{spec.hint}</span>
                  </span>
                </button>
              )
            })}
          </div>
        ))}
      </div>
    </div>
  )
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-[11px] font-medium text-[var(--color-text-tertiary)]">{label}</span>
      <div className="flex flex-wrap gap-1.5">{children}</div>
    </div>
  )
}

/** Model, ratio, count / duration for the armed mode. */
function SettingsPanel({ slot, mode, params, onClose }: { slot: string; mode: StarCreateMode; params: StarCreateParams; onClose: () => void }) {
  const catalog = useStarStore(s => s.catalog)
  const brand = useStarBrand()
  const spec = starCreateSpec(mode)
  const update = (patch: StarCreateParams) => useStarCreateStore.getState().update(slot, patch)
  const imageModels = spec.kind === 'image' ? imageModelsFor(catalog, mode as ImageMode) : []
  const videoModels = spec.kind === 'video' ? videoModelsFor(catalog, mode as VideoMode) : []
  const autoImage = spec.kind === 'image' ? autoImageModel(catalog, mode as ImageMode, params.ratio) : undefined
  const duration = params.duration ?? 5
  const autoVideo = spec.kind === 'video' ? autoVideoModel(catalog, mode as VideoMode, duration) : undefined
  const pickedVideo = videoModels.find(model => model.id === params.model) ?? autoVideo
  const pickedImage = imageModels.find(model => model.id === params.model) ?? autoImage
  const durations = pickedVideo?.durations?.length ? pickedVideo.durations : [5, 10]
  const videoRatios = pickedVideo?.ratios?.length ? pickedVideo.ratios : VIDEO_RATIOS_FALLBACK
  const count = params.count ?? 1
  const cost = spec.kind === 'image'
    ? (pickedImage?.pricePerImage !== undefined ? pickedImage.pricePerImage * count : undefined)
    : spec.kind === 'video' ? videoCost(pickedVideo, nearest(durations, duration)) : undefined

  const models = spec.kind === 'image' ? imageModels : videoModels
  const modelOptions = [
    { value: '', label: `自动${(spec.kind === 'image' ? autoImage : autoVideo)?.label ? `（${(spec.kind === 'image' ? autoImage : autoVideo)!.label}）` : ''}` },
    ...models.map(model => ({ value: model.id, label: model.label })),
  ]

  return (
    <div className={`${PANEL} w-[320px] p-3`} role="dialog" aria-label={`${spec.label} 参数`}>
      <div className="mb-3 flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <div className="text-[13px] font-semibold text-[var(--color-text-primary)]">{spec.label}</div>
          <div className="text-[11px] leading-4 text-[var(--color-text-tertiary)]">{spec.hint}</div>
        </div>
        <button type="button" aria-label="关闭" onClick={onClose} className="rounded-[var(--radius-xs)] p-0.5 text-[var(--color-text-tertiary)] hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-text-primary)]">
          <X size={14} strokeWidth={1.75} aria-hidden="true" />
        </button>
      </div>
      <div className="flex flex-col gap-3">
        {spec.kind !== 'vision' ? (
          <SelectField
            label="模型"
            size="sm"
            options={modelOptions}
            value={params.model ?? ''}
            onChange={value => update({ model: value || undefined })}
          />
        ) : (
          <p className="text-[12px] leading-5 text-[var(--color-text-secondary)]">由支持识图的多模态模型回答（默认 Gemini 2.5 Flash）。图片会先上传到 {brand.name} 再识别。</p>
        )}
        {spec.kind === 'image' ? (
          <>
            <Row label="比例">
              {IMAGE_RATIOS.slice(0, 7).map(ratio => (
                <button key={ratio} type="button" className={`${CHIP} ${(params.ratio ?? 'auto') === ratio ? CHIP_ON : CHIP_OFF}`} onClick={() => update({ ratio })}>
                  {ratio === 'auto' ? '自动' : ratio}
                </button>
              ))}
            </Row>
            {imageRatioIgnored(pickedImage, params.ratio) ? <p className="-mt-1.5 text-[11px] leading-4 text-[var(--color-warning)]">{IMAGE_RATIO_IGNORED}</p> : null}
            <Row label="张数">
              {[1, 2, 3, 4].map(value => (
                <button key={value} type="button" className={`${CHIP} ${count === value ? CHIP_ON : CHIP_OFF}`} onClick={() => update({ count: value })}>{value} 张</button>
              ))}
            </Row>
            <Row label="清晰度">
              {[undefined, '2k', '4k'].map(value => (
                <button key={value ?? 'default'} type="button" className={`${CHIP} ${params.resolution === value ? CHIP_ON : CHIP_OFF}`} onClick={() => update({ resolution: value })}>{value ?? '标准'}</button>
              ))}
            </Row>
          </>
        ) : null}
        {spec.kind === 'video' ? (
          <>
            <Row label="时长">
              {durations.slice(0, 6).map(value => (
                <button key={value} type="button" className={`${CHIP} ${nearest(durations, duration) === value ? CHIP_ON : CHIP_OFF}`} onClick={() => update({ duration: value })}>{value} 秒</button>
              ))}
            </Row>
            <Row label="比例">
              {videoRatios.slice(0, 6).map(ratio => (
                <button key={ratio} type="button" className={`${CHIP} ${(params.ratio ?? videoRatios[0]) === ratio ? CHIP_ON : CHIP_OFF}`} onClick={() => update({ ratio })}>{ratio}</button>
              ))}
            </Row>
          </>
        ) : null}
        <div className="flex items-center justify-between border-t border-[var(--color-border)] pt-2 text-[11px] text-[var(--color-text-tertiary)]">
          <span>结果保存在项目的 star-outputs 文件夹，并收进资料库</span>
          {cost !== undefined ? <span className="shrink-0 tabular-nums text-[var(--color-text-secondary)]">约 {formatStarCredits(cost)} 积分</span> : null}
        </div>
      </div>
    </div>
  )
}

/**
 * The composer's STAR 创作 control. Unarmed it is a quiet toolbar button that
 * opens the mode list; armed it is a chip naming the mode, with its settings
 * one click away and a ✕ to go back to plain chat.
 */
export function StarCreateControl({ slot, touch = false, disabled = false }: { slot: string; touch?: boolean; disabled?: boolean }) {
  const configured = useStarStore(s => s.status?.configured ?? false)
  const armed = useStarCreateStore(s => s.slots[slot])
  const brand = useStarBrand()
  const [open, setOpen] = useState<'modes' | 'settings' | null>(null)
  const rootRef = useRef<HTMLDivElement>(null)
  const close = useMemo(() => () => setOpen(null), [])
  useOutsideClose(open !== null, rootRef, close)

  if (!configured) return null

  const pick = (mode: StarCreateMode) => {
    useStarCreateStore.getState().arm(slot, mode)
    setOpen(null)
  }
  const size = touch ? 'h-11' : 'h-7'

  if (!armed) {
    return (
      <div ref={rootRef} className="relative shrink-0">
        <button
          type="button"
          disabled={disabled}
          onClick={() => setOpen(value => (value === 'modes' ? null : 'modes'))}
          aria-label={`${brand.name} 创作：文生图、图生图、视频、多模态`}
          title={`${brand.name} 创作：文生图、图生图、视频、多模态`}
          aria-haspopup="menu"
          aria-expanded={open === 'modes'}
          data-testid="star-create-button"
          className={`inline-flex items-center justify-center gap-1 rounded-[var(--radius-sm)] px-1.5 text-[12px] text-[var(--color-text-tertiary)] transition-colors hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-text-primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-border-focus)] disabled:opacity-50 ${open ? 'bg-[var(--color-surface-hover)] text-[var(--color-text-primary)]' : ''} ${size}`}
        >
          <Palette size={touch ? 18 : 15} strokeWidth={1.75} aria-hidden="true" />
          {touch ? null : <span>创作</span>}
        </button>
        {open === 'modes' ? <ModeMenu onPick={pick} /> : null}
      </div>
    )
  }

  const spec = starCreateSpec(armed.mode)
  const Icon = STAR_CREATE_ICONS[armed.mode]
  return (
    <div ref={rootRef} className="relative shrink-0">
      <span
        data-testid="star-create-chip"
        className={`inline-flex items-center rounded-[var(--radius-sm)] bg-[var(--color-brand-soft)] text-xs font-medium text-[var(--color-on-brand-soft)] ${size}`}
      >
        <button
          type="button"
          onClick={() => setOpen(value => (value === 'modes' ? null : 'modes'))}
          aria-label={`切换创作方式（当前：${spec.label}）`}
          title="切换创作方式"
          className={`inline-flex items-center gap-1 rounded-l-[var(--radius-sm)] pl-2 pr-1 hover:bg-[var(--color-brand-soft-hover)] ${size}`}
        >
          <Icon size={13} strokeWidth={1.75} aria-hidden="true" />
          {spec.label}
        </button>
        <button
          type="button"
          onClick={() => setOpen(value => (value === 'settings' ? null : 'settings'))}
          aria-label={`${spec.label} 参数`}
          title="模型、比例、张数 / 时长"
          className={`inline-flex items-center px-1 hover:bg-[var(--color-brand-soft-hover)] ${size}`}
        >
          <ChevronDown size={12} strokeWidth={1.75} aria-hidden="true" />
        </button>
        <button
          type="button"
          onClick={() => { useStarCreateStore.getState().disarm(slot); setOpen(null) }}
          aria-label={`退出 ${brand.name} 创作，回到普通对话`}
          title="退出创作模式"
          className={`inline-flex items-center justify-center rounded-r-[var(--radius-sm)] hover:bg-[var(--color-brand-soft-hover)] ${touch ? 'h-11 w-9' : 'h-7 w-6'}`}
        >
          <X size={12} strokeWidth={1.75} aria-hidden="true" />
        </button>
      </span>
      {open === 'modes' ? <ModeMenu current={armed.mode} onPick={pick} /> : null}
      {open === 'settings' ? <SettingsPanel slot={slot} mode={armed.mode} params={armed.params} onClose={close} /> : null}
    </div>
  )
}

/** Read-only chip on a sent message. */
export function StarCreateSentChip({ mode }: { mode: StarCreateMode }) {
  const spec = starCreateSpec(mode)
  const Icon = STAR_CREATE_ICONS[mode]
  const brand = useStarBrand()
  return (
    <span data-testid="star-create-sent-chip" className="inline-flex h-6 shrink-0 items-center gap-1 rounded-[var(--radius-sm)] bg-[var(--color-brand-soft)] px-2 text-xs font-medium text-[var(--color-on-brand-soft)]">
      <Icon size={12} strokeWidth={1.75} aria-hidden="true" />
      {brand.name} · {spec.label}
    </span>
  )
}
