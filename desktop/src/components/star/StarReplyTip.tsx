import { useState } from 'react'
import { Lightbulb } from 'lucide-react'
import { useStarStore } from '../../stores/starStore'
import { useStarBrand } from '../../stores/starBrandStore'

/** Things worth knowing about STAR, shown one at a time while a reply runs. */
export const STAR_REPLY_TIPS = [
  '输入 / 可以调用技能和插件，比如 /star-web-search 联网搜索',
  '输入 @ 可以引用项目里的文件，{brand} 会先读它再回答',
  '对话框左下角的「创作」可以直接文生图、文生视频',
  '把 PDF、Word、Excel 或图片拖进对话框，{brand} 会读取内容',
  '「定时任务」可以让 {brand} 每天自动整理日报、监控网页',
  '「日历」里能同时看到日程、看板截止日和定时任务',
  '看板里的任务点「交给 {brand}」，会在新对话里开始处理',
  '模型选择框支持搜索，也可以按品牌筛选',
  '「插件」里可以开关 {brand} 内置插件，新会话生效',
  '设置 → 个性化里可以打开桌面宠物，随时查看任务进度',
  '项目文件夹在对话框下方选择，也可以不使用文件夹直接开始',
  '设置 → 通用里可以改成 Ctrl+Enter 发送，Enter 换行',
] as const

/** A tip shows once the reply has run this long, so quick answers stay quiet. */
export const FIRST_TIP_AFTER_S = 3
/** Each tip stays this long before the next one. */
export const TIP_EVERY_S = 8

/**
 * The rotating tip under the turn's status line, off in 设置 → 通用. It keeps
 * no timer of its own: the turn's elapsed seconds, already counted by the chat
 * store, decide when it appears and when it moves on. It starts from a random
 * tip, so a long session does not repeat the same first line.
 */
export function StarReplyTip({ elapsedSeconds }: { elapsedSeconds: number }) {
  const enabled = useStarStore(s => s.replyTipsEnabled)
  const brand = useStarBrand()
  const [offset] = useState(() => Math.floor(Math.random() * STAR_REPLY_TIPS.length))
  if (!enabled || elapsedSeconds < FIRST_TIP_AFTER_S) return null
  const index = (offset + Math.floor((elapsedSeconds - FIRST_TIP_AFTER_S) / TIP_EVERY_S)) % STAR_REPLY_TIPS.length
  return (
    <div data-testid="star-reply-tip" className="flex min-h-5 max-w-full items-center gap-1.5 pl-[23px] text-[12px] text-[var(--color-text-tertiary)]">
      <Lightbulb size={12} strokeWidth={1.75} aria-hidden="true" className="shrink-0" />
      <span className="min-w-0 truncate">小技巧：{brand.format(STAR_REPLY_TIPS[index]!)}</span>
    </div>
  )
}
