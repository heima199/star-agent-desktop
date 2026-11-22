import { useEffect } from 'react'
import { useTranslation } from '../../i18n'
import { TerminalSettings } from '../../pages/TerminalSettings'
import { subscribeTerminalRuntime, getTerminalRuntime } from '../../lib/terminalRuntime'
import { useWorkspaceStore } from '../../stores/workspaceStore'
import type { WorkspaceTerminalTab as WorkspaceTerminalTabModel } from '../../lib/workspace/types'

export type WorkspaceTerminalTabProps = {
  sessionId: string
  tab: WorkspaceTerminalTabModel
  active: boolean
}

/**
 * A terminal tab is a thin frame around the existing runtime.
 *
 * `preserveOnUnmount` is the load-bearing prop: xterm can be re-attached to a
 * new host element without the PTY noticing, which is what lets a terminal move
 * between the side and bottom docks, survive the panel being hidden, and
 * survive the user switching tasks. Only `closeTab` kills the process.
 */
export function WorkspaceTerminalTab({ sessionId, tab, active }: WorkspaceTerminalTabProps) {
  const t = useTranslation()
  const runtimeId = tab.runtimeId

  useEffect(() => {
    // Report exits back to the controller so the tab can offer a restart
    // instead of pretending the shell is still live.
    const runtime = getTerminalRuntime(runtimeId, 'idle')
    const sync = () => {
      // `idle` means "no process yet" — a restored terminal waiting for the user
      // to start it. Reporting that as `live` is what let a restored tab
      // overwrite its own persisted `exited` state before anyone could see it.
      if (runtime.status === 'idle') return
      useWorkspaceStore.getState().setTerminalStatus(
        sessionId,
        runtimeId,
        runtime.status === 'exited' || runtime.status === 'error' || runtime.status === 'unavailable'
          ? 'exited'
          : 'live',
      )
    }
    sync()
    return subscribeTerminalRuntime(runtime, sync)
  }, [runtimeId, sessionId])

  return (
    <div className="flex min-h-0 flex-1 flex-col" data-testid={`workspace-terminal-${tab.id}`}>
      {tab.status === 'exited' ? (
        <p
          role="status"
          data-testid={`workspace-terminal-exited-${tab.ordinal}`}
          className="flex shrink-0 items-center gap-1.5 border-b border-[var(--color-border)] bg-[var(--color-surface-container)] px-3 py-1.5 text-[12px] text-[var(--color-text-secondary)]"
        >
          <span>{t('workspace.terminal.exited')}</span>
          {/* The tab menu holds the same action, but nothing on screen points
              there, and a tab restored from disk shows nothing else. */}
          <button
            type="button"
            data-testid={`workspace-terminal-restart-${tab.ordinal}`}
            className="rounded-[var(--radius-sm)] font-medium text-[var(--color-text-primary)] underline decoration-[var(--color-border)] underline-offset-2 transition-colors hover:decoration-current focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-border-focus)]"
            onClick={() => getTerminalRuntime(runtimeId, 'idle').restart?.()}
          >
            {t('workspace.terminal.restart')}
          </button>
        </p>
      ) : null}
      <TerminalSettings
        active={active}
        docked
        compactHeader
        cwd={tab.cwd}
        runtimeId={runtimeId}
        preserveOnUnmount
        // A tab restored from disk carries `exited`; it must not spawn a shell
        // just because the panel came back on screen.
        autoStart={tab.status !== 'exited'}
        testId={`workspace-terminal-host-${tab.ordinal}`}
      />
    </div>
  )
}
