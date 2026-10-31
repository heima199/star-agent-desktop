import { create } from 'zustand'
import { checkStarUpdate, type StarUpdateCheck } from '../lib/starUpdate'

/**
 * The latest answer to "is there a newer STAR release?", shared by the
 * automatic check (UpdateChecker), the About page and the dot on the settings
 * entry. In memory only: every start asks the STAR console again.
 */
type StarUpdateState = {
  latest: StarUpdateCheck | null
  /** Asks the STAR console (no sign-in needed) and keeps the answer; rejects when it cannot answer. */
  refresh: () => Promise<StarUpdateCheck>
}

export const useStarUpdateStore = create<StarUpdateState>(set => ({
  latest: null,
  refresh: async () => {
    const result = await checkStarUpdate()
    set({ latest: result })
    return result
  },
}))
