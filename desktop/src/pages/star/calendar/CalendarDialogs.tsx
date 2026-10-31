import { useEffect, useRef, useState } from 'react'
import { MessageSquare, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { Modal } from '@/components/ui/Modal'
import { SegmentedControl } from '@/components/ui/SegmentedControl'
import { Switch } from '@/components/ui/Switch'
import { TextArea } from '@/components/ui/TextArea'
import { cx } from '@/lib/cx'
import { useStarBrand } from '@/stores/starBrandStore'
import type { BoardCard, BoardColumn, CalendarColor, CalendarEvent } from '@/stores/starWorkbenchStore'
import { CALENDAR_COLORS, addMinutes, clock, dateTimeKey, monthDay, parseLocal, type Footprint } from './calendarModel'

/**
 * The Modal focuses its close button first; typing starts in the form's first
 * field instead. A frame later, so it lands after the Modal's own focus.
 */
function useFocusFirstField() {
  const ref = useRef<HTMLFormElement>(null)
  useEffect(() => {
    const frame = requestAnimationFrame(() => ref.current?.querySelector<HTMLInputElement>('input')?.focus())
    return () => cancelAnimationFrame(frame)
  }, [])
  return ref
}

function FieldLabel({ children }: { children: string }) {
  return <span className="text-[12px] text-[var(--color-text-tertiary)]">{children}</span>
}

function DialogFooter({ onDelete, onCancel, saveDisabled, formId }: { onDelete?: () => void; onCancel: () => void; saveDisabled: boolean; formId: string }) {
  return (
    <>
      {onDelete ? (
        <Button variant="danger-ghost" size="base" className="mr-auto" icon={<Trash2 size={14} strokeWidth={1.75} aria-hidden="true" />} onClick={onDelete}>删除</Button>
      ) : null}
      <Button variant="secondary" size="base" onClick={onCancel}>取消</Button>
      <Button variant="primary" size="base" type="submit" form={formId} disabled={saveDisabled}>保存</Button>
    </>
  )
}

export type EventDraft = Pick<CalendarEvent, 'title' | 'start' | 'end' | 'allDay' | 'color' | 'location' | 'notes'>

/** 新建 / 编辑日程. Mounted per open, so its fields start from `event` or `defaults`. */
export function EventDialog({ event, defaults, onClose, onSave, onDelete }: {
  event: CalendarEvent | null
  defaults?: Partial<EventDraft>
  onClose: () => void
  onSave: (draft: EventDraft) => void
  onDelete?: () => void
}) {
  const source = event ?? defaults ?? {}
  const initialStart = source.start ?? dateTimeKey(new Date())
  const initialEnd = source.end ?? dateTimeKey(addMinutes(parseLocal(initialStart), 60))
  const [title, setTitle] = useState(source.title ?? '')
  const [allDay, setAllDay] = useState(source.allDay ?? false)
  const [startDate, setStartDate] = useState(initialStart.slice(0, 10))
  const [startTime, setStartTime] = useState(initialStart.length > 10 ? initialStart.slice(11, 16) : '09:00')
  const [endDate, setEndDate] = useState(initialEnd.slice(0, 10))
  const [endTime, setEndTime] = useState(initialEnd.length > 10 ? initialEnd.slice(11, 16) : '10:00')
  const [color, setColor] = useState<CalendarColor>(source.color ?? 'blue')
  const [location, setLocation] = useState(source.location ?? '')
  const [notes, setNotes] = useState(source.notes ?? '')
  const [error, setError] = useState('')
  const formRef = useFocusFirstField()

  const save = () => {
    const trimmed = title.trim()
    if (!trimmed || !startDate) return
    const lastDate = endDate || startDate
    const start = allDay ? startDate : `${startDate}T${startTime || '09:00'}`
    const end = allDay ? lastDate : `${lastDate}T${endTime || startTime || '10:00'}`
    if (end < start) {
      setError('结束时间不能早于开始时间')
      return
    }
    onSave({
      title: trimmed.slice(0, 200),
      start,
      // A timed event needs some length to be drawn; zero minutes becomes half an hour.
      end: !allDay && end === start ? dateTimeKey(addMinutes(parseLocal(start), 30)) : end,
      allDay,
      color,
      location: location.trim().slice(0, 200),
      notes: notes.trim().slice(0, 4000),
    })
    onClose()
  }

  return (
    <Modal open onClose={onClose} title={event ? '编辑日程' : '新建日程'} width={500} typography="interface"
      footer={<DialogFooter formId="calendar-event-form" onDelete={onDelete} onCancel={onClose} saveDisabled={!title.trim() || !startDate} />}>
      <form ref={formRef} id="calendar-event-form" data-testid="event-dialog" className="flex flex-col gap-3" onSubmit={formEvent => { formEvent.preventDefault(); save() }}>
        <Input size="md" aria-label="日程标题" placeholder="添加标题" value={title} onChange={formEvent => setTitle(formEvent.target.value)} />
        {/* Content-wide, so the switch sits by its label rather than across the dialog. */}
        <div className="self-start">
          <Switch label="全天" checked={allDay} onChange={setAllDay} size="sm" />
        </div>
        <div className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-x-2 gap-y-2">
          <FieldLabel>开始</FieldLabel>
          <Input size="md" type="date" aria-label="开始日期" value={startDate} onChange={formEvent => {
            const next = formEvent.target.value
            setStartDate(next)
            if (!endDate || endDate < next) setEndDate(next)
          }} />
          {allDay ? <span /> : <Input size="md" type="time" aria-label="开始时间" containerClassName="w-28" value={startTime} onChange={formEvent => setStartTime(formEvent.target.value)} />}
          <FieldLabel>结束</FieldLabel>
          <Input size="md" type="date" aria-label="结束日期" min={startDate} value={endDate} onChange={formEvent => setEndDate(formEvent.target.value)} />
          {allDay ? <span /> : <Input size="md" type="time" aria-label="结束时间" containerClassName="w-28" value={endTime} onChange={formEvent => setEndTime(formEvent.target.value)} />}
        </div>
        <div role="radiogroup" aria-label="分类" className="flex flex-wrap gap-1.5">
          {CALENDAR_COLORS.map(item => (
            <button
              key={item.id}
              type="button"
              role="radio"
              aria-checked={color === item.id}
              onClick={() => setColor(item.id)}
              className={cx(
                'inline-flex h-7 items-center gap-1.5 rounded-full border px-2.5 text-[12px] transition-colors',
                color === item.id
                  ? 'border-[var(--color-border-strong)] bg-[var(--color-surface-container-high)] font-medium text-[var(--color-text-primary)]'
                  : 'border-[var(--color-border)] text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-hover)]',
              )}
            >
              <span aria-hidden="true" className={cx('h-2 w-2 rounded-full', item.tone.dot)} />
              {item.label}
            </button>
          ))}
        </div>
        <Input size="md" aria-label="地点" placeholder="地点（可选）" value={location} onChange={formEvent => setLocation(formEvent.target.value)} />
        <TextArea aria-label="备注" placeholder="备注（可选）" rows={3} value={notes} onChange={formEvent => setNotes(formEvent.target.value)} />
        {error ? <p role="alert" className="text-[12px] text-[var(--color-error)]">{error}</p> : null}
      </form>
    </Modal>
  )
}

export type CardDraft = Pick<BoardCard, 'title' | 'note' | 'column' | 'due'>

const COLUMN_ITEMS: { value: BoardColumn; label: string }[] = [
  { value: 'todo', label: '待办' },
  { value: 'doing', label: '进行中' },
  { value: 'done', label: '已完成' },
]

/** A 看板 card seen from the calendar: its title, due date, column and note. */
export function CardDialog({ card, defaults, onClose, onSave, onDelete }: {
  card: BoardCard | null
  defaults?: Partial<CardDraft>
  onClose: () => void
  onSave: (draft: CardDraft) => void
  onDelete?: () => void
}) {
  const source = card ?? defaults ?? {}
  const [title, setTitle] = useState(source.title ?? '')
  const [dueDate, setDueDate] = useState(source.due ? source.due.slice(0, 10) : '')
  const [dueTime, setDueTime] = useState(source.due && source.due.length > 10 ? source.due.slice(11, 16) : '')
  const [column, setColumn] = useState<BoardColumn>(source.column ?? 'todo')
  const [note, setNote] = useState(source.note ?? '')
  const formRef = useFocusFirstField()

  const save = () => {
    const trimmed = title.trim()
    if (!trimmed) return
    onSave({
      title: trimmed.slice(0, 200),
      note: note.trim().slice(0, 4000),
      column,
      due: dueDate ? (dueTime ? `${dueDate}T${dueTime}` : dueDate) : null,
    })
    onClose()
  }

  return (
    <Modal open onClose={onClose} title={card ? '编辑任务' : '新建任务'} width={460} typography="interface"
      footer={<DialogFooter formId="calendar-card-form" onDelete={onDelete} onCancel={onClose} saveDisabled={!title.trim()} />}>
      <form ref={formRef} id="calendar-card-form" data-testid="card-dialog" className="flex flex-col gap-3" onSubmit={formEvent => { formEvent.preventDefault(); save() }}>
        <Input size="md" aria-label="任务标题" placeholder="要做什么" value={title} onChange={formEvent => setTitle(formEvent.target.value)} />
        <div className="flex items-center gap-2">
          <FieldLabel>截止</FieldLabel>
          <Input size="md" type="date" aria-label="截止日期" containerClassName="min-w-0 flex-1" value={dueDate} onChange={formEvent => setDueDate(formEvent.target.value)} />
          <Input size="md" type="time" aria-label="截止时间" containerClassName="w-28 shrink-0" disabled={!dueDate} value={dueTime} onChange={formEvent => setDueTime(formEvent.target.value)} />
          {dueDate ? <Button variant="ghost" size="base" onClick={() => { setDueDate(''); setDueTime('') }}>不安排</Button> : null}
        </div>
        <SegmentedControl<BoardColumn> label="状态" size="sm" value={column} onChange={setColumn} items={COLUMN_ITEMS} />
        <TextArea aria-label="备注" placeholder="备注（可选）" rows={3} value={note} onChange={formEvent => setNote(formEvent.target.value)} />
      </form>
    </Modal>
  )
}

/** The conversations held on one day; a row opens the conversation. */
export function FootprintDialog({ day, footprints, onClose, onOpen }: {
  day: Date
  footprints: readonly Footprint[]
  onClose: () => void
  onOpen: (id: string) => void
}) {
  const brand = useStarBrand()
  return (
    <Modal open onClose={onClose} title={`${monthDay(day)}的学习足迹`} width={460} typography="interface">
      <div data-testid="footprint-dialog" className="flex flex-col gap-2">
        <p className="text-[13px] text-[var(--color-text-tertiary)]">这一天你和 {brand.name} 聊过的对话</p>
        <div className="flex max-h-80 flex-col gap-px overflow-y-auto">
          {footprints.map(item => (
            <button
              key={item.id}
              type="button"
              onClick={() => { onOpen(item.id); onClose() }}
              className="flex items-center gap-3 rounded-[var(--radius-md)] px-2 py-2 text-left transition-colors hover:bg-[var(--color-surface-hover)]"
            >
              <span className="w-11 shrink-0 text-[12px] tabular-nums text-[var(--color-text-tertiary)]">{clock(item.at)}</span>
              <MessageSquare size={14} strokeWidth={1.75} aria-hidden="true" className="shrink-0 text-[var(--color-text-tertiary)]" />
              <span className="min-w-0 flex-1 truncate text-[13px] text-[var(--color-text-primary)]">{item.title}</span>
            </button>
          ))}
        </div>
      </div>
    </Modal>
  )
}
