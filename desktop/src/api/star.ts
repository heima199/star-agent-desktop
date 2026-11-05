import { api, apiGetBlob, getAuthToken, getBaseUrl, ApiError } from './client'
import { hideStarServiceAddress as hideServiceAddress } from '../lib/starServiceAddress'

export type StarUser = {
  id: string
  email: string | null
  phone: string | null
  nickname: string | null
  avatar: string | null
  inviteCode: string | null
}

export type StarStatus = {
  configured: boolean
  baseUrl: string
  signedIn: boolean
  user: StarUser | null
  provider: { id: string | null; active: boolean; relayReady: boolean; mainModel: string | null }
  catalog: { fetchedAt: number | null; chatModels: number; imageModels: number; videoModels: number }
  starWorkSignInAvailable: boolean
  /** The product name set in the STAR console (normalized, STAR by default); absent from an older server. */
  brandName?: string
}

export type StarUsage = { quota: number; used: number; period?: string; resetAt?: string }

export type StarQuota = {
  planName: string
  planTier: 'free' | 'paid'
  credits: number | null
  expiresAt: number | null
  normal?: StarUsage
  premium?: StarUsage
  checkin?: { checked: boolean; times: number; credits: number }
}

export type StarChatModel = {
  id: string
  name: string
  brandId: string
  brandName: string
  tier?: string
  credits?: number
  contextWindow?: number
  health?: string
  /** e.g. `chat,vision`; absent for plain chat models. */
  capability?: string
}

export type StarImageModel = {
  id: string
  label: string
  badge?: string
  sizes?: string[]
  supportsEdit?: boolean
  pricePerImage?: number
}

export type StarVideoModel = {
  id: string
  label: string
  modes?: string[]
  resolutions?: string[]
  durations?: number[]
  ratios?: string[]
  pricePerSecond?: number
  pricePerGeneration?: number
}

export type StarCatalog = {
  fetchedAt: number
  brands: { id: string; name: string; logo?: string; color?: string }[]
  chat: StarChatModel[]
  image: StarImageModel[]
  video: StarVideoModel[]
  videoLimits: { maxReferenceImages: number; maxReferenceVideos: number; mediaTypes: string[] }
}

export type StarCreditEstimateRequest =
  | { kind: 'image'; model?: string; ratio?: string; resolution?: string; count?: number; edit?: boolean }
  | { kind: 'video'; model?: string; mode?: string; duration?: number; resolution?: string }
export type StarCreditEstimate = {
  credits?: number
  /** True when the console priced it; false for its rule with default settings. */
  exact: boolean
  model?: string
  size?: string
  /** The tier an image is charged at (lower than asked when the model draws no larger). */
  tier?: '1k' | '2k' | '4k'
  duration?: number
  resolution?: string
}
export type StarMediaStatus = 'queued' | 'uploading' | 'submitting' | 'running' | 'downloading' | 'succeeded' | 'failed'

export type StarMediaTask = {
  id: string
  kind: 'image' | 'video'
  mode: string
  model: string
  prompt: string
  params: Record<string, string | number>
  references: { images: string[]; videos: string[] }
  status: StarMediaStatus
  progress: number
  message: string
  outputs: { kind: 'image' | 'video'; url: string; file?: string; name: string }[]
  error?: string
  source: 'desktop' | 'agent'
  sessionId?: string
  saveDir?: string
  estimatedCredits?: number
  createdAt: number
  updatedAt: number
  finishedAt?: number
}

export type StarCheckItem = {
  id: string
  label: string
  status: 'pending' | 'running' | 'pass' | 'warn' | 'fail' | 'skip'
  detail: string
  latencyMs?: number
}

export type StarCheckRun = {
  runId: string
  startedAt: number
  finishedAt?: number
  includeGeneration: boolean
  items: StarCheckItem[]
}

export type StarPlan = Record<string, unknown> & { id?: string; name?: string }

export type StarImageRequest = {
  prompt: string
  model?: string
  references?: string[]
  ratio?: string
  resolution?: string
  count?: number
}

