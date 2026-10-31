import { create } from 'zustand'
import type { StarCreateMode, StarCreateParams } from '../lib/starCreateRequest'

/** Slot of the new-session composer; a live session's composer uses its session id. */
export const STAR_CREATE_DRAFT_SLOT = 'draft'

export type StarCreateArmed = { mode: StarCreateMode; params: StarCreateParams }

type StarCreateState = {
  slots: Record<string, StarCreateArmed | undefined>
  arm: (slot: string, mode: StarCreateMode, params?: StarCreateParams) => void
  update: (slot: string, params: StarCreateParams) => void
  disarm: (slot: string) => void
  /** The draft became a session: its armed mode follows it. */
  move: (from: string, to: string) => void
}

/**
 * The creation mode armed in each composer. It stays armed after a send, like
 * a mode rather than a one-shot switch, so a series of images is one chip and
 * several prompts; the chip's ✕ turns it off.
 */
export const useStarCreateStore = create<StarCreateState>((set, get) => ({
  slots: {},
  arm: (slot, mode, params) => {
    const previous = get().slots[slot]
    // Switching between modes of the same family keeps the picked model and sizes.
    const keep = previous && sameFamily(previous.mode, mode) ? previous.params : {}
    set({ slots: { ...get().slots, [slot]: { mode, params: { ...keep, ...params } } } })
  },
  update: (slot, params) => {
    const current = get().slots[slot]
    if (!current) return
    set({ slots: { ...get().slots, [slot]: { ...current, params: { ...current.params, ...params } } } })
  },
  disarm: (slot) => {
    if (!get().slots[slot]) return
    const next = { ...get().slots }
    delete next[slot]
    set({ slots: next })
  },
  move: (from, to) => {
    const armed = get().slots[from]
    if (!armed || from === to) return
    const next = { ...get().slots, [to]: armed }
    delete next[from]
    set({ slots: next })
  },
}))

function family(mode: StarCreateMode): string {
  if (mode === 'vision') return 'vision'
  return mode.endsWith('image') ? 'image' : 'video'
}

function sameFamily(a: StarCreateMode, b: StarCreateMode): boolean {
  return family(a) === family(b)
}
