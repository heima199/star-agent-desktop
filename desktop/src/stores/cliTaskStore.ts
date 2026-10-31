import { create } from 'zustand'
import { ApiError } from '../api/client'
import { cliTasksApi } from '../api/cliTasks'
import type { CLITask, TaskStatus } from '../types/cliTask'

type TodoItem = {
  content: string
  status: string
  activeForm?: string
}

type CLITaskStore = {
  /** Current session ID being tracked */
  sessionId: string | null
  /** Tasks for the current session */
  tasks: CLITask[]
  /** True while the persisted task list is being cleared remotely */
  resetting: boolean
  /** Whether the task bar is expanded */
  expanded: boolean
  /** True when all tasks completed and the user already continued chatting.
   *  Set during history load so the sticky bar is suppressed on page refresh. */
  completedAndDismissed: boolean
  /** Snapshot of the completed task set that was dismissed */
  dismissedCompletionKey: string | null
  /**
   * Polling for the tracked session gave up: the server answered in a way that
   * retrying does not change (not found, no access), or TASK_POLL_FAILURE_LIMIT
   * polls failed in a row. Asking every second only filled the log; the next
   * turn, a successful refresh, or another session starts it again.
   */
  pollingHalted: boolean

  /** Fetch tasks for a given session (uses sessionId as taskListId) */
  fetchSessionTasks: (sessionId: string) => Promise<void>
  /** Let polling for `sessionId` try again after it gave up, as a new turn does */
  resumeTaskPolling: (sessionId: string) => void
  /** Refresh tasks for the currently tracked session, or a specific session if provided */
  refreshTasks: (sessionId?: string) => Promise<void>
  /** Update tasks from TodoWrite V1 tool input (in-memory, no disk read needed) */
  setTasksFromTodos: (todos: TodoItem[], sessionId?: string) => void
  /** Put back what the bar showed, unless it has moved on to another session */
  restoreTasks: (snapshot: CLITaskSnapshot) => void
  /** Mark that completed tasks were already dismissed (conversation continued) */
  markCompletedAndDismissed: (sessionId?: string) => void
  /** Clear a completed task list locally and remotely so the next cycle starts clean */
  resetCompletedTasks: (sessionId?: string) => Promise<void>
  /** Clear task tracking state */
  clearTasks: (sessionId?: string) => void
  /** Toggle expanded state */
  toggleExpanded: () => void
}

/** What the task bar showed for one session, to undo a live update that did not happen. */
export type CLITaskSnapshot = Pick<CLITaskStore, 'tasks' | 'completedAndDismissed' | 'dismissedCompletionKey'> & {
  sessionId: string
}

let taskRequestSequence = 0
let taskRequestGeneration = 0
const latestAppliedTaskRequestBySession = new Map<string, number>()
const activeTaskPollBySession = new Map<string, Promise<void>>()
/** Polls in a row that failed, per session. Any success clears it. */
const taskPollFailuresBySession = new Map<string, number>()

/** Failed polls in a row after which polling stops until something restarts it. */
export const TASK_POLL_FAILURE_LIMIT = 5

/** Answers that come back the same however often the poll asks. */
function isLastingTaskPollFailure(error: unknown): boolean {
  return error instanceof ApiError && [401, 403, 404, 405].includes(error.status)
}

type TaskRequest = {
  requestId: number
  generation: number
}

function beginTaskRequest(): TaskRequest {
  return {
    requestId: ++taskRequestSequence,
    generation: taskRequestGeneration,
  }
}

function canApplyTaskResponse(sessionId: string, request: TaskRequest): boolean {
  return request.generation === taskRequestGeneration
    && request.requestId > (latestAppliedTaskRequestBySession.get(sessionId) ?? 0)
}

function markTaskResponseApplied(sessionId: string, request: TaskRequest): void {
  latestAppliedTaskRequestBySession.set(sessionId, request.requestId)
}

function invalidateTaskRequests(): void {
  taskRequestGeneration += 1
  latestAppliedTaskRequestBySession.clear()
}

function buildCompletedTaskKey(tasks: CLITask[]): string | null {
  if (tasks.length === 0 || tasks.some((task) => task.status !== 'completed')) return null

  return tasks
    .map((task) => [
      task.taskListId,
      task.id,
      task.subject,
      task.status,
      task.activeForm ?? '',
      task.owner ?? '',
    ].join('::'))
    .join('|')
}

function resolveDismissState(tasks: CLITask[], dismissedCompletionKey: string | null) {
  const completionKey = buildCompletedTaskKey(tasks)
  const keepDismissed = completionKey !== null && completionKey === dismissedCompletionKey

  return {
    completedAndDismissed: keepDismissed,
    dismissedCompletionKey: keepDismissed ? completionKey : null,
  }
}

function mapTodosToTasks(todos: TodoItem[], sessionId: string | null): CLITask[] {
  return todos.map((todo, index) => ({
    id: String(index + 1),
    subject: todo.content,
    description: '',
    activeForm: todo.activeForm,
    status: (['pending', 'in_progress', 'completed'].includes(todo.status)
      ? todo.status
      : 'pending') as TaskStatus,
    blocks: [],
    blockedBy: [],
    taskListId: sessionId || '',
  }))
}

