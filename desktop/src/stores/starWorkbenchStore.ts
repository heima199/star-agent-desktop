import { create } from 'zustand'

/**
 * STAR's local workbench: the 看板 cards and the calendar's own events. Both
 * pages edit the same cards (the calendar sets a card's due date), so they
 * share one store instead of each holding a copy that the other overwrites.
 * Everything stays on this machine, in localStorage.
 */

export type BoardColumn = 'todo' | 'doing' | 'done'

export type BoardCard = {
  id: string
  title: string
  note: string
  column: BoardColumn
  createdAt: number
  /** `YYYY-MM-DD` (all day) or `YYYY-MM-DDTHH:mm` (local time); null when unscheduled. */
  due: string | null
}

export type CalendarColor = 'blue' | 'green' | 'orange' | 'purple' | 'red' | 'gray'

export type CalendarEvent = {
  id: string
  title: string
  /** All day: `YYYY-MM-DD`; otherwise `YYYY-MM-DDTHH:mm`, local time. */
  start: string
  /** All day: the last day, inclusive; otherwise the end time. */
  end: string
  allDay: boolean
  color: CalendarColor
  location: string
  notes: string
  createdAt: number
  updatedAt: number
}

/** The board's key predates this store; its shape only gained `due`. */
export const BOARD_STORAGE_KEY = 'star.board.v1'
export const CALENDAR_STORAGE_KEY = 'star.calendar.v1'

const COLORS: readonly CalendarColor[] = ['blue', 'green', 'orange', 'purple', 'red', 'gray']
const DATE_RE = /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2})?$/

const text = (value: unknown, max: number) => (typeof value === 'string' ? value.slice(0, max) : '')
const stamp = (value: unknown, fallback: number) => (typeof value === 'number' && Number.isFinite(value) ? value : fallback)

/** Stored data is only as good as the last build that wrote it: tidy it on the way in. */
export function normalizeCard(raw: unknown): BoardCard | null {
  if (!raw || typeof raw !== 'object') return null
  const card = raw as Record<string, unknown>
  if (typeof card.id !== 'string' || !card.id) return null
  return {
    id: card.id,
    title: text(card.title, 200) || '未命名任务',
    note: text(card.note, 4000),
    column: card.column === 'doing' || card.column === 'done' ? card.column : 'todo',
    createdAt: stamp(card.createdAt, Date.now()),
    due: typeof card.due === 'string' && DATE_RE.test(card.due) ? card.due : null,
  }
}

export function normalizeEvent(raw: unknown): CalendarEvent | null {
  if (!raw || typeof raw !== 'object') return null
  const event = raw as Record<string, unknown>
  if (typeof event.id !== 'string' || !event.id) return null
  const start = typeof event.start === 'string' && DATE_RE.test(event.start) ? event.start : ''
  if (!start) return null
  const allDay = event.allDay === true
  const end = typeof event.end === 'string' && DATE_RE.test(event.end) && event.end >= start ? event.end : start
  const createdAt = stamp(event.createdAt, Date.now())
  return {
    id: event.id,
    title: text(event.title, 200) || '（无标题）',
    start: allDay ? start.slice(0, 10) : start.length === 10 ? `${start}T09:00` : start,
    end: allDay ? end.slice(0, 10) : end.length === 10 ? `${end}T10:00` : end,
    allDay,
    color: COLORS.includes(event.color as CalendarColor) ? (event.color as CalendarColor) : 'blue',
    location: text(event.location, 200),
    notes: text(event.notes, 4000),
    createdAt,
    updatedAt: stamp(event.updatedAt, createdAt),
  }
}

function readList<T>(key: string, normalize: (raw: unknown) => T | null): T[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(key) ?? '[]') as unknown
    return Array.isArray(parsed) ? parsed.map(normalize).filter((item): item is T => item !== null) : []
  } catch {
    return []
  }
}

function writeList(key: string, list: unknown[]) {
  try {
    localStorage.setItem(key, JSON.stringify(list))
  } catch {
    // Storage full or unavailable: the change still holds for this visit.
  }
}

export function newWorkbenchId(prefix: string): string {
  return `${prefix}${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`
}

type StarWorkbenchState = {
  cards: BoardCard[]
  events: CalendarEvent[]
  setCards: (update: (cards: BoardCard[]) => BoardCard[]) => void
  /** Adds the card, or replaces the one with its id. */
  saveCard: (card: BoardCard) => void
  removeCard: (id: string) => void
  saveEvent: (event: CalendarEvent) => void
  removeEvent: (id: string) => void
  /** Reads both lists from storage again. */
  reload: () => void
}

const upsert = <T extends { id: string }>(list: T[], item: T): T[] =>
  list.some(entry => entry.id === item.id) ? list.map(entry => (entry.id === item.id ? item : entry)) : [...list, item]

export const useStarWorkbenchStore = create<StarWorkbenchState>((set, get) => {
  const putCards = (cards: BoardCard[]) => {
    set({ cards })
    writeList(BOARD_STORAGE_KEY, cards)
  }
  const putEvents = (events: CalendarEvent[]) => {
    set({ events })
    writeList(CALENDAR_STORAGE_KEY, events)
  }
  return {
    cards: readList(BOARD_STORAGE_KEY, normalizeCard),
    events: readList(CALENDAR_STORAGE_KEY, normalizeEvent),
    setCards: update => putCards(update(get().cards)),
    saveCard: card => putCards(upsert(get().cards, card)),
    removeCard: id => putCards(get().cards.filter(card => card.id !== id)),
    saveEvent: event => putEvents(upsert(get().events, event)),
    removeEvent: id => putEvents(get().events.filter(event => event.id !== id)),
    reload: () => set({
      cards: readList(BOARD_STORAGE_KEY, normalizeCard),
      events: readList(CALENDAR_STORAGE_KEY, normalizeEvent),
    }),
  }
})
