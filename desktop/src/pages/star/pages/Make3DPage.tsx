import { useState } from 'react'
import { Armchair, ArrowUp, Box, Building2, Cpu, Gamepad2, Globe, Palette, Printer, Shapes, Star, type LucideIcon } from 'lucide-react'
import { starApi, starErrorText } from '@/api/star'
import { seedStarComposer } from '../../../components/star/starComposerSeed'
import { useUIStore } from '../../../stores/uiStore'
import { PillTabs, StarPageShell, useLoad } from './StarPageShell'

type MakeType = 'web' | 'model' | 'print'
type MakeCategory = 'featured' | 'art' | 'life' | 'arch' | 'tech' | 'game' | 'other'
type Template = { id: string; type: MakeType; category: MakeCategory; title: string; summary: string; prompt: string; coverUrl?: string; remote?: boolean }

const TYPES: { id: MakeType; label: string; desc: string; icon: LucideIcon }[] = [
  { id: 'web', label: '3D 网页', desc: '可拖拽旋转的交互式 3D 页面（Three.js）', icon: Globe },
  { id: 'model', label: '3D 建模', desc: '生成 glb / obj 模型，附在线预览', icon: Box },
  { id: 'print', label: '3D 打印', desc: '输出可直接切片打印的 STL 文件', icon: Printer },
]

const CATEGORIES: { id: MakeCategory; label: string; icon: LucideIcon }[] = [
  { id: 'featured', label: '精选模板', icon: Star },
  { id: 'art', label: '设计与艺术', icon: Palette },
  { id: 'life', label: '生活好物', icon: Armchair },
  { id: 'arch', label: '建筑设计', icon: Building2 },
  { id: 'tech', label: '科技探索', icon: Cpu },
  { id: 'game', label: '游戏', icon: Gamepad2 },
  { id: 'other', label: '其他', icon: Shapes },
]

const t = (id: string, type: MakeType, category: MakeCategory, title: string, summary: string, prompt: string): Template => ({ id, type, category, title, summary, prompt })

/** The console stores the category label (精选模板 …); older entries may carry the id. */
function toCategory(value: string): MakeCategory {
  const match = CATEGORIES.find(cat => cat.id === value || cat.label === value)
  return match ? match.id : 'other'
}