export type StarVideoRequest = {
  prompt: string
  model?: string
  firstFrame?: string
  lastFrame?: string
  references?: string[]
  videos?: string[]
  duration?: number
  ratio?: string
  resolution?: string
}

export type StarPromptGroup = 'image' | 'video' | 'motion' | 'design' | 'frontend'

/** One 站点提示词 card (public STAR prompt catalog). Carries no source fields. */
export type StarPromptCard = {
  id: string
  title: string
  summary: string
  coverUrl: string
  group: StarPromptGroup | ''
  subcategory: string
  tags: string[]
  promptChars: number
  excerpt: string
  invokePath: '/chat' | '/image' | '/video'
}

export type StarPromptDetail = StarPromptCard & { prompt: string; promptTruncated: boolean; meta: Record<string, string> }

export type StarPromptFacets = {
  total: number
  groups: { id: StarPromptGroup; name: string; count: number; subs: { id: string; name: string; count: number }[] }[]
}

export type StarPromptPage = { items: StarPromptCard[]; total: number; page: number; pageSize: number; hasMore: boolean }

export type StarAdIcon = { name: string; url: string; icon: string; desc: string }

export type StarDesktopConfig = {
  fetchedAt: number
  siteName: string
  branding: { appName: string; logoUrl: string; primaryColor: string; tagline: string }
  about: { email: string; communityUrl: string; manualUrl: string; termsUrl: string; privacyUrl: string; copyright: string; wecomQr: string; description: string }
  support: { enabled: boolean; url: string; qrcodeUrl: string; email: string; wechatId: string; hours: string; description: string }
  feedbackEnabled: boolean
  inviteEnabled: boolean
  legal: { id: string; title: string; kind: string; url: string; content: string }[]
  ads: { icons: StarAdIcon[]; slides: { imageUrl: string; title: string; text: string; linkUrl: string }[] }
}

export type StarUpdateInfo = { version: string | null; downloadUrl: string | null; releaseNotes: string; mandatory: boolean; publishedAt: number | null }

/** A published 用户协议 / 隐私政策…: sanitized markup from the console and its plain text. */
export type StarLegalDocument = { id: string; title: string; bodyHtml: string; body: string; updatedAt: number }

export type StarPlazaItem = { id: string; category: string; subcategory: string; title: string; summary: string; coverUrl: string; prompt: string; invokePath: string }
export type StarPlazaPage = { categories: { id: string; name: string; children: { id: string; name: string }[] }[]; items: StarPlazaItem[]; total: number }

export type StarDistribution = {
  invite: Record<string, unknown> | null
  agent: Record<string, unknown> | null
  dashboard: Record<string, unknown> | null
  commissions: Record<string, unknown>[]
  invitedUsers: Record<string, unknown>[]
  withdrawals: Record<string, unknown>[]
}

export type StarApiKey = { id: string; name: string; tokenMask: string; enabled: boolean; createdAt: string; lastUsedAt: string; remark: string }

export type OpenDesignTemplate = { id: string; name: string; zhName: string; description: string; zhDescription: string; tags: string[]; mode: string; featured: number; hasExample: boolean }
export type OpenDesignSkill = { id: string; name: string; zhName: string; description: string; zhDescription: string; tags: string[]; mode: string }
export type OpenDesignSystem = { id: string; name: string; category: string; summary: string; colors: string[] }
export type OpenDesignLibrary = {
  available: boolean
  templates: OpenDesignTemplate[]
  skills: OpenDesignSkill[]
  systems: OpenDesignSystem[]
  craft: { id: string; title: string }[]
  prompts?: { image: number; video: number }
}
export type OpenDesignPrompt = { id: string; title: string; summary: string; category: string; tags: string[]; aspect: string; prompt: string; previewImageUrl: string; previewVideoUrl: string; author: string; license: string; url: string }

export type DesignBoard = {
  path: string
  name: string
  kind: 'html' | 'svg' | 'image' | 'video'
  x: number
  y: number
  width: number
  height: number
  hidden: boolean
  locked: boolean
  size: number
  updatedAt: number
  versions: number
}

