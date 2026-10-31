import {
  CalendarCheck,
  FileBarChart2,
  Globe,
  GraduationCap,
  Image,
  Newspaper,
  Radar,
  ShieldCheck,
  type LucideIcon,
} from 'lucide-react'
import { useStarBrand } from '../../stores/starBrandStore'
import type { NewTaskTemplate } from '../tasks/NewTaskModal'

export type StarTaskTemplate = NewTaskTemplate & {
  id: string
  icon: LucideIcon
  /** How the schedule reads on the card. */
  scheduleLabel: string
  summary: string
}

/**
 * Eight ready-made tasks a new user can start from; each opens the editor prefilled.
 * `{brand}` in a summary or prompt is the console's product name, filled in when shown or picked.
 */
export const STAR_TASK_TEMPLATES: readonly StarTaskTemplate[] = [
  {
    id: 'ai-news',
    icon: Newspaper,
    name: 'AI 行业早报',
    scheduleLabel: '工作日 09:00',
    summary: '联网搜索过去 24 小时的 AI 大事，整理成带来源的早报',
    description: '每个工作日早上汇总 AI 行业新闻',
    cron: '0 9 * * 1-5',
    prompt: '/star-web-search 搜索过去 24 小时 AI 行业的重要新闻（模型发布、产品更新、融资并购、政策监管），去掉重复和营销稿，整理成 6–8 条早报：每条一句话说清发生了什么、为什么重要，并附来源链接。最后用一句话总结今天最值得关注的趋势。',
  },
  {
    id: 'competitor-weekly',
    icon: Radar,
    name: '竞品动态周报',
    scheduleLabel: '每周一 10:00',
    summary: '跟踪竞品的新功能、价格和市场动作，周一给你一份周报',
    description: '每周一汇总竞品动态',
    cron: '0 10 * * 1',
    prompt: '/star-web-search 调研以下竞品过去 7 天的动态：【在这里填写竞品名称，例如 产品A、产品B、产品C】。关注新功能发布、价格调整、融资与合作、用户口碑。按竞品分节输出，每节列 3–5 条要点并附来源链接，最后给出对我们的 3 条可执行建议。',
  },
  {
    id: 'paper-tracker',
    icon: GraduationCap,
    name: '论文追踪',
    scheduleLabel: '每周三 09:00',
    summary: '检索一周内的新论文，挑出最值得读的 5 篇',
    description: '每周追踪一个研究方向的新论文',
    cron: '0 9 * * 3',
    prompt: '/star-paper-search 检索最近一周「大模型智能体（LLM agents）」方向的新论文和预印本，挑出最值得读的 5 篇。每篇给出：标题、作者与机构、发表来源和年份、一句话核心贡献、链接（DOI 或 arXiv）。最后用三句话概括这一周的研究趋势。研究方向可以改成你关心的主题。',
  },
  {
    id: 'weekly-report',
    icon: FileBarChart2,
    name: '周报草稿',
    scheduleLabel: '每周五 17:30',
    summary: '根据本周的提交和会话记录，写好周报初稿',
    description: '每周五生成本周工作周报草稿',
    cron: '30 17 * * 5',
    prompt: '查看这个项目本周（周一到今天）的 git 提交记录和改动的文件，写一份工作周报草稿：1. 本周进展（按功能或模块归类）；2. 遇到的问题与风险；3. 下周计划。语言简洁，适合直接发给团队；把草稿保存为项目根目录下的 weekly-report.md，并在回复里给出全文。',
  },
  {
    id: 'daily-plan',
    icon: CalendarCheck,
    name: '今日待办梳理',
    scheduleLabel: '工作日 08:30',
    summary: '开工前梳理项目里的 TODO 和未完成事项，排出今天的优先级',
    description: '每个工作日早上梳理今日待办',
    cron: '30 8 * * 1-5',
    prompt: '检查这个项目中的 TODO / FIXME 注释、最近 3 天的 git 提交和未提交的改动，列出今天最值得做的 3 件事，按优先级排序，每件事说明原因和预计耗时。不要修改任何文件。',
  },
  {
    id: 'dependency-audit',
    icon: ShieldCheck,
    name: '依赖与安全巡检',
    scheduleLabel: '每周一 09:30',
    summary: '检查依赖的已知漏洞和重大版本更新，只给建议不改文件',
    description: '每周检查一次项目依赖',
    cron: '30 9 * * 1',
    prompt: '检查这个项目的依赖清单（package.json、requirements.txt、pyproject.toml、go.mod 等），运行可用的审计命令（如 npm audit、pip-audit），列出：有已知安全漏洞的依赖（严重程度、影响、修复版本）、落后多个大版本的依赖。给出建议的升级命令和风险提示。只读检查，不要修改任何文件。',
  },
  {
    id: 'site-monitor',
    icon: Globe,
    name: '网站可用性巡检',
    scheduleLabel: '每 2 小时',
    summary: '定时打开指定网址，记录能否访问和响应时间',
    description: '每 2 小时检查一次网站是否正常',
    cron: '0 */2 * * *',
    prompt: '检查以下网址能否正常访问：【在这里填写网址，例如 https://example.com】。对每个网址记录 HTTP 状态码和响应时间；无法访问或状态码不是 2xx/3xx 时，说明可能的原因（DNS、证书、超时、服务端错误）。全部正常时只回复一行“全部正常”和各自的响应时间。',
  },
  {
    id: 'daily-image',
    icon: Image,
    name: '每日一图',
    scheduleLabel: '每天 08:00',
    summary: '用 {brand} 文生图生成当天的社媒配图（每次约 1 积分）',
    description: '每天生成一张社媒配图',
    cron: '0 8 * * *',
    prompt: '调用 {brand} 文生图工具 mcp__plugin_star-image_star__star_text_to_image，为今天生成一张社交媒体配图：根据今天的日期、节气或节日确定主题，风格清新、构图简洁、适合 1:1 方图，ratio 传 1:1。完成后告诉我图片的本地路径，并配一句 30 字以内的文案。',
  },
]

