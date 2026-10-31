import { useEffect } from 'react'
import { isStarTaskActive, useStarStore } from '../../stores/starStore'

const QUOTA_MS = 60_000
const CATALOG_MS = 15 * 60_000
const TASKS_ACTIVE_MS = 2_000
const TASKS_IDLE_MS = 15_000

/**
 * Keeps the STAR account, model catalog and media task list fresh for the
 * whole shell. Mounted once by the app shell.
 */
export function useStarSync(enabled: boolean): void {
  useEffect(() => {
    if (!enabled) return
    let disposed = false
    const store = useStarStore.getState
    void store().refreshStatus().then((status) => {
      if (disposed) return
      // Starting signed out opens the full-screen sign-in, once per launch.
      store().promptStartupLogin(status)
      if (!status?.signedIn) return
      void store().refreshQuota()
      void store().loadCatalog()
    })

    let taskTimer: ReturnType<typeof setTimeout> | undefined
    const pollTasks = async () => {
      await store().refreshTasks()
      if (disposed) return
      const active = store().runningTasks > 0 || store().tasks.some(isStarTaskActive)
      taskTimer = setTimeout(() => void pollTasks(), active ? TASKS_ACTIVE_MS : TASKS_IDLE_MS)
    }
    taskTimer = setTimeout(() => void pollTasks(), 1_500)

    const quotaTimer = setInterval(() => void store().refreshQuota(), QUOTA_MS)
    const catalogTimer = setInterval(() => {
      if (store().status?.signedIn) void store().loadCatalog(true)
    }, CATALOG_MS)
    const onFocus = () => {
      void store().refreshStatus().then((status) => {
        // Only decides when the status at startup could not be read.
        store().promptStartupLogin(status)
        return store().refreshQuota()
      })
    }
    window.addEventListener('focus', onFocus)
    return () => {
      disposed = true
      if (taskTimer) clearTimeout(taskTimer)
      clearInterval(quotaTimer)
      clearInterval(catalogTimer)
      window.removeEventListener('focus', onFocus)
    }
  }, [enabled])
}

/** Ask the task list to refresh soon (after starting a job). */
export function pokeStarTasks(): void {
  void useStarStore.getState().refreshTasks()
}