export type DesignProject = {
  id: string
  dir: string
  title: string
  kind: string
  width: number
  height: number
  style: string
  templateId: string
  systemId: string
  skillId: string
  sessionId: string
  createdAt: number
  updatedAt: number
  canvas: { zoom: number; x: number; y: number } | null
  boards: DesignBoard[]
  assets: { path: string; name: string; kind: 'image' | 'video' | 'other'; size: number; updatedAt: number }[]
}

export type DesignProjectSummary = Omit<DesignProject, 'boards' | 'canvas' | 'assets'> & { boardCount: number; cover: string | null; coverKind: DesignBoard['kind'] | null }

export type KnowledgeDoc = { id: string; name: string; file: string; textFile: string; size: number; chars: number; via: string; addedAt: number; error?: string }
export type KnowledgeBase = { id: string; name: string; description: string; dir: string; createdAt: number; updatedAt: number; docs: KnowledgeDoc[] }
export type KnowledgeBaseSummary = Omit<KnowledgeBase, 'docs'> & { docCount: number; chars: number }

async function rawRequest(method: 'POST' | 'PUT', path: string, body: Blob | string, type: string, timeout = 120_000): Promise<unknown> {
  const headers: Record<string, string> = { 'Content-Type': type }
  const token = getAuthToken()
  if (token) headers.Authorization = `Bearer ${token}`
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeout)
  try {
    const response = await fetch(`${getBaseUrl()}${path}`, { method, headers, body, signal: controller.signal })
    const payload = await response.json().catch(() => ({})) as { message?: string }
    if (!response.ok) throw new ApiError(response.status, { message: payload.message || `请求失败（${response.status}）` })
    return payload
  } finally {
    clearTimeout(timer)
  }
}

const designPath = (id: string) => `/api/star/design/projects/${encodeURIComponent(id)}`
const rawFilePath = (id: string, rel: string) => `${designPath(id)}/raw/${rel.split('/').map(encodeURIComponent).join('/')}`

/** URL of one saved version of a board. */
export function designVersionUrl(id: string, board: string, version: string): string {
  const token = getAuthToken()
  const query = new URLSearchParams({ board, id: version })
  if (token) query.set('localToken', token)
  return `${getBaseUrl()}${designPath(id)}/versions/file?${query}`
}

/** URL under /api/star/design/library (template examples) that an <iframe> can load. */
export function designLibraryUrl(path: string): string {
  const token = getAuthToken()
  return `${getBaseUrl()}/api/star/design/library/${path}${token ? `?localToken=${encodeURIComponent(token)}` : ''}`
}

/** URL of a design project file that an <img>/<video>/<iframe> can load (local token in the query). */
export function designFileUrl(id: string, rel: string, version?: number): string {
  const token = getAuthToken()
  const query = new URLSearchParams()
  if (token) query.set('localToken', token)
  if (version) query.set('v', String(version))
  const suffix = query.toString()
  return `${getBaseUrl()}${rawFilePath(id, rel)}${suffix ? `?${suffix}` : ''}`
}

