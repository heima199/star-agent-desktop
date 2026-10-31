import { useId, useMemo, useRef, useState } from 'react'
import { Briefcase, Check, ChevronDown, Code2, GraduationCap, Megaphone, MessageSquarePlus, PenLine, Play, Plus, Star, TrendingUp, Upload, type LucideIcon } from 'lucide-react'
import { starApi, starErrorText } from '@/api/star'
import { Modal } from '@/components/ui/Modal'
import { MarkdownRenderer } from '@/components/markdown/MarkdownRenderer'
import { useDismissable } from '@/hooks/useDismissable'
import { useMarketStore } from '@/stores/marketStore'
import { useSkillStore } from '@/stores/skillStore'
import { useStarBrand } from '@/stores/starBrandStore'
import { seedStarComposer } from '../../../components/star/starComposerSeed'
import { PillTabs, useLoad } from '../pages/StarPageShell'
import { SKILL_CATEGORIES, marketSkillMarkdown, type MarketSkill, type SkillCategoryId } from './skillCatalog'
import { ALL_MARKET_SKILLS, installMarketSkill, runSkill, toast } from './marketActions'

const CATEGORY_ICON: Record<SkillCategoryId, LucideIcon> = {
  featured: Star,
  office: Briefcase,
  finance: TrendingUp,
  content: PenLine,
  academic: GraduationCap,
  marketing: Megaphone,
  engineering: Code2,
}

/** Cards shown per category before 查看全部. */
const COLLAPSED_COUNT = 6

type Installed = { id: string; name: string; description: string; disabled: boolean; updatedAt: number }

/** Same monochrome tile as the plugin icons: white glyph on the dark theme, no per-category tint. */
export function SkillIcon({ category, size = 40 }: { category: SkillCategoryId; size?: number }) {
  const Icon = CATEGORY_ICON[category]
  return (
    <span data-testid="skill-icon" className="flex shrink-0 items-center justify-center rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface-container-low)] text-[var(--color-text-primary)]" style={{ width: size, height: size }}>
      <Icon size={Math.round(size * 0.48)} strokeWidth={1.75} aria-hidden="true" />
    </span>
  )
}

