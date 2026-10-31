import { isStarPageHidden, type StarPageId } from '../../../components/star/starPages'
import type { MarketSkill } from './skillCatalog'

/** How a market entry is used: STAR built-in, a desktop connector, a market skill, a page, or not yet available. */
export type PluginAction =
  | { type: 'star'; prompt: string }
  | { type: 'connector'; id: string }
  | { type: 'skill'; id: string }
  | { type: 'page'; page: StarPageId }
  | { type: 'settings'; tab: 'computerUse' | 'mcp' | 'adapters' }
  | { type: 'soon' }

export type PluginCategoryId = 'recommend' | 'featured' | 'finance' | 'office' | 'creative' | '3d' | 'dev' | 'research' | 'legal'

/** `{brand}` in a `desc` or a 'star' prompt is the console's product name, filled in where it is shown or sent. */
export type MarketPlugin = {
  key: string
  name: string
  desc: string
  categories: PluginCategoryId[]
  icon: string
  action: PluginAction
  member?: boolean
}

export const PLUGIN_CATEGORIES: { id: PluginCategoryId | 'all'; label: string }[] = [
  { id: 'all', label: '全部' },
  { id: 'recommend', label: '推荐' },
  { id: 'featured', label: '精选' },
  { id: 'finance', label: '金融' },
  { id: 'office', label: '效率与办公' },
  { id: 'creative', label: '创意与设计' },
  { id: '3d', label: '3D' },
  { id: 'dev', label: '开发与工程' },
  { id: 'research', label: '学习与研究' },
  { id: 'legal', label: '法律' },
]

const p = (key: string, name: string, desc: string, categories: PluginCategoryId[], icon: string, action: PluginAction, member?: boolean): MarketPlugin =>
  ({ key, name, desc, categories, icon, action, ...(member ? { member } : {}) })
const soon: PluginAction = { type: 'soon' }

