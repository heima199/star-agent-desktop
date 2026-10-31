import { useEffect, useRef, useState } from 'react'
import { BookOpenCheck, CheckCircle2, CircleAlert, CircleDashed, Clapperboard, FileScan, FlaskConical, Loader2, Palette, SkipForward, Telescope, TriangleAlert } from 'lucide-react'
import { Button } from '../../components/ui/Button'
import { Switch } from '../../components/ui/Switch'
import { pluginsApi } from '../../api/plugins'
import { starApi, starErrorText, type StarCheckItem, type StarCheckRun } from '../../api/star'
import { formatStarBrand } from '../../lib/starBrand'
import { useUIStore } from '../../stores/uiStore'
import { getStarBrandName, useStarBrand } from '../../stores/starBrandStore'
import { useStarStore } from '../../stores/starStore'

/** `{brand}` in a title is the console's product name (matchStarPlugins fills it in). */
const PLUGINS = [
  { name: 'star-image', title: '{brand} 绘图', icon: Palette, description: '文生图、图生图、多图融合生图，支持比例、清晰度和多张生成。也可以在对话框左下角的「创作」里直接发起。', skills: ['/star-text-to-image', '/star-image-to-image'], tools: ['文生图', '图生图', '多图生图', '模型列表'] },
  { name: 'star-video', title: '{brand} 视频', icon: Clapperboard, description: '文生视频、图生视频、首尾帧、多图生视频、视频参考生成视频，同样可以在对话里直接发起。', skills: ['/star-text-to-video', '/star-image-to-video', '/star-video-to-video'], tools: ['文生视频', '图生视频', '首尾帧', '多图生视频', '视频参考'] },
  { name: 'star-research', title: '{brand} 联网研究', icon: Telescope, description: '联网搜索最新资讯、学术论文检索、网页阅读，回答附来源。', skills: ['/star-web-search', '/star-paper-search'], tools: ['联网搜索', '学术论文', '网页阅读'] },
  { name: 'star-docs', title: '{brand} 文档与多模态', icon: FileScan, description: 'PDF、Word、Excel、PPT 文件上传识别，图片与截图理解。', skills: ['/star-pdf', '/star-file-recognize', '/star-vision'], tools: ['文件识别', 'PDF', '多模态识图'] },
  { name: 'star-lab', title: '{brand} 能力测试', icon: FlaskConical, description: '一键测试联网搜索、多模态、文件识别、对话与绘图，查看账号额度。', skills: ['/star-capability-test'], tools: ['能力测试', '账号额度'] },
] as const

const STATUS_ICON: Record<StarCheckItem['status'], React.ReactNode> = {
  pending: <CircleDashed size={15} className="text-[var(--color-text-tertiary)]" />,
  running: <Loader2 size={15} className="animate-spin text-[var(--color-brand)]" />,
  pass: <CheckCircle2 size={15} className="text-[var(--color-success)]" />,
  warn: <TriangleAlert size={15} className="text-[var(--color-warning)]" />,
  fail: <CircleAlert size={15} className="text-[var(--color-error)]" />,
  skip: <SkipForward size={15} className="text-[var(--color-text-tertiary)]" />,
}

function toast(type: 'success' | 'error' | 'info', message: string) {
  useUIStore.getState().addToast({ type, message })
}

/** The built-in plugins a search on the 插件 page finds, by title, description, tools or command; titles carry the product name. */
export function matchStarPlugins(query: string, brand: string = getStarBrandName()) {
  const q = query.trim().toLowerCase()
  const plugins = PLUGINS.map(plugin => ({ ...plugin, title: formatStarBrand(plugin.title, brand) }))
  if (!q) return plugins
  return plugins.filter(plugin => [plugin.title, plugin.description, ...plugin.tools, ...plugin.skills].some(text => text.toLowerCase().includes(q)))
}

/**
 * STAR's built-in plugins, with their on/off switches and commands, in the
 * 插件 page's STAR 首推 section. A search narrows the cards.
 */
