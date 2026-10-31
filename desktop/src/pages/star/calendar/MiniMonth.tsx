import { useEffect, useState } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { cx } from '@/lib/cx'
import { addDays, dateKey, isSameDay, isSameMonth, monthDay, startOfWeek } from './calendarModel'

const WEEKDAYS = ['一', '二', '三', '四', '五', '六', '日']

/** The rail's small month: a day jumps the calendar there; days with plans carry a dot. */
export function MiniMonth({ selected, marked, now, onSelect }: {
  selected: Date
  /** `YYYY-MM-DD` of the days with an event or a due date. */
  marked: ReadonlySet<string>
  now: Date
  onSelect: (day: Date) => void
}) {
  const [month, setMonth] = useState(() => new Date(selected.getFullYear(), selected.getMonth(), 1))
  // Follows the calendar when it moves to another month, not on every day picked.
  useEffect(() => {
    setMonth(current => (isSameMonth(current, selected) ? current : new Date(selected.getFullYear(), selected.getMonth(), 1)))
  }, [selected])

  const first = startOfWeek(month)
  const days = Array.from({ length: 42 }, (_, index) => addDays(first, index))
  const step = (delta: number) => setMonth(current => new Date(current.getFullYear(), current.getMonth() + delta, 1))
  const arrow = 'inline-flex h-7 w-7 items-center justify-center rounded-[var(--radius-md)] text-[var(--color-text-tertiary)] transition-colors hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-text-primary)]'

  return (
    <div data-testid="mini-month" className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <span className="text-[13px] font-medium text-[var(--color-text-primary)]">{month.getFullYear()}年{month.getMonth() + 1}月</span>
        <div className="flex items-center">
          <button type="button" aria-label="上个月" onClick={() => step(-1)} className={arrow}><ChevronLeft size={15} strokeWidth={1.75} aria-hidden="true" /></button>
          <button type="button" aria-label="下个月" onClick={() => step(1)} className={arrow}><ChevronRight size={15} strokeWidth={1.75} aria-hidden="true" /></button>
        </div>
      </div>
      <div className="grid grid-cols-7 gap-y-0.5 text-center text-[11px]">
        {WEEKDAYS.map(day => <span key={day} className="py-1 text-[var(--color-text-tertiary)]">{day}</span>)}
        {days.map(day => {
          const isSelected = isSameDay(day, selected)
          const isToday = isSameDay(day, now)
          return (
            <button
              key={dateKey(day)}
              type="button"
              aria-label={monthDay(day)}
              aria-pressed={isSelected}
              onClick={() => onSelect(day)}
              className={cx(
                'relative mx-auto inline-flex h-7 w-7 items-center justify-center rounded-full text-[12px] tabular-nums transition-colors',
                isSelected
                  ? 'bg-[var(--color-btn-primary-bg)] font-medium text-[var(--color-btn-primary-fg)]'
                  : cx(
                    'hover:bg-[var(--color-surface-hover)]',
                    isToday ? 'font-semibold text-[var(--color-info)]' : isSameMonth(day, month) ? 'text-[var(--color-text-primary)]' : 'text-[var(--color-text-tertiary)]',
                  ),
              )}
            >
              {day.getDate()}
              {marked.has(dateKey(day)) && !isSelected ? (
                <span aria-hidden="true" className="absolute bottom-0.5 left-1/2 h-1 w-1 -translate-x-1/2 rounded-full bg-[var(--color-info)]" />
              ) : null}
            </button>
          )
        })}
      </div>
    </div>
  )
}
