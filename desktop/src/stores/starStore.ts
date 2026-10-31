import { create } from 'zustand'
import { MARKET_TAB_ID, useTabStore } from './tabStore'
import {
  starApi,
  starErrorText,
  type StarCatalog,
  type StarCheckRun,
  type StarDesktopConfig,
  type StarMediaTask,
  type StarQuota,
  type StarStatus,
} from '../api/star'
import { setStarServiceAddressSource } from '../lib/starServiceAddress'
import { getStarBrandName, useStarBrandStore } from './starBrandStore'

/** Mode of the STAR shell (Work / Code / Design): the sidebar nav and the home page. */
export type StarMode = 'work' | 'code' | 'design'

const MODE_STORAGE_KEY = 'cc-haha.star.mode'
const MASCOT_STORAGE_KEY = 'cc-haha.star.composerMascot'

/**
 * The composer mascot is off unless the user turned it on (设置 › 外观 ›
 * 输入框角色). It used to be on by default; a stored '1' or '0' keeps meaning
 * what the user chose, and no stored value now means hidden.
 */
function readMascotEnabled(): boolean {
  try {
    return window.localStorage.getItem(MASCOT_STORAGE_KEY) === '1'
  } catch {
    return false
  }
}

const REPLY_TIPS_STORAGE_KEY = 'cc-haha.star.replyTips'

/** Tips while STAR replies are on unless the user turned them off. */
function readReplyTipsEnabled(): boolean {
  try {
    return window.localStorage.getItem(REPLY_TIPS_STORAGE_KEY) !== '0'
  } catch {
    return true
  }
}

function readMode(): StarMode {
  try {
    const value = window.localStorage.getItem(MODE_STORAGE_KEY)
    // The retired Chat mode (and anything unknown) lands on Work.
    return value === 'code' || value === 'design' ? value : 'work'
  } catch {
    return 'work'
  }
}

type StarState = {
  status: StarStatus | null
  quota: StarQuota | null
  catalog: StarCatalog | null
  tasks: StarMediaTask[]
  runningTasks: number
  check: StarCheckRun | null
  /** Operator config from the STAR console (关于 / support / legal / 推荐). */
  desktopConfig: StarDesktopConfig | null
  loadDesktopConfig: (force?: boolean) => Promise<StarDesktopConfig | null>
  mode: StarMode
  /** The animated character on the composer's top-right corner. */
  mascotEnabled: boolean
  setMascotEnabled: (enabled: boolean) => void
  /** Usage tips under the status line while a reply runs. */
  replyTipsEnabled: boolean
  setReplyTipsEnabled: (enabled: boolean) => void
  loginOpen: boolean
  upgradeOpen: false | 'plan' | 'credits'
  feedbackOpen: boolean
  statusError: string | null
  /** The extensions page should open on its STAR section (consumed once). */
  pendingStarSection: boolean
  refreshStatus: () => Promise<StarStatus | null>
  refreshQuota: () => Promise<void>
  loadCatalog: (force?: boolean) => Promise<void>
  refreshTasks: () => Promise<void>
  upsertTask: (task: StarMediaTask) => void
  removeTask: (id: string) => void
  setCheck: (run: StarCheckRun | null) => void
  setMode: (mode: StarMode) => void
  openLogin: () => void
  closeLogin: () => void
  /** The first known status of this launch already decided whether the sign-in opens by itself. */
  startupLoginHandled: boolean
  /** Opens the sign-in once per launch when the first known status is signed out (useStarSync). */
  promptStartupLogin: (status: StarStatus | null) => void
  openUpgrade: (kind: 'plan' | 'credits') => void
  closeUpgrade: () => void
  openFeedback: () => void
  closeFeedback: () => void
  openStarPlugins: () => void
  consumeStarSection: () => boolean
  signedIn: (status: StarStatus) => void
  logout: () => Promise<void>
}