export function StarPluginsPanel({ query = '' }: { query?: string } = {}) {
  const brand = useStarBrand()
  const plugins = matchStarPlugins(query, brand.name)
  const [enabled, setEnabled] = useState<Record<string, boolean>>({})
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    let alive = true
    pluginsApi.list().then((response) => {
      if (!alive) return
      const next: Record<string, boolean> = {}
      for (const plugin of response.plugins ?? []) if (plugin.isBuiltin) next[plugin.name] = plugin.enabled
      setEnabled(next)
      setLoaded(true)
    }).catch(() => setLoaded(true))
    return () => { alive = false }
  }, [])

  const toggle = async (name: string, value: boolean) => {
    setEnabled(state => ({ ...state, [name]: value }))
    try {
      await (value ? pluginsApi.enable({ id: `${name}@builtin` }) : pluginsApi.disable({ id: `${name}@builtin` }))
      toast('success', `${value ? '已启用' : '已停用'}，新会话生效`)
    } catch (error) {
      setEnabled(state => ({ ...state, [name]: !value }))
      toast('error', starErrorText(error))
    }
  }

  if (plugins.length === 0) return null

  return (
    // The STAR 首推 section owns the heading and the page column.
    <div data-testid="star-plugins-panel" className="grid grid-cols-[repeat(auto-fill,minmax(min(100%,340px),1fr))] gap-3">
      {plugins.map(plugin => {
        const Icon = plugin.icon
        const on = enabled[plugin.name] ?? true
        return (
          <div key={plugin.name} className="flex flex-col gap-2.5 rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-surface-container-lowest)] p-4">
            <div className="flex items-start gap-3">
              <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-[var(--radius-md)] bg-[var(--color-brand-soft)] text-[var(--color-on-brand-soft)]"><Icon size={18} strokeWidth={1.75} aria-hidden="true" /></span>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 text-[14px] font-semibold text-[var(--color-text-primary)]">
                  {plugin.title}
                  <span className="rounded-[var(--radius-xs)] bg-[var(--color-brand-soft)] px-1.5 py-[1px] text-[11px] font-medium text-[var(--color-on-brand-soft)]">首推</span>
                </div>
                <p className="mt-0.5 text-[12px] leading-5 text-[var(--color-text-tertiary)]">{plugin.description}</p>
              </div>
              <Switch checked={on} onChange={value => void toggle(plugin.name, value)} label={`启用 ${plugin.title}`} labelHidden disabled={!loaded} />
            </div>
            <div className="flex flex-wrap gap-1">
              {plugin.tools.map(tool => <span key={tool} className="rounded-full bg-[var(--color-surface-container)] px-2 py-0.5 text-[11px] text-[var(--color-text-secondary)]">{tool}</span>)}
            </div>
            <div className="flex flex-wrap gap-1.5 text-[11px]">
              {plugin.skills.map(skill => (
                <button key={skill} type="button" title="复制命令" onClick={() => void navigator.clipboard.writeText(`${skill} `).then(() => toast('success', `已复制 ${skill}，粘贴到对话框使用`))} className="rounded border border-[var(--color-border)] px-1.5 py-0.5 font-mono text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-hover)]">{skill}</button>
              ))}
            </div>
          </div>
        )
      })}
    </div>
  )
}

/** 能力测试: checks the STAR service item by item, at the end of the STAR 首推 section. */
export function StarCapabilityTest() {
  const status = useStarStore(s => s.status)
  const [run, setRun] = useState<StarCheckRun | null>(null)
  const [includeGeneration, setIncludeGeneration] = useState(false)
  const poll = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    let alive = true
    starApi.check().then(({ run: last }) => { if (alive && last) setRun(last) }).catch(() => undefined)
    return () => {
      alive = false
      if (poll.current) clearTimeout(poll.current)
    }
  }, [])

  const follow = () => {
    poll.current = setTimeout(async () => {
      try {
        const { run: next } = await starApi.check()
        setRun(next)
        if (next && !next.finishedAt) follow()
        else void useStarStore.getState().refreshQuota()
      } catch {
        follow()
      }
    }, 1000)
  }

  const start = async () => {
    if (!status?.signedIn) {
      useStarStore.getState().openLogin()
      return
    }
    try {
      const { run: next } = await starApi.startCheck(includeGeneration)
      setRun(next)
      follow()
    } catch (error) {
      toast('error', starErrorText(error))
    }
  }

  const runningCheck = Boolean(run && !run.finishedAt)
  const passed = run?.items.filter(item => item.status === 'pass').length ?? 0
  const failed = run?.items.filter(item => item.status === 'fail').length ?? 0

  return (
    <div data-testid="star-capability-test" className="rounded-[var(--radius-lg)] border border-[var(--color-border)] p-4">
      <div className="flex flex-wrap items-center gap-3">
        <BookOpenCheck size={18} strokeWidth={1.75} className="text-[var(--color-brand)]" aria-hidden="true" />
        <div className="min-w-0 flex-1">
          <h3 className="text-[14px] font-semibold text-[var(--color-text-primary)]">能力测试</h3>
          <p className="text-[12px] text-[var(--color-text-tertiary)]">逐项检测服务连接、账号额度、模型目录、对话中转、联网搜索、学术论文、网页阅读、多模态识图和文件识别。对话测试、网页阅读和识图各用一次对话额度。</p>
        </div>
        <label className="flex items-center gap-1.5 text-[12px] text-[var(--color-text-secondary)]">
          <input type="checkbox" checked={includeGeneration} onChange={event => setIncludeGeneration(event.target.checked)} />
          实际生成一张图片（消耗积分）
        </label>
        <Button size="md" loading={runningCheck} onClick={() => void start()}>{runningCheck ? '测试中…' : run ? '重新测试' : '开始测试'}</Button>
      </div>
      {run ? (
        <div className="mt-3">
          <div className="mb-2 text-[12px] text-[var(--color-text-tertiary)]">
            {run.finishedAt ? `测试完成：通过 ${passed} 项，失败 ${failed} 项` : '正在逐项测试…'}
          </div>
          <ul className="overflow-hidden rounded-[var(--radius-md)] border border-[var(--color-border)]">
            {run.items.map(item => (
              <li key={item.id} className="flex items-start gap-2.5 border-b border-[var(--color-border)] px-3 py-2 text-[12px] last:border-b-0">
                <span className="mt-0.5 shrink-0">{STATUS_ICON[item.status]}</span>
                <span className="w-[96px] shrink-0 font-medium text-[var(--color-text-primary)]">{item.label}</span>
                <span className="min-w-0 flex-1 leading-5 text-[var(--color-text-secondary)]">{item.detail || '等待中'}</span>
                {item.latencyMs !== undefined ? <span className="shrink-0 tabular-nums text-[var(--color-text-tertiary)]">{item.latencyMs} ms</span> : null}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  )
}
