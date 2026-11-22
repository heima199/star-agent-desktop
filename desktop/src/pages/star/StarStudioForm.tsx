import { useEffect, useMemo, useRef, useState } from 'react'
import { Film, ImagePlus, Loader2, Play, X } from 'lucide-react'
import { Button } from '../../components/ui/Button'
import { TextArea } from '../../components/ui/TextArea'
import { useUIStore } from '../../stores/uiStore'
import { formatStarCredits, useStarStore } from '../../stores/starStore'
import { starApi, starErrorText, type StarImageModel, type StarVideoModel } from '../../api/star'
import { takeStarStudioPrefill } from '../../components/star/starTabs'
import { pokeStarTasks } from '../../components/star/useStarSync'
import {
  autoImageModel,
  autoVideoModel,
  IMAGE_MODES,
  IMAGE_RATIO_IGNORED,
  IMAGE_RATIOS,
  imageModelsFor,
  imageModeWith,
  imageRatioIgnored,
  nearest,
  imageTierCost,
  imageTierNote,
  keptModel,
  listedVideoCost,
  REFERENCE_VIDEO_PAUSED,
  referenceRefusal,
  referenceRoom,
  referenceSlot,
  referenceVideoAvailable,
  risingDurations,
  risingResolutions,
  shownRows,
  VIDEO_MODES,
  videoCostAt,
  videoModelsFor,
  videoRatioLabel,
  type ImageMode,
  type VideoMode,
} from './starStudioModels'
import { useStarCreditEstimate } from './useStarCreditEstimate'

type Ref = { id: string; name: string; kind: 'image' | 'video'; preview: string | null; url?: string; status: 'uploading' | 'ready' | 'error'; error?: string }

export type StarStudioReference = { url: string; kind: 'image' | 'video' }

let refSeq = 0

function chip(active: boolean) {
  return `h-7 rounded-full border px-3 text-[12px] transition-colors ${active ? 'border-[var(--color-model-option-selected-border)] bg-[var(--color-model-option-selected-bg)] font-medium text-[var(--color-on-brand-soft)]' : 'border-[var(--color-border)] text-[var(--color-text-secondary)] hover:border-[var(--color-outline)]'}`
}

function Label({ children }: { children: React.ReactNode }) {
  return <div className="mb-1.5 text-[12px] font-medium text-[var(--color-text-secondary)]">{children}</div>
}

/** A row of thumbnails with an add button; uploads each pick to STAR right away. */
function RefSlots({ items, max, kind, onAdd, onRemove, label }: { items: Ref[]; max: number; kind: 'image' | 'video'; onAdd: (files: File[]) => void; onRemove: (id: string) => void; label: string }) {
  const input = useRef<HTMLInputElement>(null)
  return (
    <div>
      <Label>{label}<span className="ml-1 font-normal text-[var(--color-text-tertiary)]">{items.length}/{max}</span></Label>
      <div
        className="flex flex-wrap gap-2"
        onDragOver={event => event.preventDefault()}
        onDrop={(event) => {
          event.preventDefault()
          const files = [...event.dataTransfer.files].filter(file => file.type.startsWith(kind === 'image' ? 'image/' : 'video/'))
          if (files.length) onAdd(files.slice(0, Math.max(0, max - items.length)))
        }}
      >
        {items.map(item => (
          <div key={item.id} className="group relative h-[68px] w-[68px] overflow-hidden rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface-container)]" title={item.error ?? item.name}>
            {item.preview && item.kind === 'image'
              ? <img src={item.preview} alt={item.name} className="h-full w-full object-cover" />
              : <span className="flex h-full w-full flex-col items-center justify-center gap-1 text-[11px] text-[var(--color-text-tertiary)]"><Film size={16} />{item.name.slice(0, 10)}</span>}
            {item.status === 'uploading' ? <span className="absolute inset-0 flex items-center justify-center bg-[var(--color-lightbox-scrim)]"><Loader2 size={16} className="animate-spin text-[var(--color-lightbox-control-bg)]" aria-label="上传中" /></span> : null}
            {item.status === 'error' ? <span className="absolute inset-x-0 bottom-0 bg-[var(--color-error)] px-1 text-center text-[11px] text-[var(--color-on-error)]">上传失败</span> : null}
            <button type="button" aria-label="移除" onClick={() => onRemove(item.id)} className="absolute right-0.5 top-0.5 hidden rounded-full bg-[var(--color-lightbox-control-bg)] p-0.5 text-[var(--color-lightbox-control-fg)] group-hover:block"><X size={11} /></button>
          </div>
        ))}
        {items.length < max ? (
          <button type="button" onClick={() => input.current?.click()} className="flex h-[68px] w-[68px] flex-col items-center justify-center gap-1 rounded-[var(--radius-md)] border border-dashed border-[var(--color-border)] text-[11px] text-[var(--color-text-tertiary)] hover:border-[var(--color-outline)] hover:text-[var(--color-text-secondary)]">
            {kind === 'image' ? <ImagePlus size={17} /> : <Film size={17} />}
            添加
          </button>
        ) : null}
        <input
          ref={input}
          type="file"
          hidden
          multiple={max - items.length > 1}
          accept={kind === 'image' ? 'image/png,image/jpeg,image/webp,image/gif' : 'video/mp4,video/quicktime,video/webm'}
          onChange={(event) => {
            const files = [...(event.target.files ?? [])].slice(0, Math.max(0, max - items.length))
            event.target.value = ''
            if (files.length) onAdd(files)
          }}
        />
      </div>
    </div>
  )
}