/** Shown until templates are published from the console (总后台 → 3D 模型管理). */
const BUILT_IN: Template[] = [
  t('solar', 'web', 'featured', '太阳系漫游', '八大行星按真实比例公转，可点击查看资料', '做一个可交互的 3D 太阳系网页：八大行星绕太阳公转，鼠标拖拽旋转视角、滚轮缩放，点击行星弹出简介卡片，星空背景。'),
  t('product', 'web', 'featured', '产品 360° 展示', '材质与配色切换、热点标注', '做一个耳机产品的 3D 展示网页：用基础几何体组合出耳机造型，支持 360° 旋转、3 种配色切换和 3 个卖点热点标注，柔和棚拍灯光。'),
  t('lowpoly-house', 'model', 'featured', '低多边形小屋', '适合游戏与插画的场景资产', '建一个低多边形风格的林间小屋模型（屋顶、烟囱、门窗、两棵树），输出 glb，并生成一个可预览模型的 HTML 页面。'),
  t('phone-stand', 'print', 'featured', '手机支架', '免支撑可打印，角度 60°', '设计一个可 3D 打印的手机支架：底座 80×70mm，支撑角 60°，留充电线槽，免支撑打印，输出 STL 并说明推荐切片参数。'),
  t('sculpture', 'web', 'art', '流体雕塑', '随鼠标变形的抽象雕塑', '做一个抽象流体雕塑的 3D 网页：一个随时间缓慢变形的金属质感球体，鼠标靠近时表面产生涟漪，暗色背景与环境反射。'),
  t('gallery', 'web', 'art', '虚拟画廊', '第一人称漫游的线上展厅', '做一个第一人称可漫游的虚拟画廊网页：WASD 移动，墙上挂 6 幅画（用纯色渐变占位框标注作品名），柔和聚光灯。'),
  t('vase', 'print', 'life', '螺旋花瓶', '参数化螺旋纹理', '设计一个参数化螺旋纹理花瓶，高 180mm、口径 70mm、壁厚 2mm，可单层壁打印（花瓶模式），输出 STL。'),
  t('lamp', 'model', 'life', '北欧台灯', '可调节灯臂的台灯模型', '建一个北欧风台灯模型：圆形底座、两节灯臂、锥形灯罩，输出 glb，并做一个可旋转预览的 HTML 页面。'),
  t('pavilion', 'web', 'arch', '展亭方案', '日照与阴影实时变化', '做一个现代展亭建筑方案的 3D 网页：钢结构屋面与玻璃幕墙，提供时间滑块模拟一天中的日照与阴影变化。'),
  t('floorplan', 'model', 'arch', '两居室户型', '从平面图拉伸成三维户型', '把一个 85㎡ 两居室户型（客厅、两卧、厨卫、阳台）建成三维户型模型，墙高 2.8m，输出 glb 和带俯视/漫游切换的预览页。'),
  t('rocket', 'web', 'tech', '火箭发射', '分级分离动画', '做一个火箭发射的 3D 网页动画：点火、升空、一二级分离、整流罩打开，配简洁的时间轴控制条。'),
  t('chip', 'model', 'tech', '芯片结构', '分层爆炸视图', '建一个芯片封装的分层模型（基板、晶圆、散热盖），支持爆炸视图展开，输出 glb 与预览页。'),
  t('runner', 'web', 'game', '跑酷小游戏', '三车道躲避障碍', '做一个 3D 跑酷小游戏网页：三车道，左右键换道、空格跳跃，随机生成障碍和金币，显示分数，撞到障碍后可重开。'),
  t('dice', 'print', 'game', '桌游骰子', '倒角数字骰子', '设计一套可打印的桌游骰子（D6 与 D20），带倒角与凹刻数字，输出 STL。'),
  t('molecule', 'web', 'other', '分子结构', '球棍模型可旋转', '做一个咖啡因分子结构的 3D 网页：球棍模型，原子按元素着色，悬停显示元素名，可旋转缩放。'),
]