export const useCLITaskStore = create<CLITaskStore>((set, get) => ({
  sessionId: null,
  tasks: [],
  resetting: false,
  expanded: false,
  completedAndDismissed: false,
  dismissedCompletionKey: null,
  pollingHalted: false,

  fetchSessionTasks: async (sessionId) => {
    if (get().sessionId !== sessionId) {
      invalidateTaskRequests()
      taskPollFailuresBySession.delete(sessionId)
      set({
        sessionId,
        tasks: [],
        resetting: false,
        completedAndDismissed: false,
        dismissedCompletionKey: null,
        expanded: false,
        pollingHalted: false,
      })
    } else if (get().pollingHalted) {
      return
    }

    const activePoll = activeTaskPollBySession.get(sessionId)
    if (activePoll) return activePoll

    const poll = (async () => {
      const request = beginTaskRequest()
      try {
        const { tasks } = await cliTasksApi.getTasksForList(sessionId)
        taskPollFailuresBySession.delete(sessionId)
        if (
          canApplyTaskResponse(sessionId, request)
          && get().sessionId === sessionId
          && !get().resetting
        ) {
          markTaskResponseApplied(sessionId, request)
          set((state) => ({
            tasks,
            ...resolveDismissState(tasks, state.dismissedCompletionKey),
          }))
        }
      } catch (error) {
        // Preserve the last known task state across transient polling failures,
        // but stop asking once the failures are not transient.
        const failures = (taskPollFailuresBySession.get(sessionId) ?? 0) + 1
        taskPollFailuresBySession.set(sessionId, failures)
        if (
          (isLastingTaskPollFailure(error) || failures >= TASK_POLL_FAILURE_LIMIT)
          && get().sessionId === sessionId
        ) {
          set({ pollingHalted: true })
        }
      }
    })()

    activeTaskPollBySession.set(sessionId, poll)
    try {
      await poll
    } finally {
      if (activeTaskPollBySession.get(sessionId) === poll) {
        activeTaskPollBySession.delete(sessionId)
      }
    }
  },

  resumeTaskPolling: (sessionId) => {
    taskPollFailuresBySession.delete(sessionId)
    if (get().sessionId === sessionId && get().pollingHalted) set({ pollingHalted: false })
  },

  refreshTasks: async (targetSessionId) => {
    const sessionId = targetSessionId ?? get().sessionId
    if (!sessionId) return
    const request = beginTaskRequest()
    try {
      const { tasks } = await cliTasksApi.getTasksForList(sessionId)
      // The server answers again, so polling may too.
      taskPollFailuresBySession.delete(sessionId)
      if (get().sessionId === sessionId && get().pollingHalted) set({ pollingHalted: false })
      if (
        canApplyTaskResponse(sessionId, request)
        && get().sessionId === sessionId
        && !get().resetting
      ) {
        markTaskResponseApplied(sessionId, request)
        set((state) => ({
          tasks,
          ...resolveDismissState(tasks, state.dismissedCompletionKey),
        }))
      }
    } catch {
      // ignore
    }
  },

  setTasksFromTodos: (todos, targetSessionId) => {
    const sessionId = targetSessionId ?? get().sessionId
    if (!sessionId || get().sessionId !== sessionId) return
    invalidateTaskRequests()
    const tasks = mapTodosToTasks(todos, sessionId)
    set((state) => ({
      tasks,
      ...resolveDismissState(tasks, state.dismissedCompletionKey),
    }))
  },

  restoreTasks: (snapshot) => {
    if (get().sessionId !== snapshot.sessionId) return
    // Like a live TodoWrite, this is newer than any read still in flight.
    invalidateTaskRequests()
    set({
      tasks: snapshot.tasks,
      completedAndDismissed: snapshot.completedAndDismissed,
      dismissedCompletionKey: snapshot.dismissedCompletionKey,
    })
  },

  markCompletedAndDismissed: (targetSessionId) => {
    const sessionId = targetSessionId ?? get().sessionId
    if (!sessionId || get().sessionId !== sessionId) return
    const completionKey = buildCompletedTaskKey(get().tasks)
    if (!completionKey) return

    set({
      completedAndDismissed: true,
      dismissedCompletionKey: completionKey,
      expanded: false,
    })
  },

  resetCompletedTasks: async (targetSessionId) => {
    const sessionId = targetSessionId ?? get().sessionId
    if (!sessionId || get().sessionId !== sessionId) return
    const { tasks } = get()
    const completionKey = buildCompletedTaskKey(tasks)
    if (!completionKey) return

    invalidateTaskRequests()
    set({
      tasks: [],
      resetting: true,
      completedAndDismissed: true,
      dismissedCompletionKey: completionKey,
      expanded: false,
    })

    try {
      await cliTasksApi.resetTaskList(sessionId)
    } finally {
      if (get().sessionId === sessionId) {
        set({ resetting: false })
      }
    }
  },

  clearTasks: (targetSessionId) => {
    if (targetSessionId && get().sessionId !== targetSessionId) return
    invalidateTaskRequests()
    // Counts only matter for the tracked session, and tracking starts over.
    taskPollFailuresBySession.clear()
    set({
      sessionId: null,
      tasks: [],
      resetting: false,
      completedAndDismissed: false,
      dismissedCompletionKey: null,
      expanded: false,
      pollingHalted: false,
    })
  },

  toggleExpanded: () => {
    set((s) => ({ expanded: !s.expanded }))
  },
}))