export const starApi = {
  status: () => api.get<StarStatus>('/api/star/status'),
  sendCode: (account: string) => api.post<{ ok: true }>('/api/star/login/code', { account }),
  login: (input: { account: string; code?: string; password?: string; inviteCode?: string; activate?: boolean }) =>
    api.post<StarStatus>('/api/star/login', input, { timeout: 60_000 }),
  loginWithStarWork: (activate: boolean) => api.post<StarStatus>('/api/star/login/starwork', { activate }, { timeout: 60_000 }),
  logout: () => api.post<StarStatus>('/api/star/logout'),
  quota: () => api.get<StarQuota>('/api/star/quota'),
  catalog: () => api.get<{ catalog: StarCatalog | null }>('/api/star/catalog', { timeout: 30_000 }),
  refreshCatalog: () => api.post<{ catalog: StarCatalog }>('/api/star/catalog/refresh', {}, { timeout: 60_000 }),
  activate: () => api.post<StarStatus>('/api/star/activate', {}, { timeout: 60_000 }),
  plans: () => api.get<{ plans: StarPlan[]; creditPacks: StarPlan[]; paymentMethods: Record<string, unknown> }>('/api/star/plans', { timeout: 30_000 }),
  order: (input: { kind: 'plan' | 'credits'; id: string; billingCycle?: string; payType?: 'alipay' | 'wxpay'; quantity?: number }) =>
    api.post<{ payUrl: string | null; raw: unknown }>('/api/star/order', input, { timeout: 30_000 }),
  checkin: () => api.post<Record<string, unknown>>('/api/star/checkin'),
  redeem: (code: string) => api.post<Record<string, unknown>>('/api/star/redeem', { code }),
  feedback: (input: { category: 'bug' | 'feature' | 'other'; message: string; contact?: string }) =>
    api.post<Record<string, unknown>>('/api/star/feedback', input),
  tasks: (limit = 100) => api.get<{ tasks: StarMediaTask[]; running: number }>(`/api/star/media/tasks?limit=${limit}`),
  task: (id: string) => api.get<{ task: StarMediaTask }>(`/api/star/media/tasks/${encodeURIComponent(id)}`),
  deleteTask: (id: string, files: boolean) => api.delete<{ ok: true }>(`/api/star/media/tasks/${encodeURIComponent(id)}${files ? '?files=1' : ''}`),
  generateImage: (input: StarImageRequest) => api.post<{ task: StarMediaTask }>('/api/star/media/image', input, { timeout: 120_000 }),
  generateVideo: (input: StarVideoRequest) => api.post<{ task: StarMediaTask }>('/api/star/media/video', input, { timeout: 120_000 }),
  /** What a job would cost: the console's own price for these values (exact), or its rule offline. */
  estimateCredits: (input: StarCreditEstimateRequest) => api.post<{ estimate: StarCreditEstimate }>('/api/star/media/estimate', input, { timeout: 20_000 }),
  outputBlob: (taskId: string, index: number) => apiGetBlob(`/api/star/media/tasks/${encodeURIComponent(taskId)}/file/${index}`, { timeout: 120_000 }),
  check: () => api.get<{ run: StarCheckRun | null }>('/api/star/check'),
  startCheck: (includeGeneration: boolean) => api.post<{ run: StarCheckRun | null }>('/api/star/check', { includeGeneration }),
  search: (query: string, maxResults = 8) => api.post<{ query: string; results: { title: string; url: string; snippet: string }[]; latencyMs: number }>('/api/star/tools/search', { query, maxResults }, { timeout: 90_000 }),
  academic: (query: string, count = 8) => api.post<{ query: string; total: number; papers: { title: string; url: string; summary: string; source: string; year: string }[]; latencyMs: number }>('/api/star/tools/academic', { query, count }, { timeout: 90_000 }),
  promptStrip: (mode: 'code' | 'design' | 'all') => api.get<{ items: StarPromptCard[] }>(`/api/star/prompts/strip?mode=${mode}`, { timeout: 30_000 }),
  promptFacets: () => api.get<StarPromptFacets>('/api/star/prompts/facets', { timeout: 30_000 }),
  promptList: (query: { group?: string; sub?: string; q?: string; page?: number; pageSize?: number }) => {
    const params = new URLSearchParams()
    if (query.group) params.set('group', query.group)
    if (query.sub) params.set('sub', query.sub)
    if (query.q?.trim()) params.set('q', query.q.trim().slice(0, 60))
    params.set('page', String(query.page ?? 1))
    params.set('pageSize', String(query.pageSize ?? 24))
    return api.get<StarPromptPage>(`/api/star/prompts/list?${params}`, { timeout: 30_000 })
  },
  promptDetail: (id: string) => api.get<StarPromptDetail>(`/api/star/prompts/item/${encodeURIComponent(id)}`, { timeout: 45_000 }),
  markPromptUsed: (id: string) => api.post<{ ok: true }>(`/api/star/prompts/item/${encodeURIComponent(id)}/use`, {}).catch(() => undefined),

  desktopConfig: (force = false) => api.get<StarDesktopConfig>(`/api/star/desktop-config${force ? '?force=1' : ''}`, { timeout: 30_000 }),
  updateInfo: (platform: string) => api.get<StarUpdateInfo>(`/api/star/update?platform=${encodeURIComponent(platform)}`, { timeout: 30_000 }),
  /** 用户协议 / 隐私政策 published in the STAR console; public, read before sign-in. */
  legalDocs: () => api.get<{ docs: StarLegalDocument[] }>('/api/star/legal', { timeout: 20_000 }),
  plaza: (query: { category?: string; subcategory?: string; page?: number; pageSize?: number }) => {
    const params = new URLSearchParams()
    if (query.category) params.set('category', query.category)
    if (query.subcategory) params.set('subcategory', query.subcategory)
    params.set('page', String(query.page ?? 1))
    params.set('pageSize', String(query.pageSize ?? 24))
    // The first download of a list can take the STAR service up to a minute;
    // the local server keeps it after that, so only a first visit waits this long.
    return api.get<StarPlazaPage>(`/api/star/plaza?${params}`, { timeout: 95_000 })
  },
  distribution: () => api.get<StarDistribution>('/api/star/distribution', { timeout: 30_000 }),
  applyAgent: () => api.post<Record<string, unknown>>('/api/star/distribution/apply', {}),
  withdraw: (input: { amount: number; accountType: string; accountInfo: string }) => api.post<Record<string, unknown>>('/api/star/distribution/withdraw', input),
  apiKeys: () => api.get<{ keys: StarApiKey[]; baseUrl: string }>('/api/star/api-keys', { timeout: 30_000 }),
  createApiKey: (name: string) => api.post<{ key: StarApiKey; secret: string }>('/api/star/api-keys', { name }, { timeout: 30_000 }),
  deleteApiKey: (id: string) => api.delete<{ ok: true }>(`/api/star/api-keys/${encodeURIComponent(id)}`),
  toggleApiKey: (id: string) => api.post<{ ok: true }>(`/api/star/api-keys/${encodeURIComponent(id)}/toggle`, {}),

  designLibrary: () => api.get<OpenDesignLibrary>('/api/star/design/library', { timeout: 30_000 }),
  designLibraryText: (kind: 'template' | 'system' | 'skill' | 'craft', id: string) =>
    api.get<{ kind: string; id: string; text: string }>(`/api/star/design/library/${kind}/${encodeURIComponent(id)}`, { timeout: 30_000 }),
  designPrompts: (surface: 'image' | 'video') => api.get<{ items: OpenDesignPrompt[] }>(`/api/star/design/library/prompts/${surface}`, { timeout: 30_000 }),
  async designTemplateExample(id: string): Promise<string> {
    const blob = await apiGetBlob(`/api/star/design/library/template/${encodeURIComponent(id)}/example`, { timeout: 30_000 })
    return blob.text()
  },
  designProjects: () => api.get<{ root: string; projects: DesignProjectSummary[] }>('/api/star/design/projects', { timeout: 30_000 }),
  createDesignProject: (input: { title: string; kind: string; width: number; height: number; style?: string; templateId?: string; systemId?: string; skillId?: string }) =>
    api.post<{ project: DesignProject }>('/api/star/design/projects', input, { timeout: 30_000 }),
  designProject: (id: string) => api.get<{ project: DesignProject }>(designPath(id), { timeout: 30_000 }),
  patchDesignProject: (id: string, patch: Record<string, unknown>) => api.patch<{ project: DesignProject }>(designPath(id), patch),
  async designFileText(id: string, rel: string): Promise<string> {
    const blob = await apiGetBlob(rawFilePath(id, rel), { timeout: 30_000 })
    return blob.text()
  },
  async writeDesignFile(id: string, rel: string, content: string | Blob, type = 'text/html; charset=utf-8'): Promise<DesignProject> {
    const payload = await rawRequest('PUT', rawFilePath(id, rel), content, type) as { project: DesignProject }
    return payload.project
  },
  deleteDesignFile: (id: string, rel: string) => api.delete<{ project: DesignProject }>(rawFilePath(id, rel)),
  async uploadDesignAsset(id: string, file: Blob, name: string): Promise<{ path: string; file: string }> {
    return await rawRequest('POST', `${designPath(id)}/assets?name=${encodeURIComponent(name)}`, file, file.type || 'application/octet-stream') as { path: string; file: string }
  },
  addDesignMediaBoard: (id: string, input: { url?: string; file?: string; source?: string; name?: string; x?: number; y?: number }) =>
    api.post<{ project: DesignProject }>(`${designPath(id)}/boards`, input, { timeout: 180_000 }),
  designVersions: (id: string, board: string) => api.get<{ versions: { id: string; at: number; size: number }[] }>(`${designPath(id)}/versions?board=${encodeURIComponent(board)}`),
  restoreDesignVersion: (id: string, board: string, version: string) => api.post<{ project: DesignProject }>(`${designPath(id)}/versions/restore`, { board, id: version }),
  async designVersionText(id: string, board: string, version: string): Promise<string> {
    const blob = await apiGetBlob(`${designPath(id)}/versions/file?board=${encodeURIComponent(board)}&id=${encodeURIComponent(version)}`, { timeout: 30_000 })
    return blob.text()
  },

  createLocalProject: (name: string) => api.post<{ name: string; path: string }>('/api/star/projects', { name }),
  templates3d: (type?: string) => api.get<{ items: { id: string; type: string; category: string; title: string; summary: string; coverUrl: string; modelUrl: string; prompt: string }[]; source: 'star' | 'none' }>(`/api/star/3d${type ? `?type=${type}` : ''}`, { timeout: 30_000 }),
  /** Counts a 做同款 on a console template; best effort. */
  use3dTemplate: (id: string) => { void api.post<{ ok: true }>(`/api/star/3d/${encodeURIComponent(id)}/use`, {}).catch(() => undefined) },
  async proxiedImage(url: string): Promise<Blob> {
    return apiGetBlob(`/api/star/design/fetch?url=${encodeURIComponent(url)}`, { timeout: 90_000 })
  },
  installedSkills: () => api.get<{ root: string; skills: { id: string; name: string; description: string; disabled: boolean; updatedAt: number }[] }>('/api/star/skills'),
  installSkill: (id: string, content: string) => api.post<{ ok: true; id: string; path: string }>('/api/star/skills/install', { id, content }),
  toggleSkill: (id: string) => api.post<{ ok: true; disabled: boolean }>(`/api/star/skills/${encodeURIComponent(id)}/toggle`, {}),
  removeSkill: (id: string) => api.delete<{ ok: true }>(`/api/star/skills/${encodeURIComponent(id)}`),

  knowledgeBases: () => api.get<{ root: string; bases: KnowledgeBaseSummary[] }>('/api/star/kb', { timeout: 30_000 }),
  createKnowledgeBase: (input: { name: string; description?: string }) => api.post<{ base: KnowledgeBase }>('/api/star/kb', input),
  knowledgeBase: (id: string) => api.get<{ base: KnowledgeBase }>(`/api/star/kb/${encodeURIComponent(id)}`),
  updateKnowledgeBase: (id: string, patch: { name?: string; description?: string }) => api.patch<{ base: KnowledgeBase }>(`/api/star/kb/${encodeURIComponent(id)}`, patch),
  deleteKnowledgeBase: (id: string) => api.delete<{ ok: true }>(`/api/star/kb/${encodeURIComponent(id)}`),
  async addKnowledgeDoc(id: string, file: File): Promise<KnowledgeBase> {
    const payload = await rawRequest('POST', `/api/star/kb/${encodeURIComponent(id)}/docs?name=${encodeURIComponent(file.name)}`, file, file.type || 'application/octet-stream', 300_000) as { base: KnowledgeBase }
    return payload.base
  },
  deleteKnowledgeDoc: (id: string, docId: string) => api.delete<{ base: KnowledgeBase }>(`/api/star/kb/${encodeURIComponent(id)}/docs/${encodeURIComponent(docId)}`),
  searchKnowledge: (id: string, q: string) => api.get<{ hits: { docId: string; name: string; snippet: string; score: number }[] }>(`/api/star/kb/${encodeURIComponent(id)}/search?q=${encodeURIComponent(q)}`),

  /** 运行时 page: process tree, live chats, plugin endpoints and generation tasks. */
  runtime: (refreshPlugins = false) => api.get<StarRuntimeSnapshot>(`/api/star/runtime${refreshPlugins ? '?plugins=refresh' : ''}`, { timeout: 30_000 }),

  /** Upload a reference file (raw bytes) and get the public URL the media models read. */
  async uploadReference(file: File | Blob, kind: 'image' | 'video', name?: string): Promise<string> {
    const headers: Record<string, string> = { 'Content-Type': file.type || (kind === 'video' ? 'video/mp4' : 'image/png') }
    const token = getAuthToken()
    if (token) headers.Authorization = `Bearer ${token}`
    const fileName = name ?? (file instanceof File ? file.name : `reference.${kind === 'video' ? 'mp4' : 'png'}`)
    const response = await fetch(`${getBaseUrl()}/api/star/upload?kind=${kind}&name=${encodeURIComponent(fileName)}`, {
      method: 'POST',
      headers,
      body: file,
    })
    const payload = await response.json().catch(() => ({})) as { url?: string; message?: string }
    if (!response.ok || !payload.url) {
      throw new ApiError(response.status, { message: payload.message || `上传失败（${response.status}）` })
    }
    return payload.url
  },
}