function slugFromMarkdown(markdown: string, fileName: string): string {
  const name = /^---[\s\S]*?\nname:\s*([^\n]+)/.exec(markdown)?.[1]?.trim().replace(/^["']|["']$/g, '') ?? ''
  const base = (name || fileName.replace(/\.md$/i, '')).toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '')
  return base.length >= 2 ? base.slice(0, 60) : `skill-${Date.now().toString(36)}`
}

/** Settings → Skills and 我的技能 read the skill store; keep them in step with installs made here. */
function refreshInstalledSkills() {
  void useSkillStore.getState().fetchSkills()
}

/**
 * STAR's curated skills, shown above the skill market on the 插件 page's 技能
 * section. The market's search box filters these too; installed skills are
 * managed under 我的技能.
 */
export function StarSkillsShelf() {
  const headingId = useId()
  const brand = useStarBrand()
  const query = useMarketStore(state => state.query)
  const [category, setCategory] = useState<SkillCategoryId>('featured')
  const [expanded, setExpanded] = useState(false)
  const [detail, setDetail] = useState<{ skill?: MarketSkill; installed?: Installed } | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [menuOpen, setMenuOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  useDismissable({ open: menuOpen, refs: [menuRef], onDismiss: () => setMenuOpen(false) })
  const installed = useLoad(() => starApi.installedSkills(), 'installed-skills')
  const installedMap = useMemo(() => new Map((installed.data?.skills ?? []).map(item => [item.id, item])), [installed.data])

  const q = query.trim().toLowerCase()
  const skills = useMemo(() => ALL_MARKET_SKILLS.filter(skill => q
    ? skill.name.toLowerCase().includes(q) || skill.desc.toLowerCase().includes(q)
    : skill.category === category), [category, q])
  const shown = q || expanded ? skills : skills.slice(0, COLLAPSED_COUNT)

  const install = async (skill: MarketSkill) => {
    setBusy(skill.id)
    if (await installMarketSkill(skill)) {
      installed.reload()
      refreshInstalledSkills()
    }
    setBusy(null)
  }
  const toggle = async (id: string) => {
    setBusy(id)
    try {
      const result = await starApi.toggleSkill(id)
      toast('success', result.disabled ? '已禁用' : '已启用')
      installed.reload()
      refreshInstalledSkills()
    } catch (error) {
      toast('error', starErrorText(error))
    }
    setBusy(null)
  }
  const remove = async (id: string) => {
    setBusy(id)
    try {
      await starApi.removeSkill(id)
      toast('success', '已卸载，文件已移到 skills/.trash')
      installed.reload()
      refreshInstalledSkills()
      setDetail(null)
    } catch (error) {
      toast('error', starErrorText(error))
    }
    setBusy(null)
  }
  const upload = async (file: File) => {
    try {
      const markdown = await file.text()
      if (!/^---[\s\S]*?\n---/.test(markdown)) throw new Error('SKILL.md 需要以 --- 包裹的 name / description 开头')
      const id = slugFromMarkdown(markdown, file.name)
      await starApi.installSkill(id, markdown)
      toast('success', `已上传技能 ${id}，可在「我的技能」里管理`)
      installed.reload()
      refreshInstalledSkills()
    } catch (error) {
      toast('error', starErrorText(error))
    }
  }
  const open = (skill: MarketSkill) => {
    const added = installedMap.get(skill.id)
    setDetail({ skill, ...(added ? { installed: added } : {}) })
  }

  // A search with no curated match leaves the market results on their own.
  if (q && skills.length === 0) return null

  return (
    <section aria-labelledby={headingId} data-testid="star-skills-shelf" className="mb-6 border-b border-[var(--color-border)] pb-6">
      <div className="mb-3 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 id={headingId} className="text-[15px] font-semibold text-[var(--color-text-primary)]">{brand.name} 精选技能</h2>
          <p className="mt-1 text-[12px] text-[var(--color-text-tertiary)]">{q ? `与「${query.trim()}」相关的精选技能` : '将经验、方法和知识整理成技能，相似任务直接复用。'}</p>
        </div>
        <div ref={menuRef} className="relative shrink-0">
          <button type="button" aria-expanded={menuOpen} onClick={() => setMenuOpen(value => !value)}
            className="inline-flex h-8 items-center gap-1 rounded-[var(--radius-md)] border border-[var(--color-border)] px-3 text-[13px] text-[var(--color-text-primary)] hover:bg-[var(--color-surface-hover)]">
            自定义技能<ChevronDown size={14} aria-hidden="true" />
          </button>
          {menuOpen ? (
            <div className="absolute right-0 top-9 z-[var(--z-dropdown)] w-[200px] rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface-container-lowest)] p-1 shadow-[var(--shadow-dropdown)]">
              <button type="button" onClick={() => { setMenuOpen(false); fileRef.current?.click() }} className="flex w-full items-center gap-2 rounded-[var(--radius-sm)] px-2.5 py-2 text-left text-[13px] hover:bg-[var(--color-surface-hover)]"><Upload size={14} aria-hidden="true" />上传 SKILL.md</button>
              <button type="button" onClick={() => { setMenuOpen(false); seedStarComposer('帮我把下面的工作方法整理成一个可复用的技能（SKILL.md，含 name / description 头和分步流程），保存到 ~/.claude/skills/<技能名>/SKILL.md：\n') }} className="flex w-full items-center gap-2 rounded-[var(--radius-sm)] px-2.5 py-2 text-left text-[13px] hover:bg-[var(--color-surface-hover)]"><MessageSquarePlus size={14} aria-hidden="true" />用对话创建技能</button>
            </div>
          ) : null}
          <input ref={fileRef} type="file" accept=".md,text/markdown" className="hidden" onChange={event => { const file = event.target.files?.[0]; if (file) void upload(file); event.target.value = '' }} />
        </div>
      </div>
      {!q ? <PillTabs items={SKILL_CATEGORIES} value={category} onChange={value => { setCategory(value); setExpanded(false) }} size="sm" /> : null}
      <div className="mt-3 grid grid-cols-[repeat(auto-fill,minmax(min(100%,300px),1fr))] gap-3">
        {shown.map(skill => {
          const added = installedMap.get(skill.id)
          return (
            <div key={skill.id} role="button" tabIndex={0} onClick={() => open(skill)} onKeyDown={event => { if (event.key === 'Enter') open(skill) }}
              className="flex cursor-pointer flex-col gap-2 rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-surface-container-lowest)] p-4 transition-colors hover:border-[var(--color-border-strong)]">
              <div className="flex items-center gap-3">
                <SkillIcon category={skill.category} />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[14px] font-medium text-[var(--color-text-primary)]">{skill.name}</div>
                  <div className="text-[12px] text-[var(--color-text-tertiary)]">来自 {skill.credit ?? brand.name}</div>
                </div>
                {added ? (
                  <span className="inline-flex h-7 items-center gap-1 rounded-[var(--radius-md)] bg-[var(--color-surface-container)] px-2.5 text-[12px] text-[var(--color-text-secondary)]"><Check size={12} aria-hidden="true" />已添加</span>
                ) : (
                  <button type="button" disabled={busy === skill.id} onClick={event => { event.stopPropagation(); void install(skill) }}
                    className="inline-flex h-7 items-center gap-1 rounded-[var(--radius-md)] border border-[var(--color-border)] px-2.5 text-[12px] text-[var(--color-text-primary)] hover:bg-[var(--color-surface-container)] disabled:opacity-60">
                    <Plus size={12} aria-hidden="true" />添加
                  </button>
                )}
              </div>
              <div className="line-clamp-2 text-[12px] leading-5 text-[var(--color-text-secondary)]">{skill.desc}</div>
            </div>
          )
        })}
      </div>
      {!q && skills.length > COLLAPSED_COUNT ? (
        <button type="button" onClick={() => setExpanded(value => !value)} className="mt-3 text-[12px] text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]">
          {expanded ? '收起' : `查看全部 ${skills.length} 个`}
        </button>
      ) : null}

      <Modal open={Boolean(detail)} onClose={() => setDetail(null)} width={760} title={detail?.skill?.name ?? detail?.installed?.name ?? ''}
        footer={detail ? (
          <div className="flex w-full items-center gap-2">
            {detail.installed ? (
              <>
                <button type="button" disabled={busy === detail.installed.id} onClick={() => void toggle(detail.installed!.id)} className="h-8 rounded-[var(--radius-md)] border border-[var(--color-border)] px-3 text-[13px] hover:bg-[var(--color-surface-hover)]">{detail.installed.disabled ? '启用' : '禁用'}</button>
                <button type="button" disabled={busy === detail.installed.id} onClick={() => void remove(detail.installed!.id)} className="h-8 rounded-[var(--radius-md)] border border-[var(--color-border)] px-3 text-[13px] text-[var(--color-error)] hover:bg-[var(--color-surface-hover)]">卸载</button>
              </>
            ) : null}
            <span className="flex-1" />
            {detail.installed && !detail.installed.disabled ? (
              <button type="button" onClick={() => { runSkill(detail.skill?.name ?? detail.installed!.name, detail.installed!.id); setDetail(null) }} className="inline-flex h-8 items-center gap-1.5 rounded-[var(--radius-md)] bg-[var(--color-btn-primary-bg)] px-3 text-[13px] font-medium text-[var(--color-btn-primary-fg)]"><Play size={13} aria-hidden="true" />运行技能</button>
            ) : detail.skill && !detail.installed ? (
              <button type="button" disabled={busy === detail.skill.id} onClick={() => void install(detail.skill!).then(() => setDetail(null))} className="inline-flex h-8 items-center gap-1.5 rounded-[var(--radius-md)] bg-[var(--color-btn-primary-bg)] px-3 text-[13px] font-medium text-[var(--color-btn-primary-fg)]"><Plus size={13} aria-hidden="true" />安装技能</button>
            ) : null}
          </div>
        ) : null}>
        {detail ? (
          <div className="space-y-3">
            <div className="flex items-center gap-3">
              <SkillIcon category={detail.skill?.category ?? 'featured'} size={44} />
              <div className="text-[12px] text-[var(--color-text-tertiary)]">by {detail.skill?.credit ?? brand.name}{detail.installed ? ` · /${detail.installed.id}` : ''}</div>
            </div>
            <div className="rounded-[var(--radius-md)] bg-[var(--color-surface-container)] px-3 py-2.5 text-[13px] leading-6 text-[var(--color-text-secondary)]">{detail.skill?.desc ?? detail.installed?.description}</div>
            {detail.skill ? (
              <div className="max-h-[46vh] overflow-y-auto rounded-[var(--radius-md)] border border-[var(--color-border)] px-4 py-3">
                <MarkdownRenderer content={marketSkillMarkdown(detail.skill, brand.name).replace(/^---[\s\S]*?---\n/, '')} variant="document" />
              </div>
            ) : null}
          </div>
        ) : null}
      </Modal>
    </section>
  )
}
