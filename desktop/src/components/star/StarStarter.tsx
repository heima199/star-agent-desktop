import { useState } from 'react'
import {
  ArrowUp,
  BarChart3,
  Box,
  Clapperboard,
  Columns2,
  FileText,
  Film,
  Globe,
  Image,
  Images,
  Lightbulb,
  Presentation,
  ScanEye,
  Star,
  Telescope,
  Video,
  Wand2,
  type LucideIcon,
} from 'lucide-react'
import { useTabStore } from '../../stores/tabStore'
import type { StarMode } from '../../stores/starStore'
import { useStarBrand } from '../../stores/starBrandStore'
import { useStarCreateStore } from '../../stores/starCreateStore'
import { starCreateSpec, type StarCreateMode } from '../../lib/starCreateRequest'
import { setStarStudioPrefill, STAR_STUDIO_TAB_ID, starStudioTabTitle } from './starTabs'
import { isStarPageHidden, openStarPage, STAR_PAGE_TITLES, type StarPageId } from './starPages'

/** `mode` prompts arm that STAR 创作 mode in the composer; the others are plain text or a skill command. */
type Prompt = { tag?: string; text: string; mode?: StarCreateMode }
type Category = { id: string; label: string; icon: LucideIcon; mode?: StarCreateMode; page?: StarPageId; prompts: Prompt[] }

const WORK: Category[] = [
  { id: 'recommend', label: '推荐', icon: Star, prompts: [
    { tag: 'PPT', text: '做一份 12 页的季度经营复盘 PPT，数据页配图表，深色商务风' },
    { tag: '专业研究', text: '/star-web-search 调研 2026 年 AI Agent 行业的最新进展，给出带来源的研究报告' },
    { tag: '网站', text: '为一家精品咖啡店做一个单页官网：品牌故事、菜单、门店地图和预约表单' },
    { tag: '数据分析', text: '分析这份销售表格，找出增长最快的品类和区域，生成带图表的报告' },
  ] },
  { id: 'ppt', label: 'PPT', icon: Presentation, page: 'ppt', prompts: [
    { tag: '制作PPT', text: '做一份 12 页的季度经营复盘 PPT，数据页配图表，深色商务风' },
    { text: '把我提供的材料整理成 10 页演示文稿的大纲和逐页讲稿' },
  ] },
  { id: 'research', label: '专业研究', icon: Telescope, prompts: [
    { tag: '联网搜索', text: '/star-web-search 调研 2026 年 AI Agent 行业的最新进展，给出带来源的报告' },
    { tag: '学术论文', text: '/star-paper-search 检索多智能体协作方向近两年的代表性论文，并写一份文献综述' },
    { tag: 'PDF 识别', text: '/star-pdf 分析我上传的年报 PDF，提炼营收、利润、现金流的关键变化' },
  ] },
  { id: 'website', label: '网站', icon: Globe, prompts: [
    { text: '为一家精品咖啡店做一个单页官网：品牌故事、菜单、门店地图和预约表单' },
    { text: '做一个产品发布落地页，带首屏动效、功能介绍、价格表和常见问题' },
  ] },
  { id: 'doc', label: '文档', icon: FileText, prompts: [
    { text: '根据我提供的材料，写一份结构完整的项目立项申请书，导出为 Word' },
    { text: '把本周的工作记录整理成周报：主要进展、问题与风险、下周计划' },
  ] },
  { id: 'data', label: '数据分析', icon: BarChart3, prompts: [
    { tag: '分析数据', text: '分析这份销售表格，找出增长最快的品类和区域，生成带图表的报告' },
    { text: '清洗这份 Excel 数据，统计关键指标并标出异常值' },
  ] },
  { id: 'board', label: '看板', icon: Lightbulb, page: 'board', prompts: [
    { text: '把这个项目拆成任务看板：待办 / 进行中 / 已完成，每个任务写清负责人和截止日期' },
  ] },
  { id: '3d', label: '3D', icon: Box, page: '3d', prompts: [
    { tag: '3D 网页', text: '做一个可以拖拽旋转的 3D 产品展示网页（Three.js），带灯光和材质切换' },
    { tag: '3D 建模', text: '用 Blender Python 脚本建一个低多边形风格的小屋模型并导出 glb' },
  ] },
]