export type StarRuntimeRole = 'launcher' | 'main' | 'renderer' | 'gpu' | 'network' | 'utility' | 'server' | 'adapter' | 'session' | 'tool' | 'other'

export type StarRuntimeProcess = {
  pid: number
  ppid: number
  depth: number
  name: string
  role: StarRuntimeRole
  label: string
  detail?: string
  memoryBytes: number
  privateBytes: number | null
  cpuPercent: number | null
  startedAt: number | null
  sessionId?: string
  minor?: boolean
}

export type StarRuntimeSession = {
  sessionId: string
  pid: number
  workDir: string
  permissionMode: string
  providerId: string | null
  modelId: string | null
  effortLevel: string | null
  /** running | waiting | idle | starting | exited (and other chat states). */
  state: string
  isTeamWorker: boolean
  startupPending: boolean
  pendingPermissions: number
  memoryBytes: number | null
  cpuPercent: number | null
  startedAt: number | null
  childCount: number
}

export type StarRuntimePlugin = {
  group: string
  name: string
  description: string
  enabled: boolean | null
  ok: boolean
  status: number | null
  tools: number
  latencyMs: number | null
  error?: string
}

export type StarRuntimeTask = {
  id: string
  kind: string
  mode: string
  model: string
  status: string
  progress: number
  message: string
  source: string
  sessionId?: string
  createdAt: number
  updatedAt: number
  finishedAt?: number
}

