import { formatStarBrand } from '../../../lib/starBrand'
import { getStarBrandName } from '../../../stores/starBrandStore'
import { SKILLS_A } from './skillCatalogA'
import { SKILLS_B } from './skillCatalogB'

/**
 * STAR 精选技能: written for STAR, organised like Kimi's featured skills.
 * `credit` names the public author whose skill inspired ours; the text is ours.
 * Installing writes SKILL.md into the user's skills folder (see starSkillsApi).
 */
export type MarketSkill = {
  id: string
  name: string
  category: SkillCategoryId
  desc: string
  steps: string[]
  output: string
  credit?: string
}

export type SkillCategoryId = 'featured' | 'office' | 'finance' | 'content' | 'academic' | 'marketing' | 'engineering'

export const SKILL_CATEGORIES: { id: SkillCategoryId; label: string }[] = [
  { id: 'featured', label: '精选技能' },
  { id: 'office', label: '办公效率' },
  { id: 'finance', label: '商业金融' },
  { id: 'content', label: '内容创作' },
  { id: 'academic', label: '学术研究' },
  { id: 'marketing', label: '营销增长' },
  { id: 'engineering', label: '工程研发' },
]

export const MARKET_SKILLS: MarketSkill[] = [...SKILLS_A, ...SKILLS_B]

/** SKILL.md of a skill; `{brand}` in a step becomes the console's product name (default: the current one). */
export function marketSkillMarkdown(skill: MarketSkill, brand: string = getStarBrandName()): string {
  const lines = [
    '---',
    `name: ${skill.id}`,
    `description: ${skill.name}：${skill.desc.replace(/\n/g, ' ')}`,
    '---',
    '',
    `# ${skill.name}`,
    '',
    skill.desc,
    '',
    '## 何时使用',
    `用户的需求与「${skill.name}」相关时使用本技能；用户点名该技能时直接使用。`,
    '',
    '## 工作流程',
    ...skill.steps.map((step, index) => `${index + 1}. ${formatStarBrand(step, brand)}`),
    '',
    '## 输出',
    skill.output,
    '',
    '## 原则',
    '- 信息不足时，先列出需要用户补充的关键信息（最多 5 项），再继续。',
    '- 数据、引用和结论注明来源与假设，不编造数据；无法联网核实时明确说明。',
    '- 生成文件时保存到当前工作目录，并在回复末尾列出文件路径。',
    '',
  ]
  return lines.join('\n')
}