/** 快捷模板 on the scheduled tasks page. */
export function StarTaskTemplates({ onPick }: { onPick: (template: StarTaskTemplate) => void }) {
  const brand = useStarBrand()
  return (
    <section aria-labelledby="star-task-templates-title" data-testid="star-task-templates">
      <div className="mb-2.5 flex items-baseline gap-2">
        <h2 id="star-task-templates-title" className="text-[14px] font-semibold text-[var(--color-text-primary)]">快捷模板</h2>
        <span className="text-[12px] text-[var(--color-text-tertiary)]">点一个模板，预填好名称、指令和时间，确认后即可创建</span>
      </div>
      <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 lg:grid-cols-4">
        {STAR_TASK_TEMPLATES.map(template => {
          const Icon = template.icon
          return (
            <button
              key={template.id}
              type="button"
              data-testid={`star-task-template-${template.id}`}
              onClick={() => onPick({ ...template, summary: brand.format(template.summary), prompt: brand.format(template.prompt) })}
              className="group flex min-w-0 flex-col gap-2 rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-surface-container-lowest)] p-3 text-left transition-[border-color,background-color] hover:border-[var(--color-border-strong)] hover:bg-[var(--color-surface-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-border-focus)]"
            >
              <div className="flex items-center gap-2">
                <span className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-[var(--radius-md)] bg-[var(--color-brand-soft)] text-[var(--color-on-brand-soft)]">
                  <Icon size={15} strokeWidth={1.75} aria-hidden="true" />
                </span>
                <span className="min-w-0 flex-1 truncate text-[13px] font-semibold text-[var(--color-text-primary)]">{template.name}</span>
              </div>
              <span className="line-clamp-2 min-h-[2.5em] text-[12px] leading-[1.25rem] text-[var(--color-text-secondary)]">{brand.format(template.summary)}</span>
              <span className="text-[11px] tabular-nums text-[var(--color-text-tertiary)]">{template.scheduleLabel}</span>
            </button>
          )
        })}
      </div>
    </section>
  )
}