export type StarRuntimeSnapshot = {
  at: number
  platform: string
  cpuCount: number
  totalMemoryBytes: number
  freeMemoryBytes: number
  server: { pid: number; port: number | null; startedAt: number; uptimeSec: number; bunVersion: string | null; rssBytes: number; heapUsedBytes: number }
  processes: StarRuntimeProcess[]
  processError: string | null
  totals: { count: number; memoryBytes: number; cpuPercent: number | null }
  sessions: StarRuntimeSession[]
  plugins: { signedIn: boolean; checkedAt: number | null; items: StarRuntimePlugin[] }
  tasks: { running: number; recent: StarRuntimeTask[] }
}

function rawErrorText(error: unknown): string {
  if (error instanceof ApiError) {
    const body = error.body as { message?: unknown } | undefined
    if (body && typeof body === 'object' && typeof body.message === 'string' && body.message) return body.message
    return error.message
  }
  return error instanceof Error ? error.message : String(error)
}

/** English answers of the local server that reach the user, in the interface's language. */
const SERVER_MESSAGES: Record<string, string> = {
  'File too large': '文件太大，超出了可保存的大小上限',
}

/** User-facing text of an API failure; the STAR service's own address is left out of it. */
export function starErrorText(error: unknown): string {
  const text = rawErrorText(error)
  return SERVER_MESSAGES[text] ?? hideServiceAddress(text)
}

/** Whether a request failed because the file was over the server's size limit. */
export function isFileTooLargeError(error: unknown): boolean {
  return rawErrorText(error) === 'File too large'
}