export function Make3DPage() {
  const [type, setType] = useState<MakeType>('web')
  const [category, setCategory] = useState<MakeCategory>('featured')
  const [prompt, setPrompt] = useState('')
  const [busy, setBusy] = useState(false)
  const remote = useLoad(() => starApi.templates3d(), '3d-templates')
  const templates: Template[] = remote.data?.items.length
    ? remote.data.items.map(item => ({
        id: item.id,
        type: (['web', 'model', 'print'].includes(item.type) ? item.type : 'web') as MakeType,
        category: toCategory(item.category),
        title: item.title,
        summary: item.summary,
        prompt: item.prompt || item.summary,
        ...(item.coverUrl ? { coverUrl: item.coverUrl } : {}),
        remote: true,
      }))
    : BUILT_IN
  const shown = templates.filter(item => item.category === category)

  const start = async () => {
    const text = prompt.trim()
    if (!text || busy) return
    setBusy(true)
    try {
      const folder = await starApi.createLocalProject(`3D-${text.slice(0, 16)}`)
      const guide = type === 'web'
        ? '用 Three.js（通过 CDN 引入）做成单文件 index.html，支持鼠标旋转缩放；完成后告诉我如何预览。'
        : type === 'model'
          ? '用 Python（trimesh / numpy）或 Blender 脚本生成模型，导出 model.glb，并写一个用 <model-viewer> 预览的 preview.html。'
          : '用 Python（numpy-stl / trimesh）或 OpenSCAD 生成可打印的实体模型，导出 model.stl，检查壁厚与悬垂，并给出切片建议。'
      seedStarComposer(`${text}\n\n${guide}`, { workDir: folder.path })
    } catch (error) {
      useUIStore.getState().addToast({ type: 'error', message: starErrorText(error) })
    }
    setBusy(false)
  }

  const Category = CATEGORIES.find(cat => cat.id === category)!

  return (
    <StarPageShell icon={Box} title="3D Make" description="选择类型，描述想做的东西：3D 网页、模型或可打印文件都在你的电脑上生成。">
      <div className="mx-auto mt-2 max-w-[860px]">
        <div className="mb-3 text-[13px] text-[var(--color-text-secondary)]">选择类型</div>
        <div className="grid grid-cols-3 gap-3">
          {TYPES.map(item => (
            <button key={item.id} type="button" onClick={() => setType(item.id)}
              className={`flex items-start gap-3 rounded-[var(--radius-lg)] border p-3 text-left transition-colors ${type === item.id ? 'border-[var(--color-text-accent)] bg-[var(--color-brand-soft)]' : 'border-[var(--color-border)] hover:border-[var(--color-border-strong)]'}`}>
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[var(--radius-md)] bg-[var(--color-surface-container)] text-[var(--color-text-accent)]"><item.icon size={18} aria-hidden="true" /></span>
              <span className="min-w-0"><span className="block text-[14px] font-medium text-[var(--color-text-primary)]">{item.label}</span><span className="block text-[12px] text-[var(--color-text-tertiary)]">{item.desc}</span></span>
            </button>
          ))}
        </div>
        <div className="mt-4 rounded-[var(--radius-xl)] border border-[var(--color-border)] bg-[var(--color-surface-container-lowest)] p-3">
          <textarea value={prompt} onChange={event => setPrompt(event.target.value)} rows={3}
            onKeyDown={event => { if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); void start() } }}
            placeholder={`描述要做的${TYPES.find(item => item.id === type)!.label}，或从下面的模板开始`}
            className="w-full resize-none bg-transparent px-1 text-[14px] leading-6 text-[var(--color-text-primary)] outline-none placeholder:text-[var(--color-text-tertiary)]" />
          <div className="flex justify-end">
            <button type="button" aria-label="开始" disabled={!prompt.trim() || busy} onClick={() => void start()} className="flex h-8 w-8 items-center justify-center rounded-full bg-[var(--color-btn-primary-bg)] text-[var(--color-btn-primary-fg)] disabled:opacity-40"><ArrowUp size={16} aria-hidden="true" /></button>
          </div>
        </div>
      </div>
      <div className="mt-8"><PillTabs items={CATEGORIES} value={category} onChange={setCategory} size="sm" /></div>
      <div className="mt-4 grid grid-cols-2 gap-4 lg:grid-cols-3 xl:grid-cols-4">
        {shown.map(item => (
          <button key={item.id} type="button" onClick={() => { setType(item.type); setPrompt(item.prompt); if (item.remote) starApi.use3dTemplate(item.id) }}
            className="overflow-hidden rounded-[var(--radius-lg)] border border-[var(--color-border)] text-left transition-colors hover:border-[var(--color-border-strong)]">
            <div className="flex aspect-[4/3] items-center justify-center bg-[var(--color-surface-container)]">
              {item.coverUrl ? <img src={item.coverUrl} alt="" className="h-full w-full object-cover" /> : <Category.icon size={34} strokeWidth={1.3} className="text-[var(--color-text-tertiary)]" aria-hidden="true" />}
            </div>
            <div className="px-3 py-2.5">
              <div className="flex items-center gap-1.5">
                <span className="truncate text-[13px] font-medium text-[var(--color-text-primary)]">{item.title}</span>
                <span className="shrink-0 rounded px-1 text-[11px] leading-4 text-[var(--color-text-tertiary)] ring-1 ring-[var(--color-border)]">{TYPES.find(entry => entry.id === item.type)!.label}</span>
              </div>
              <div className="mt-0.5 line-clamp-2 text-[12px] leading-[18px] text-[var(--color-text-tertiary)]">{item.summary}</div>
            </div>
          </button>
        ))}
      </div>
      {remote.data?.source === 'none' ? <p className="mt-6 text-[11px] text-[var(--color-text-tertiary)]">当前展示内置模板；在总后台「3D 模型管理」发布模板后会显示在这里。</p> : null}
    </StarPageShell>
  )
}
