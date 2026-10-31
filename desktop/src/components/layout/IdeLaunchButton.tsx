import { useCallback, useEffect, useState } from 'react'
import { ArrowUpRight } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { useTranslation } from '../../i18n'
import { useOpenTargetStore } from '../../stores/openTargetStore'
import { useUIStore } from '../../stores/uiStore'

/** Same id as `STAR_CODE_TARGET_ID` in src/server/services/openTargetService.ts. */
export const STAR_CODE_TARGET_ID = 'star-code'

function hasStarCode(): boolean {
  return useOpenTargetStore.getState().targets.some((target) => target.id === STAR_CODE_TARGET_ID)
}

/**
 * 「IDE ↗」 in the window's top-right corner, in every mode: hands the current
 * project (or, without one, just the IDE) to STAR Code, the IDE built on
 * Code-OSS, in its own window. The IDE's title bar has the matching "Agent"
 * button that brings this window back.
 *
 * This window is the agent-first surface; when a change needs a full editor the
 * project moves to the IDE, the way TRAE's SOLO window hands off to its IDE. The
 * installer ships STAR Code next to this app, and the launch goes through the
 * open-targets API like every other "open in …" entry, so detection and the
 * executable guard stay on the server.
 */
export function IdeLaunchButton({ path }: { path: string }) {
  const t = useTranslation()
  const ensureTargets = useOpenTargetStore((state) => state.ensureTargets)
  const refreshTargets = useOpenTargetStore((state) => state.refreshTargets)
  const openTarget = useOpenTargetStore((state) => state.openTarget)
  const [opening, setOpening] = useState(false)

  // Warm the list so the first click usually launches without a round trip.
  useEffect(() => {
    void ensureTargets()
  }, [ensureTargets])

  const handleClick = useCallback(async () => {
    setOpening(true)
    try {
      // Not in the cached list: either the warm-up load has not returned yet
      // (`ensureTargets` returns early while one is in flight) or STAR Code was
      // installed after it ran. Ask again before saying it is missing.
      if (!hasStarCode()) await refreshTargets()
      if (!hasStarCode()) {
        useUIStore.getState().addToast({ type: 'warning', message: t('ideLaunch.notInstalled') })
        return
      }
      await openTarget(STAR_CODE_TARGET_ID, path)
    } catch {
      useUIStore.getState().addToast({ type: 'error', message: t('ideLaunch.openFailed') })
    } finally {
      setOpening(false)
    }
  }, [openTarget, path, refreshTargets, t])

  return (
    <Button
      // A mode switch, not one more toolbar action: the soft brand fill sets it
      // apart from the outlined buttons beside it, as TRAE marks its IDE switch.
      variant="tonal"
      size="sm"
      title={t('ideLaunch.title')}
      icon={<ArrowUpRight size={13} strokeWidth={1.75} aria-hidden="true" />}
      iconPosition="end"
      loading={opening}
      onClick={() => void handleClick()}
      data-testid="ide-launch-button"
    >
      {t('ideLaunch.label')}
    </Button>
  )
}