export const useStarStore = create<StarState>((set, get) => ({
  status: null,
  quota: null,
  catalog: null,
  tasks: [],
  runningTasks: 0,
  check: null,
  desktopConfig: null,
  loadDesktopConfig: async (force = false) => {
    if (get().desktopConfig && !force) return get().desktopConfig
    try {
      const desktopConfig = await starApi.desktopConfig(force)
      set({ desktopConfig })
      return desktopConfig
    } catch {
      return get().desktopConfig
    }
  },
  mode: readMode(),
  mascotEnabled: readMascotEnabled(),
  setMascotEnabled: (enabled) => {
    try {
      window.localStorage.setItem(MASCOT_STORAGE_KEY, enabled ? '1' : '0')
    } catch {
      // Private storage unavailable: the choice lasts for this window only.
    }
    set({ mascotEnabled: enabled })
  },
  replyTipsEnabled: readReplyTipsEnabled(),
  setReplyTipsEnabled: (enabled) => {
    try {
      window.localStorage.setItem(REPLY_TIPS_STORAGE_KEY, enabled ? '1' : '0')
    } catch {
      // Private storage unavailable: the choice lasts for this window only.
    }
    set({ replyTipsEnabled: enabled })
  },
  loginOpen: false,
  upgradeOpen: false,
  feedbackOpen: false,
  statusError: null,
  pendingStarSection: false,

  refreshStatus: async () => {
    try {
      const status = await starApi.status()
      set({ status, statusError: null })
      return status
    } catch (error) {
      set({ statusError: starErrorText(error) })
      return null
    }
  },

  refreshQuota: async () => {
    if (!get().status?.signedIn) {
      set({ quota: null })
      return
    }
    try {
      set({ quota: await starApi.quota() })
    } catch (error) {
      // A rejected token means the session expired on the service side.
      if ((error as { status?: number })?.status === 401) void get().refreshStatus()
    }
  },

  loadCatalog: async (force = false) => {
    try {
      const { catalog } = force ? await starApi.refreshCatalog() : await starApi.catalog()
      if (catalog) set({ catalog })
    } catch {
      // Keep the previous catalog; the picker falls back to slot models.
    }
  },

  refreshTasks: async () => {
    try {
      const { tasks, running } = await starApi.tasks(200)
      set({ tasks, runningTasks: running })
    } catch {
      // The task center shows the last known list.
    }
  },

  upsertTask: (task) => {
    const tasks = get().tasks.filter(item => item.id !== task.id)
    set({ tasks: [task, ...tasks].sort((a, b) => b.createdAt - a.createdAt) })
  },

  removeTask: (id) => set({ tasks: get().tasks.filter(item => item.id !== id) }),

  setCheck: (check) => set({ check }),

  setMode: (mode) => {
    try {
      window.localStorage.setItem(MODE_STORAGE_KEY, mode)
    } catch {
      // Private storage unavailable: the choice lasts for this window only.
    }
    set({ mode })
  },

  openLogin: () => set({ loginOpen: true }),
  closeLogin: () => set({ loginOpen: false }),
  startupLoginHandled: false,
  promptStartupLogin: (status) => {
    // Still loading, or the status could not be read: a later answer decides.
    if (!status || get().startupLoginHandled) return
    // 「暂不登录」 or Esc only closes it: nothing opens it by itself again until the next launch.
    set(status.configured && !status.signedIn ? { startupLoginHandled: true, loginOpen: true } : { startupLoginHandled: true })
  },
  openUpgrade: (kind) => set({ upgradeOpen: kind }),
  closeUpgrade: () => set({ upgradeOpen: false }),
  openFeedback: () => set({ feedbackOpen: true }),
  closeFeedback: () => set({ feedbackOpen: false }),
  openStarPlugins: () => {
    set({ pendingStarSection: true })
    useTabStore.getState().openTab(MARKET_TAB_ID, '插件', 'market')
  },
  consumeStarSection: () => {
    const pending = get().pendingStarSection
    if (pending) set({ pendingStarSection: false })
    return pending
  },

  signedIn: (status) => {
    set({ status, loginOpen: false })
    void get().refreshQuota()
    void get().loadCatalog()
  },

  logout: async () => {
    const status = await starApi.logout()
    set({ status, quota: null })
  },
}))

// Errors shown in STAR's UI leave the service's own address out.
setStarServiceAddressSource(() => useStarStore.getState().status?.baseUrl)

// Every status answer carries the console's product name (STAR from an older server).
useStarStore.subscribe((state, previous) => {
  if (state.status && state.status !== previous.status) useStarBrandStore.getState().setName(state.status.brandName)
})

/** Credits display: `--` while unknown. */
export function formatStarCredits(value: number | null | undefined): string {
  if (value === null || value === undefined) return '--'
  const rounded = Math.round(value * 100) / 100
  return rounded.toLocaleString('en-US', { maximumFractionDigits: 2 })
}

export function starUserName(status: StarStatus | null): string {
  const user = status?.user
  return user?.nickname || user?.phone || user?.email || `${getStarBrandName()} 用户`
}

export function isStarTaskActive(task: StarMediaTask): boolean {
  return task.status !== 'succeeded' && task.status !== 'failed'
}