const DESIGN: Category[] = [
  { id: 't2i', label: '文生图', icon: Wand2, mode: 'text2image', prompts: [
    { text: '雨夜霓虹街道上漫步的橘猫，赛博朋克风格，3:4' },
    { text: '极简风格的咖啡品牌 logo，白底，生成 4 张备选' },
  ] },
  { id: 'i2i', label: '图生图', icon: Image, mode: 'image2image', prompts: [
    { text: '把这张照片改成吉卜力动画风格，保留人物神态' },
  ] },
  { id: 'multi', label: '多图生图', icon: Images, mode: 'multi2image', prompts: [
    { text: '把图1的人物穿上图2的服装，背景换成图3' },
  ] },
  { id: 't2v', label: '文生视频', icon: Video, mode: 'text2video', prompts: [
    { text: '清晨的海边，镜头缓缓推进，阳光洒在海浪上，5 秒' },
  ] },
  { id: 'i2v', label: '图生视频', icon: Film, mode: 'image2video', prompts: [
    { text: '让这张图片里的人物缓缓转身微笑，镜头轻微推进' },
  ] },
  { id: 'frames', label: '首尾帧', icon: Columns2, mode: 'frames2video', prompts: [
    { text: '从第一张图平滑过渡到第二张图，镜头环绕，光线由暗变亮' },
  ] },
  { id: 'm2v', label: '多图生视频', icon: Images, mode: 'multi2video', prompts: [
    { text: '用这几张产品图生成一段 360° 旋转展示视频，干净的棚拍背景' },
  ] },
  { id: 'v2v', label: '视频参考', icon: Clapperboard, mode: 'video2video', prompts: [
    { text: '参考这段视频的运镜，生成一段城市夜景延时' },
  ] },
  { id: 'look', label: '多模态', icon: ScanEye, mode: 'vision', prompts: [
    { text: '描述这张图片的构图、配色和风格，并给出复刻它的提示词' },
  ] },
]

const STUDIO_ENTRY: Partial<Record<StarCreateMode, { kind: 'image' | 'video'; mode: string }>> = {
  text2image: { kind: 'image', mode: 'text2image' },
  image2image: { kind: 'image', mode: 'image2image' },
  multi2image: { kind: 'image', mode: 'multi2image' },
  text2video: { kind: 'video', mode: 'text2video' },
  image2video: { kind: 'video', mode: 'image2video' },
  frames2video: { kind: 'video', mode: 'frames2video' },
  multi2video: { kind: 'video', mode: 'multi2video' },
  video2video: { kind: 'video', mode: 'video2video' },
}

/**
 * Starter chips and prompts for the Work and Design modes of the home page.
 * With a composer `slot`, creation prompts arm their STAR 创作 mode there, so
 * the request is sent from the chat itself.
 */
