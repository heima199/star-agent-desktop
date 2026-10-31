import { useEffect, useState } from 'react'
import { CalendarDays, Info, List } from 'lucide-react'
import { useTaskStore } from '../stores/taskStore'
import { useUIStore } from '../stores/uiStore'
import { useTranslation } from '../i18n'
import { Button } from '@/components/ui/Button'
import { ErrorState } from '@/components/ui/ErrorState'
import { SegmentedControl } from '@/components/ui/SegmentedControl'
import { Spinner } from '@/components/ui/Spinner'
import { TaskCalendar } from '@/components/tasks/TaskCalendar'
import { TaskList } from '../components/tasks/TaskList'
import { TaskEmptyState } from '../components/tasks/TaskEmptyState'
import { NewTaskModal } from '../components/tasks/NewTaskModal'
import { StarTaskTemplates, type StarTaskTemplate } from '../components/star/StarTaskTemplates'

type TaskView = 'list' | 'calendar'

/** The 列表 / 日历 choice outlives the page. Anything unrecognised reads as the list. */
const TASK_VIEW_STORAGE_KEY = 'cc-haha.scheduled.view'

function readTaskView(): TaskView {
  try {
    return localStorage.getItem(TASK_VIEW_STORAGE_KEY) === 'calendar' ? 'calendar' : 'list'
  } catch {
    return 'list'
  }
}

function writeTaskView(view: TaskView) {
  try {
    localStorage.setItem(TASK_VIEW_STORAGE_KEY, view)
  } catch {
    // Storage can be unavailable in a locked-down WebView; the switch still works for this visit.
  }
}

export function ScheduledTasks() {
  const { tasks, fetchTasks, isLoading, error } = useTaskStore()
  const { activeModal, openModal, closeModal } = useUIStore()
  const t = useTranslation()
  const [initialized, setInitialized] = useState(false)
  // The template the open editor started from (none for a blank task).
  const [template, setTemplate] = useState<StarTaskTemplate | null>(null)
  const [view, setView] = useState<TaskView>(readTaskView)

  const changeView = (next: TaskView) => {
    setView(next)
    writeTaskView(next)
  }

  useEffect(() => {
    fetchTasks().then(() => setInitialized(true))
  }, [fetchTasks])

  const openBlank = () => {
    setTemplate(null)
    openModal('new-task')
  }
  const openTemplate = (picked: StarTaskTemplate) => {
    setTemplate(picked)
    openModal('new-task')
  }

  return (
    <div className="flex-1 overflow-y-auto bg-[var(--color-surface)]">
      <div className="mx-auto max-w-[960px] px-10 pb-16 pt-9">
        {/* Page head: 22 semibold title, 13 tertiary description, the one
            primary action on the right — the same head every list page uses.
            The 列表 / 日历 switch sits just before that action. */}
        <header className="flex items-end gap-4">
          <div className="min-w-0 flex-1">
            <h1 className="text-[22px] font-semibold leading-[1.3] text-[var(--color-text-primary)]">
              {t('scheduledPage.title')}
            </h1>
            <p className="mt-1.5 text-[13px] leading-[1.6] text-[var(--color-text-tertiary)]">
              {(() => {
                const parts = t('scheduledPage.subtitle').split('{code}')
                return (
                  <>
                    {parts[0]}
                    <code className="rounded-[var(--radius-xs)] bg-[var(--color-surface-container)] px-1.5 py-px font-mono text-[12px] text-[var(--color-text-primary)]">
                      /schedule
                    </code>
                    {parts[1]}
                  </>
                )
              })()}
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-3">
            <SegmentedControl<TaskView>
              as="tablist"
              appearance="chip"
              size="sm"
              label={t('scheduledPage.view.label')}
              value={view}
              onChange={changeView}
              items={[
                { value: 'list', label: t('scheduledPage.view.list'), icon: <List size={14} strokeWidth={1.75} aria-hidden="true" /> },
                { value: 'calendar', label: t('scheduledPage.view.calendar'), icon: <CalendarDays size={14} strokeWidth={1.75} aria-hidden="true" /> },
              ]}
            />
            {/* The label carries its own "+", so no icon beside it. */}
            <Button size="base" onClick={openBlank}>{t('tasks.newTask')}</Button>
          </div>
        </header>

        {/* Desktop-online notice: a standing condition, not a fault, so it is
            the light info strip rather than a warning or the brand wash. */}
        <div className="mt-5 flex items-center gap-2 rounded-[var(--radius-md)] bg-[var(--color-info-container)] px-3 py-2 text-[13px] leading-[1.5] text-[var(--color-on-info-container)]">
          <Info size={14} strokeWidth={1.75} aria-hidden="true" className="shrink-0" />
          <span>{t('scheduledPage.desktopNotice')}</span>
        </div>

        {/* Templates lead while the list is empty, and follow it once there are tasks. */}
        {initialized && tasks.length === 0 ? (
          <div className="mt-5">
            <StarTaskTemplates onPick={openTemplate} />
          </div>
        ) : null}

        {/* Content */}
        <div className="mt-5">
          {!initialized && isLoading ? (
            <div className="flex items-center justify-center py-16">
              <Spinner size={20} tone="brand" label={t('common.loading')} />
            </div>
          ) : error && tasks.length === 0 ? (
            // Without this the store's error falls through to the empty state,
            // so a failed load reads as "you have no tasks".
            <ErrorState
              title={t('common.error')}
              detail={error}
              onRetry={() => void fetchTasks()}
              retryLabel={t('common.retry')}
            />
          ) : view === 'calendar' ? (
            // The calendar is there before the first task too, with the
            // invitation under it: choosing 日历 used to show no calendar at all.
            <>
              <TaskCalendar tasks={tasks} />
              {tasks.length === 0 ? (
                <div className="mt-5">
                  <TaskEmptyState onCreateTask={openBlank} />
                </div>
              ) : null}
            </>
          ) : tasks.length === 0 ? (
            <TaskEmptyState onCreateTask={openBlank} />
          ) : (
            <TaskList tasks={tasks} />
          )}
        </div>

        {initialized && tasks.length > 0 ? (
          <div className="mt-8">
            <StarTaskTemplates onPick={openTemplate} />
          </div>
        ) : null}
      </div>

      {/* New Task Modal */}
      {activeModal === 'new-task' && (
        <NewTaskModal
          key={template?.id ?? 'blank'}
          open
          template={template ?? undefined}
          onClose={() => {
            closeModal()
            setTemplate(null)
          }}
        />
      )}
    </div>
  )
}
