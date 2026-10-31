/**
 * Which form the 记忆图谱 page draws its nodes in: the ring graph, or the
 * particle nebula. A display preference only; the graph data is the same.
 */
export type MemoryForm = 'graph' | 'nebula'

export const MEMORY_FORM_STORAGE_KEY = 'cc-haha.star.memoryForm'

/** The stored form; anything missing, unknown or unreadable is the graph. */
export function readMemoryForm(): MemoryForm {
  try {
    return window.localStorage.getItem(MEMORY_FORM_STORAGE_KEY) === 'nebula' ? 'nebula' : 'graph'
  } catch {
    return 'graph'
  }
}

export function writeMemoryForm(form: MemoryForm): void {
  try {
    window.localStorage.setItem(MEMORY_FORM_STORAGE_KEY, form)
  } catch {
    // Storage unavailable (quota, privacy mode): the choice lasts until the page closes.
  }
}