export function StarStarter({ mode, slot, onSuggestion }: { mode: Exclude<StarMode, 'code'>; slot?: string; onSuggestion: (text: string) => void }) {
  // Chat (and the legacy in-chat Design mode) start from the creation modes.
  // A category that leads to a hidden page (PPT, 3D) is not offered.
  const categories = (mode === 'work' ? WORK : DESIGN).filter(category => !category.page || !isStarPageHidden(category.page))
  const [selected, setSelected] = useState(categories[0]!.id)
  const brand = useStarBrand()
  const active = categories.find(category => category.id === selected) ?? categories[0]!
  const studio = active.mode ? STUDIO_ENTRY[active.mode] : undefined

  const choose = (prompt: Prompt) => {
    const createMode = prompt.mode ?? active.mode
    if (createMode && slot) {
      useStarCreateStore.getState().arm(slot, createMode)
      onSuggestion(prompt.text)
      return
    }
    // No composer to arm (or a skill prompt): fall back to the skill command.
    onSuggestion(prompt.text)
  }

  return (
    <div className="flex w-full max-w-[720px] flex-col items-center gap-3" data-testid="star-starter">
      <div role="tablist" aria-label="快速开始" className="flex flex-wrap justify-center gap-2">
        {categories.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={id === active.id}
            onClick={() => setSelected(id)}
            className={`inline-flex h-8 items-center gap-1.5 rounded-[var(--radius-md)] border px-3 text-[13px] transition-colors ${id === active.id ? 'border-[var(--color-text-secondary)] bg-[var(--color-surface-container-lowest)] font-medium text-[var(--color-text-primary)]' : 'border-[var(--color-border)] text-[var(--color-text-secondary)] hover:border-[var(--color-outline)] hover:text-[var(--color-text-primary)]'}`}
          >
            <Icon size={14} strokeWidth={1.75} aria-hidden="true" />
            {label}
          </button>
        ))}
      </div>
      <ul className="w-full">
        {active.prompts.map(prompt => {
          const createMode = prompt.mode ?? active.mode
          const tag = prompt.tag ?? (createMode ? starCreateSpec(createMode).label : undefined)
          return (
            <li key={prompt.text} className="border-b border-[var(--color-border)] last:border-b-0">
              <button
                type="button"
                onClick={() => choose(prompt)}
                className="group flex h-10 w-full items-center gap-2.5 px-2.5 text-left text-[13px] text-[var(--color-text-secondary)] transition-colors hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-text-primary)]"
              >
                {tag ? <span className="shrink-0 font-medium text-[var(--color-brand)]">{tag}</span> : null}
                <span className="min-w-0 flex-1 truncate">{prompt.text.replace(/^\/star-[a-z-]+\s*/, '')}</span>
                <ArrowUp size={14} className="shrink-0 text-[var(--color-text-tertiary)] opacity-60 group-hover:opacity-100" aria-hidden="true" />
              </button>
            </li>
          )
        })}
        {active.mode && slot ? (
          <li className="border-b border-[var(--color-border)]">
            <button
              type="button"
              onClick={() => useStarCreateStore.getState().arm(slot, active.mode!)}
              className="flex h-10 w-full items-center gap-2.5 px-2.5 text-left text-[13px] text-[var(--color-on-brand-soft)] hover:bg-[var(--color-surface-hover)]"
            >
              <active.icon size={14} strokeWidth={1.75} aria-hidden="true" />
              <span>在对话里用「{starCreateSpec(active.mode).label}」创作：{starCreateSpec(active.mode).hint}</span>
            </button>
          </li>
        ) : null}
        {active.page ? (
          <li className="border-b border-[var(--color-border)]">
            <button
              type="button"
              onClick={() => openStarPage(active.page!)}
              className="flex h-10 w-full items-center gap-2.5 px-2.5 text-left text-[13px] text-[var(--color-on-brand-soft)] hover:bg-[var(--color-surface-hover)]"
            >
              <active.icon size={14} strokeWidth={1.75} aria-hidden="true" />
              <span>打开「{STAR_PAGE_TITLES[active.page]}」，浏览模板 →</span>
            </button>
          </li>
        ) : null}
        {studio ? (
          <li>
            <button
              type="button"
              onClick={() => {
                setStarStudioPrefill({ kind: studio.kind, mode: studio.mode })
                useTabStore.getState().openTab(STAR_STUDIO_TAB_ID, starStudioTabTitle(brand.name), 'star-studio')
              }}
              className="flex h-10 w-full items-center gap-2.5 px-2.5 text-left text-[13px] text-[var(--color-text-tertiary)] hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-text-secondary)]"
            >
              <Wand2 size={14} aria-hidden="true" />
              <span>也可以在 {starStudioTabTitle(brand.name)}工作台里批量生成、看进度 →</span>
            </button>
          </li>
        ) : null}
      </ul>
    </div>
  )
}