/** Every catalog entry, before those leading to a hidden page are left out. */
const ALL_PLUGINS: MarketPlugin[] = [
  p('pdf', 'PDF', '识别、总结、翻译与转换 PDF，扫描件也能读。', ['recommend', 'office'], 'file-text', { type: 'star', prompt: '/star-pdf 分析我上传的 PDF，提炼要点并整理成摘要' }),
  p('excel', 'Excel', '读写表格、清洗数据、透视统计并生成图表。', ['recommend', 'office'], 'sheet', { type: 'star', prompt: '分析这份 Excel：清洗数据、统计关键指标并生成带图表的报告' }),
  p('word', 'Word', '起草、改写并导出排版规范的 Word 文档。', ['recommend', 'office'], 'file-type', { type: 'star', prompt: '根据我的材料写一份结构完整的报告，导出为 Word' }),
  p('3d-editor', '3D Editor', '生成可交互的 3D 网页、模型与打印文件。', ['recommend', '3d'], 'box', { type: 'page', page: '3d' }),
  p('mobile-app', '移动端应用开发', '从需求到可运行的移动端应用原型。', ['recommend', 'dev'], 'smartphone', { type: 'skill', id: 'mobile-app-dev' }),
  p('website-publish', '网站发布', '把生成的网页一键部署成可分享的链接。', ['recommend', 'dev'], 'globe', { type: 'connector', id: 'render' }),
  p('image-gen', '图像生成', '文生图、图生图、多图融合，结果直接回到对话。', ['recommend', 'creative'], 'image', { type: 'star', prompt: '用 {brand} 绘图生成一张科技感产品主视觉海报，16:9' }),
  p('video-gen', '视频生成', '文生视频、图生视频、首尾帧与视频参考。', ['creative'], 'clapperboard', { type: 'star', prompt: '用 {brand} 生成一段 5 秒的产品展示视频：镜头缓慢环绕，干净的棚拍背景' }),
  p('academic-db', '学术数据库', '检索论文与引用，生成带出处的文献综述。', ['recommend', 'research'], 'graduation-cap', { type: 'star', prompt: '/star-paper-search 检索该方向近两年的代表性论文，并写一份文献综述' }),
  p('web-search', '联网搜索', '实时检索网页并给出带来源的答案。', ['recommend', 'research'], 'search', { type: 'star', prompt: '/star-web-search 调研这个问题的最新进展，给出带来源的结论' }),
  p('ifind', '同花顺 iFinD 金融数据库', '行情、财务与宏观数据接口。', ['recommend', 'finance'], 'line-chart', soon, true),
  p('qcc', '企查查', '企业工商、股东、风险与关联关系查询。', ['recommend', 'finance', 'legal'], 'connector:qcc', { type: 'connector', id: 'qcc' }),
  p('computer-use', '电脑操控', '让 {brand} 操作你的电脑：打开应用、点击、输入。', ['featured'], 'mouse-pointer', { type: 'settings', tab: 'computerUse' }),
  p('figma', 'Figma', '读取设计稿、组件与样式，按设计还原代码。', ['featured', 'creative'], 'connector:figma', { type: 'connector', id: 'figma' }),
  p('notion', 'Notion', '读写 Notion 页面与数据库。', ['featured', 'office'], 'connector:notion', { type: 'connector', id: 'notion' }),
  p('github', 'GitHub', '仓库、Issue 与 PR 的查询和管理。', ['featured', 'dev'], 'connector:github', { type: 'connector', id: 'github' }),
  p('feishu', '飞书', '连接飞书账号，读写云文档、多维表格与日程。', ['featured', 'office'], 'connector:feishu', { type: 'connector', id: 'feishu' }),
  p('wecom', '企业微信', '企业微信 CLI 工具，覆盖消息、邮件、文档。', ['office'], 'connector:wecom', { type: 'connector', id: 'wecom' }),
  p('dingtalk', '钉钉', '钉钉协作工作流：消息、文档、日历。', ['office'], 'connector:dingtalk', { type: 'connector', id: 'dingtalk' }),
  p('tencent-docs', '腾讯文档', '连接腾讯文档，管理文档与表格。', ['office'], 'connector:tencent-docs', { type: 'connector', id: 'tencent-docs' }),
  p('obsidian', 'Obsidian', '读写本地 Obsidian 笔记库。', ['office'], 'connector:obsidian', { type: 'connector', id: 'obsidian' }),
  p('gmail', 'Gmail', '收发与整理邮件。', ['featured', 'office'], 'mail', soon),
  p('outlook', 'Outlook', '邮件与日历。', ['office'], 'mail', soon),
  p('google-drive', 'Google Drive', '检索与读取云盘文件。', ['office'], 'hard-drive', soon),
  p('wps', 'WPS 云文档', '读写 WPS 云文档。', ['office'], 'file-text', soon),
  p('fin-toolbox', '机构金融百宝箱', '估值、可比公司、财务建模常用工具合集。', ['finance'], 'briefcase', { type: 'skill', id: 'fin-toolbox' }),
  p('fin-analysis', '金融投资分析', '公司与行业的投资分析框架。', ['finance'], 'trending-up', { type: 'skill', id: 'stock-research-report' }),
  p('corp-accounting', '企业财务会计', '记账、报表编制与会计处理问答。', ['finance'], 'calculator', { type: 'skill', id: 'corp-accounting' }),
  p('ib-pe', '投资银行私募股权', '交易结构、尽调清单与投资备忘录。', ['finance'], 'landmark', { type: 'skill', id: 'ib-pe' }),
  p('fin-charts', '金融动态图表', '把行情与财务数据做成动态图表。', ['finance'], 'bar-chart', { type: 'skill', id: 'chart-generator' }),
  p('datayes', '通联数据', '金融数据接口。', ['finance'], 'connector:datayes', { type: 'connector', id: 'datayes' }),
  p('wind', '万得金融数据服务', '专业金融终端数据。', ['finance'], 'line-chart', soon, true),
  p('xinhua-finance', '新华财经资讯', '财经新闻与资讯。', ['finance'], 'newspaper', soon, true),
  p('canva', 'Canva 可画', '在 Canva 中创建、分层编辑与导出设计。', ['creative'], 'connector:canva', { type: 'connector', id: 'canva' }),
  p('inspiration', '灵感池', '浏览社区作品与提示词，一键做同款。', ['creative'], 'sparkles', { type: 'page', page: 'inspiration' }),
  p('canvas', '画板', 'AI 设计画板：海报、套图、长图与 PPT。', ['creative'], 'palette', { type: 'page', page: 'design' }),
  p('live-report', '灵动报告', '把材料排成可交互的网页报告。', ['creative'], 'layout', { type: 'skill', id: 'magazine-report' }),
  p('blender', 'Blender', '用脚本建模、渲染与导出。', ['3d'], 'box', soon),
  p('tripo', 'Tripo 3D 生成', '文字或图片生成 3D 模型。', ['3d'], 'box', soon),
  p('autocad', 'Autodesk AutoCAD', 'CAD 图纸自动化。', ['3d'], 'ruler', soon),
  p('cloudflare', 'Cloudflare', '部署、DNS 与 Workers。', ['dev'], 'connector:cloudflare', { type: 'connector', id: 'cloudflare' }),
  p('supabase', 'Supabase', '数据库、认证与存储。', ['dev'], 'connector:supabase', { type: 'connector', id: 'supabase' }),
  p('neon', 'Neon', 'Serverless Postgres。', ['dev'], 'connector:neon', { type: 'connector', id: 'neon' }),
  p('context7', 'Context7', '最新的库文档，写代码不再查旧版 API。', ['dev'], 'connector:context7', { type: 'connector', id: 'context7' }),
  p('postman', 'Postman', 'API 集合与测试。', ['dev'], 'connector:postman', { type: 'connector', id: 'postman' }),
  p('sentry', 'Sentry', '错误监控与排查。', ['dev'], 'connector:sentry', { type: 'connector', id: 'sentry' }),
  p('code-review', '代码审查报告', '审查代码改动，输出问题分级与修改建议。', ['dev'], 'code', { type: 'skill', id: 'code-review-report' }),
  p('miniprogram', '小程序开发', '微信、抖音、支付宝小程序开发。', ['dev'], 'smartphone', { type: 'skill', id: 'miniprogram-dev' }),
  p('prototype', '快速产品原型开发', '把想法快速做成可点击的产品原型。', ['dev', 'creative'], 'layout', { type: 'skill', id: 'rapid-prototype' }),
  p('arch-diagram', '可交互架构图', '生成可交互的系统架构图。', ['dev'], 'network', { type: 'skill', id: 'code-architecture-diagram' }),
  p('latex', 'LaTeX', '论文排版、公式与参考文献。', ['research'], 'sigma', { type: 'skill', id: 'latex-writer' }),
  p('research-data', '科研数据助手', '科研数据清洗、统计与作图。', ['research'], 'flask', { type: 'skill', id: 'research-data' }),
  p('pubmed', 'PubMed & PMC', '生物医学文献检索。', ['research'], 'book', soon),
  p('legal-assistant', '法律助手', '法律问题梳理与法条检索思路。', ['legal'], 'scale', { type: 'skill', id: 'legal-assistant' }),
  p('contract-review', '合同审查', '逐条审查合同风险并给出修改建议。', ['legal'], 'file-check', { type: 'skill', id: 'contract-review' }),
  p('pkulaw', '北大法宝', '法律法规与案例数据库。', ['legal'], 'connector:pkulaw', { type: 'connector', id: 'pkulaw' }),
  p('board', '进度管理工作台', '任务看板：待办、进行中、已完成。', ['office'], 'kanban', { type: 'page', page: 'board' }),
]

