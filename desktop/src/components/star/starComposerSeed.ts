import { create } from 'zustand'
import { useSessionStore } from '../../stores/sessionStore'
import { useTabStore } from '../../stores/tabStore'
import { useUIStore } from '../../stores/uiStore'

/** A local file handed to the composer, inserted as a file pill. */
export type StarComposerSeedFile = { path: string; name: string }

type Seed = { text: string; files?: StarComposerSeedFile[]; revision: number }

type SeedState = {
  seed: Seed | null
  take: () => Seed | null
}

let revision = 0

/** A prompt handed to the new-session composer by a STAR page (PPT, 3D, 灵感社区, 知识库…). */
export const useStarComposerSeed = create<SeedState>((set, get) => ({
  seed: null,
  take: () => {
    const seed = get().seed
    if (seed) set({ seed: null })
    return seed
  },
}))

/**
 * Opens the new-session page (for `workDir` when given) with `text` in the
 * composer. The user reviews and sends it; nothing runs on its own.
 *
 * `files` (我的文件 → 添加到对话) join the draft as file pills, sent as
 * `@"path"`. With no `text` they are added to what the draft already holds.
 */
export function seedStarComposer(text: string, options: { workDir?: string; files?: StarComposerSeedFile[] } = {}): void {
  useUIStore.getState().startNewSessionDraft(options.workDir)
  useSessionStore.getState().setActiveSession(null)
  useTabStore.getState().setActiveTab(null)
  useStarComposerSeed.setState({ seed: { text, ...(options.files?.length ? { files: options.files } : {}), revision: ++revision } })
}
