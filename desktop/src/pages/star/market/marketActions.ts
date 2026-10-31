import { starApi, starErrorText } from '../../../api/star'
import { seedStarComposer } from '../../../components/star/starComposerSeed'
import { openStarPage } from '../../../components/star/starPages'
import { formatStarBrand } from '../../../lib/starBrand'
import { getStarBrandName } from '../../../stores/starBrandStore'
import { MARKET_TAB_ID, SETTINGS_TAB_ID, useTabStore } from '../../../stores/tabStore'
import { useUIStore } from '../../../stores/uiStore'
import { MARKET_SKILLS, marketSkillMarkdown, type MarketSkill } from './skillCatalog'
import { PLUGIN_SKILLS, type PluginAction } from './pluginCatalog'

export const ALL_MARKET_SKILLS: MarketSkill[] = [...MARKET_SKILLS, ...PLUGIN_SKILLS.filter(skill => !MARKET_SKILLS.some(item => item.id === skill.id))]

export function findMarketSkill(id: string): MarketSkill | undefined {
  return ALL_MARKET_SKILLS.find(skill => skill.id === id)
}

export function toast(type: 'success' | 'error' | 'info', message: string): void {
  useUIStore.getState().addToast({ type, message })
}

export async function installMarketSkill(skill: MarketSkill): Promise<boolean> {
  try {
    await starApi.installSkill(skill.id, marketSkillMarkdown(skill))
    toast('success', `已添加技能「${skill.name}」，新对话中可直接使用`)
    return true
  } catch (error) {
    toast('error', starErrorText(error))
    return false
  }
}

/** Starts a new chat that uses an installed skill. */
export function runSkill(name: string, id: string): void {
  seedStarComposer(`/${id} `)
  toast('info', `已在新对话中填入「${name}」，补充需求后发送`)
}

export function openConnector(id: string): void {
  useUIStore.getState().setPendingMarketTarget({ section: 'plugins', connectorId: id })
  useTabStore.getState().openTab(MARKET_TAB_ID, '插件', 'market')
}

export function openSettings(tab: 'computerUse' | 'mcp' | 'adapters' | 'skills' | 'plugins'): void {
  useUIStore.getState().setPendingSettingsTab(tab)
  useTabStore.getState().openTab(SETTINGS_TAB_ID, '设置', 'settings')
}

export async function runPluginAction(action: PluginAction, name: string): Promise<boolean | void> {
  switch (action.type) {
    case 'star':
      seedStarComposer(formatStarBrand(action.prompt, getStarBrandName()))
      return
    case 'connector':
      openConnector(action.id)
      return
    case 'page':
      openStarPage(action.page)
      return
    case 'settings':
      openSettings(action.tab)
      return
    case 'skill': {
      const skill = findMarketSkill(action.id)
      if (skill) return installMarketSkill(skill)
      return
    }
    case 'soon':
      toast('info', `「${name}」即将上线`)
      return
  }
}