/** The catalog as shown: an entry that opens a hidden page (3D Make, PPT) is left out. */
export const MARKET_PLUGINS: MarketPlugin[] = ALL_PLUGINS.filter(plugin => plugin.action.type !== 'page' || !isStarPageHidden(plugin.action.page))

const k = (id: string, name: string, desc: string, steps: string[], output: string, category: MarketSkill['category']): MarketSkill => ({ id, name, desc, steps, output, category })

/** Skills behind plugin entries that are not in the 精选技能 lists. */
export const PLUGIN_SKILLS: MarketSkill[] = [
  k('mobile-app-dev', '移动端应用开发', '从需求到可运行的移动端应用原型（React Native / Flutter / H5）。', ['确认平台与核心页面', '搭建工程与导航', '实现核心页面并给出运行方式'], '可运行的工程 + 说明。', 'engineering'),
  k('fin-toolbox', '机构金融百宝箱', '估值、可比公司分析、财务建模等机构常用工具合集。', ['确认分析目标', '选择工具（可比公司、DCF、敏感性分析）', '输出表格与结论'], '分析表格与结论。', 'finance'),
  k('corp-accounting', '企业财务会计', '记账、报表编制与会计处理问答，遵循企业会计准则。', ['理解业务事项', '给出会计分录与依据', '编制或检查报表'], '分录与报表说明。', 'finance'),
  k('ib-pe', '投资银行私募股权', '交易结构设计、尽调清单与投资备忘录撰写。', ['了解交易背景', '梳理尽调清单', '起草投资备忘录'], '尽调清单 + 投资备忘录。', 'finance'),
  k('code-review-report', '代码审查报告', '审查代码改动，按严重程度分级列出问题、风险与修改建议。', ['读取 diff 与相关代码', '检查正确性、安全、性能与可维护性', '分级输出问题与建议'], '审查报告。', 'engineering'),
  k('miniprogram-dev', '小程序开发', '微信、抖音、支付宝小程序的页面、组件与接口开发。', ['确认平台与功能', '搭建目录与页面', '实现并说明预览方式'], '小程序工程。', 'engineering'),
  k('rapid-prototype', '快速产品原型开发', '把产品想法快速做成可点击的多页 HTML 原型。', ['梳理核心流程', '设计页面与跳转', '输出可点击原型'], 'prototype/ 目录。', 'engineering'),
  k('latex-writer', 'LaTeX', '论文排版、公式、图表与参考文献管理。', ['确认模板与结构', '编写 LaTeX 源码', '说明编译方式'], '.tex 文件。', 'academic'),
  k('research-data', '科研数据助手', '科研数据清洗、统计检验与出版级作图。', ['读取数据', '清洗并统计', '用 matplotlib 出图'], '分析脚本 + 图表。', 'academic'),
  k('legal-assistant', '法律助手', '梳理法律问题、相关法条与解决路径。', ['梳理事实与诉求', '列出相关法律与要点', '给出处理路径'], '法律分析；注明不构成正式法律意见。', 'featured'),
  k('contract-review', '合同审查', '逐条审查合同风险条款并给出修改建议。', ['识别合同类型与立场', '逐条标注风险', '给出修改建议文本'], '审查意见表。', 'featured'),
]