export function StarStudioForm({ incoming, onIncomingHandled }: { incoming: StarStudioReference | null; onIncomingHandled: () => void }) {
  const catalog = useStarStore(s => s.catalog)
  const status = useStarStore(s => s.status)
  const quota = useStarStore(s => s.quota)
  const [kind, setKind] = useState<'image' | 'video'>('image')
  const [imageMode, setImageMode] = useState<ImageMode>('text2image')
  const [videoMode, setVideoMode] = useState<VideoMode>('text2video')
  const [prompt, setPrompt] = useState('')
  // 图片 and 视频 each keep their own pick, like their own ratio and resolution.
  const [imageModel, setImageModel] = useState('')
  const [videoModel, setVideoModel] = useState('')
  const model = kind === 'image' ? imageModel : videoModel
  const setModel = kind === 'image' ? setImageModel : setVideoModel
  const [ratio, setRatio] = useState('auto')
  const [resolution, setResolution] = useState<'1k' | '2k' | '4k'>('1k')
  const [count, setCount] = useState(1)
  const [duration, setDuration] = useState(5)
  const [videoRatio, setVideoRatio] = useState('16:9')
  const [videoResolution, setVideoResolution] = useState('')
  // Their own reference pictures too: one attached for 图生图 does not ride along into a video.
  const [imageRefs, setImageRefs] = useState<Ref[]>([])
  const [videoRefs, setVideoRefs] = useState<Ref[]>([])
  const refs = kind === 'image' ? imageRefs : videoRefs
  const setRefs = kind === 'image' ? setImageRefs : setVideoRefs
  const [first, setFirst] = useState<Ref[]>([])
  const [last, setLast] = useState<Ref[]>([])
  const [videos, setVideos] = useState<Ref[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!catalog) void useStarStore.getState().loadCatalog()
    const apply = () => {
      const prefill = takeStarStudioPrefill()
      if (!prefill) return
      setKind(prefill.kind)
      if (prefill.kind === 'image' && IMAGE_MODES.some(item => item.value === prefill.mode)) setImageMode(prefill.mode as ImageMode)
      if (prefill.kind === 'video' && VIDEO_MODES.some(item => item.value === prefill.mode)) setVideoMode(prefill.mode as VideoMode)
      if (prefill.prompt) setPrompt(prefill.prompt)
    }
    apply()
    window.addEventListener('star:studio-prefill', apply)
    return () => window.removeEventListener('star:studio-prefill', apply)
  }, [catalog])

  // 视频参考 is offered only while some model takes reference videos.
  const videoReferenceOn = referenceVideoAvailable(catalog)
  useEffect(() => {
    if (!videoReferenceOn && videoMode === 'video2video') setVideoMode('text2video')
  }, [videoReferenceOn, videoMode])

  useEffect(() => {
    if (!incoming) return
    const item: Ref = { id: `r${++refSeq}`, name: incoming.kind === 'image' ? '生成结果' : '生成视频', kind: incoming.kind, preview: incoming.kind === 'image' ? incoming.url : null, url: incoming.url, status: 'ready' }
    const note = (message: string) => useUIStore.getState().addToast({ type: 'info', message })
    const { slot, max } = referenceSlot(incoming.kind, kind, videoMode)
    if (incoming.kind === 'video' && !videoReferenceOn) {
      note(REFERENCE_VIDEO_PAUSED)
    } else if (slot === 'first') {
      if (videoMode === 'text2video') setVideoMode('image2video')
      setFirst([item])
    } else {
      const row = slot === 'videos' ? videos : refs
      const room = referenceRoom(row.map(ref => ref.url), incoming.url, max)
      const attached = row.length + (room === 'room' ? 1 : 0)
      if (slot === 'videos') {
        setKind('video')
        setVideoMode('video2video')
      } else if (kind === 'image') {
        // Also when nothing is added: the mode that shows what is attached.
        setImageMode(mode => imageModeWith(mode, attached))
      }
      if (room !== 'room') note(referenceRefusal(incoming.kind, room, max))
      else if (slot === 'videos') setVideos([...row, item])
      else setRefs([...row, item])
    }
    onIncomingHandled()
  }, [incoming]) // eslint-disable-line react-hooks/exhaustive-deps

  const imageModels = useMemo(() => imageModelsFor(catalog, imageMode), [catalog, imageMode])
  const videoModels = useMemo(() => videoModelsFor(catalog, videoMode), [catalog, videoMode])
  const chosenImage = model && kind === 'image' ? imageModels.find(item => item.id === model) : autoImageModel(catalog, imageMode, ratio)
  const ratioIgnored = kind === 'image' && imageRatioIgnored(chosenImage, ratio)
  const chosenVideo = model && kind === 'video' ? videoModels.find(item => item.id === model) : autoVideoModel(catalog, videoMode, duration)
  const durations = chosenVideo?.durations?.length ? chosenVideo.durations : [5, 10]
  const ratios = chosenVideo?.ratios?.length ? chosenVideo.ratios : ['16:9', '9:16', '1:1', '4:3', '3:4']
  const resolutions = chosenVideo?.resolutions?.length ? chosenVideo.resolutions : ['720P', '1080P']
  const effectiveDuration = durations.includes(duration) ? duration : nearest(durations, duration)
  const effectiveRatio = ratios.includes(videoRatio) ? videoRatio : ratios[0]!
  const effectiveResolution = resolutions.includes(videoResolution) ? videoResolution : resolutions[0]!
  // The console's price for exactly these picks; its rule stands in until it answers.
  const exact = useStarCreditEstimate(catalog
    ? kind === 'image'
      ? { kind: 'image', model: model || undefined, ratio: ratio === 'auto' ? undefined : ratio, resolution, count, edit: imageMode !== 'text2image' }
      : { kind: 'video', model: model || undefined, mode: videoMode, duration: effectiveDuration, resolution: effectiveResolution }
    : null)
  const localEstimate = kind === 'image'
    ? (() => { const one = imageTierCost(chosenImage, resolution); return one !== undefined ? one * count : undefined })()
    : videoCostAt(chosenVideo, effectiveDuration, effectiveResolution)
  const estimate = exact?.credits ?? localEstimate
  const tierNote = kind === 'image' ? imageTierNote(resolution, exact?.tier, ratio) : null

  useEffect(() => setImageModel(picked => keptModel(picked, imageModels)), [imageModels])
  useEffect(() => setVideoModel(picked => keptModel(picked, videoModels)), [videoModels])

  // What the mode shows is what gets checked and sent.
  const rows = shownRows(kind, imageMode, videoMode)
  const shown = { refs: refs.slice(0, rows.refs), first: first.slice(0, rows.first), last: last.slice(0, rows.last), videos: videos.slice(0, rows.videos) }

  const upload = (files: File[], fileKind: 'image' | 'video', setter: React.Dispatch<React.SetStateAction<Ref[]>>, max: number) => {
    const added = files.map((file): Ref => ({ id: `r${++refSeq}`, name: file.name, kind: fileKind, preview: fileKind === 'image' ? URL.createObjectURL(file) : null, status: 'uploading' }))
    setter(list => [...list, ...added].slice(0, max))
    added.forEach((item, index) => {
      starApi.uploadReference(files[index]!, fileKind)
        .then(url => setter(list => list.map(entry => (entry.id === item.id ? { ...entry, url, status: 'ready' } : entry))))
        .catch(err => setter(list => list.map(entry => (entry.id === item.id ? { ...entry, status: 'error', error: starErrorText(err) } : entry))))
    })
  }
  const remove = (setter: React.Dispatch<React.SetStateAction<Ref[]>>) => (id: string) => setter(list => list.filter(item => item.id !== id))
  const ready = (list: Ref[]) => list.filter(item => item.status === 'ready' && item.url).map(item => item.url!)

  const submit = async () => {
    setError(null)
    if (!status?.signedIn) {
      useStarStore.getState().openLogin()
      return
    }
    if (!prompt.trim()) {
      setError('请填写描述')
      return
    }
    const all = [...shown.refs, ...shown.first, ...shown.last, ...shown.videos]
    if (all.some(item => item.status === 'uploading')) {
      setError('参考素材还在上传，请稍候')
      return
    }
    if (all.some(item => item.status === 'error')) {
      setError('有素材上传失败，请移除后重试')
      return
    }
    setBusy(true)
    try {
      if (kind === 'image') {
        const references = ready(shown.refs)
        if (rows.refs && !references.length) throw new Error('请先添加参考图')
        const { task } = await starApi.generateImage({
          prompt: prompt.trim(),
          ...(model ? { model } : {}),
          references,
          ...(ratio !== 'auto' ? { ratio } : {}),
          resolution,
          count,
        })
        useStarStore.getState().upsertTask(task)
      } else {
        const firstUrl = ready(shown.first)[0]
        const lastUrl = ready(shown.last)[0]
        if (rows.first && !firstUrl) throw new Error('请添加首帧图片')
        if (rows.last && !lastUrl) throw new Error('请添加尾帧图片')
        if (videoMode === 'multi2video' && !ready(shown.refs).length) throw new Error('请添加参考图')
        if (rows.videos && !ready(shown.videos).length) throw new Error('请添加参考视频')
        const { task } = await starApi.generateVideo({
          prompt: prompt.trim(),
          ...(model ? { model } : {}),
          ...(firstUrl ? { firstFrame: firstUrl } : {}),
          ...(lastUrl ? { lastFrame: lastUrl } : {}),
          ...(rows.refs ? { references: ready(shown.refs) } : {}),
          ...(rows.videos ? { videos: ready(shown.videos) } : {}),
          duration: effectiveDuration,
          ratio: effectiveRatio,
          resolution: effectiveResolution,
        })
        useStarStore.getState().upsertTask(task)
      }
      useUIStore.getState().addToast({ type: 'success', message: '已开始生成，进度见右侧任务中心' })
      pokeStarTasks()
    } catch (err) {
      setError(starErrorText(err))
    } finally {
      setBusy(false)
    }
  }

  const modes = kind === 'image' ? IMAGE_MODES : VIDEO_MODES.filter(item => videoReferenceOn || item.value !== 'video2video')
  const activeMode = kind === 'image' ? imageMode : videoMode
  const modeHint = modes.find(item => item.value === activeMode)?.hint
  const modelList = kind === 'image' ? imageModels : videoModels
  const autoName = (kind === 'image' ? chosenImage?.label ?? chosenImage?.id : chosenVideo?.label ?? chosenVideo?.id) ?? '无可用模型'

  return (
    <div className="flex flex-col gap-4" data-testid="star-studio-form">
      <div className="flex gap-1 rounded-[var(--radius-md)] bg-[var(--color-surface-container)] p-1 text-[13px]">
        {(['image', 'video'] as const).map(item => (
          <button key={item} type="button" onClick={() => setKind(item)} className={`h-8 flex-1 rounded-[var(--radius-sm)] transition-colors ${kind === item ? 'bg-[var(--color-surface-container-lowest)] font-semibold text-[var(--color-text-primary)] shadow-sm' : 'text-[var(--color-text-tertiary)]'}`}>
            {item === 'image' ? '图片' : '视频'}
          </button>
        ))}
      </div>
      <div>
        <div className="flex flex-wrap gap-1.5">
          {modes.map(item => (
            <button key={item.value} type="button" className={chip(item.value === activeMode)} onClick={() => (kind === 'image' ? setImageMode(item.value as ImageMode) : setVideoMode(item.value as VideoMode))}>{item.label}</button>
          ))}
        </div>
        {modeHint ? <p className="mt-1.5 text-[12px] text-[var(--color-text-tertiary)]">{modeHint}</p> : null}
      </div>

      {kind === 'image' && rows.refs ? (
        <RefSlots label={rows.refs === 1 ? '参考图' : '参考图（按顺序称为图1、图2…）'} items={shown.refs} max={rows.refs} kind="image" onAdd={files => upload(files, 'image', setRefs, rows.refs)} onRemove={remove(setRefs)} />
      ) : null}
      {rows.first ? (
        <div className="flex gap-6">
          <RefSlots label="首帧" items={shown.first} max={rows.first} kind="image" onAdd={files => upload(files, 'image', setFirst, rows.first)} onRemove={remove(setFirst)} />
          {rows.last ? <RefSlots label="尾帧" items={shown.last} max={rows.last} kind="image" onAdd={files => upload(files, 'image', setLast, rows.last)} onRemove={remove(setLast)} /> : null}
        </div>
      ) : null}
      {rows.videos ? (
        <RefSlots label="参考视频（mp4 / mov / webm，≤64MB）" items={shown.videos} max={rows.videos} kind="video" onAdd={files => upload(files, 'video', setVideos, rows.videos)} onRemove={remove(setVideos)} />
      ) : null}
      {kind === 'video' && rows.refs ? (
        <RefSlots label={videoMode === 'multi2video' ? '参考图' : '参考图（可选）'} items={shown.refs} max={rows.refs} kind="image" onAdd={files => upload(files, 'image', setRefs, rows.refs)} onRemove={remove(setRefs)} />
      ) : null}

      <TextArea
        label="描述"
        value={prompt}
        onChange={event => setPrompt(event.target.value)}
        rows={5}
        placeholder={kind === 'image' ? '例如：雨夜霓虹街道上漫步的橘猫，赛博朋克风格，电影感光影' : '例如：清晨的海边，镜头缓缓推进，阳光洒在海浪上'}
      />

      <div>
        <Label>模型</Label>
        <select
          aria-label="模型"
          value={model}
          onChange={event => setModel(event.target.value)}
          className="h-9 w-full rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] px-2.5 text-[13px] text-[var(--color-text-primary)]"
        >
          <option value="">自动选择（{autoName}）</option>
          {modelList.map(item => {
            // Priced at the picked 清晰度, or 分辨率 and 时长, like the job itself.
            const cost = kind === 'image'
              ? imageTierCost(item as StarImageModel, resolution)
              : listedVideoCost(item as StarVideoModel, model, exact?.credits, effectiveDuration, effectiveResolution)
            const price = cost === undefined ? '' : kind === 'image' ? ` · ${cost} 积分/张` : ` · 约 ${cost} 积分`
            return <option key={item.id} value={item.id}>{item.label}{price}</option>
          })}
        </select>
      </div>

      {kind === 'image' ? (
        <>
          <div>
            <Label>比例</Label>
            <div className="flex flex-wrap gap-1.5">{IMAGE_RATIOS.map(item => <button key={item} type="button" className={chip(ratio === item)} onClick={() => setRatio(item)}>{item === 'auto' ? '自动' : item}</button>)}</div>
            {ratioIgnored ? <div className="mt-1.5 text-[12px] leading-5 text-[var(--color-warning)]">{IMAGE_RATIO_IGNORED}</div> : null}
          </div>
          <div className="flex gap-6">
            <div>
              <Label>清晰度</Label>
              <div className="flex gap-1.5">{(['1k', '2k', '4k'] as const).map(item => <button key={item} type="button" className={chip(resolution === item)} onClick={() => setResolution(item)}>{item.toUpperCase()}</button>)}</div>
              {tierNote ? <div className="mt-1.5 text-[12px] leading-5 text-[var(--color-warning)]">{tierNote}</div> : null}
            </div>
            <div>
              <Label>张数</Label>
              <div className="flex gap-1.5">{[1, 2, 3, 4].map(item => <button key={item} type="button" className={chip(count === item)} onClick={() => setCount(item)}>{item}</button>)}</div>
            </div>
          </div>
        </>
      ) : (
        <>
          <div>
            <Label>时长</Label>
            <div className="flex flex-wrap gap-1.5">{risingDurations(durations).map(item => <button key={item} type="button" className={chip(effectiveDuration === item)} onClick={() => setDuration(item)}>{item} 秒</button>)}</div>
          </div>
          <div className="flex flex-wrap gap-6">
            <div>
              <Label>比例</Label>
              <div className="flex flex-wrap gap-1.5">{ratios.map(item => <button key={item} type="button" className={chip(effectiveRatio === item)} onClick={() => setVideoRatio(item)}>{videoRatioLabel(item)}</button>)}</div>
            </div>
            <div>
              <Label>分辨率</Label>
              <div className="flex flex-wrap gap-1.5">{risingResolutions(resolutions).map(item => <button key={item} type="button" className={chip(effectiveResolution === item)} onClick={() => setVideoResolution(item)}>{item}</button>)}</div>
            </div>
          </div>
        </>
      )}

      {error ? <div className="text-[12px] leading-5 text-[var(--color-error)]">{error}</div> : null}
      <div className="flex items-center gap-3">
        <Button size="lg" icon={<Play size={15} aria-hidden="true" />} loading={busy} onClick={() => void submit()} className="flex-1">
          {status?.signedIn ? '开始生成' : '登录后生成'}
        </Button>
      </div>
      <p className="text-[12px] text-[var(--color-text-tertiary)]">
        {estimate !== undefined ? `预计消耗约 ${estimate} 积分 · ` : ''}积分余额 {formatStarCredits(quota?.credits)}
        <button type="button" className="ml-2 text-[var(--color-text-accent)] hover:underline" onClick={() => useStarStore.getState().openUpgrade('credits')}>购买积分</button>
      </p>
    </div>
  )
}
