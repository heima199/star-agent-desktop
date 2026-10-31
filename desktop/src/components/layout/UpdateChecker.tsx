import { useEffect, useRef, useState } from 'react'
import { Download, X } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { useTranslation } from '../../i18n'
import { isDesktopRuntime } from '../../lib/desktopRuntime'
import { getDesktopHost } from '../../lib/desktopHost'
import {
  displayStarVersion,
  shouldAnnounceStarUpdate,
  starReleaseNotesText,
  STAR_UPDATE_CHECK_INTERVAL_MS,
  STAR_UPDATE_DISMISS_KEY,
  STAR_UPDATE_FIRST_CHECK_DELAY_MS,
  type StarUpdateCheck,
} from '../../lib/starUpdate'
import { useSettingsStore } from '../../stores/settingsStore'
import { useStarUpdateStore } from '../../stores/starUpdateStore'

function readDismissedVersion(): string {
  try { return localStorage.getItem(STAR_UPDATE_DISMISS_KEY) ?? '' } catch { return '' }
}

/**
 * New-version notice. Releases come from the STAR console's update pointer
 * (no sign-in needed), asked shortly after start and then every 6 hours; the
 * download page opens in the system browser and its address is never shown.
 * An optional release stays quiet once put off; a mandatory one comes back on
 * every start, once per run.
 */
export function UpdateChecker() {
  const t = useTranslation()
  const autoUpdateEnabled = useSettingsStore((s) => s.autoUpdateEnabled)
  const [check, setCheck] = useState<StarUpdateCheck | null>(null)
  const handledThisRun = useRef(new Set<string>())

  useEffect(() => {
    if (!isDesktopRuntime() || !autoUpdateEnabled) return
    let cancelled = false
    let timer: number | undefined
    const run = () => {
      void useStarUpdateStore.getState().refresh().then(result => {
        if (cancelled) return
        const announce = shouldAnnounceStarUpdate(result, { dismissedVersion: readDismissedVersion(), handledThisRun: handledThisRun.current })
        setCheck(current => (announce ? result : result.hasUpdate ? current : null))
      }).catch(() => undefined).finally(() => {
        if (!cancelled) timer = window.setTimeout(run, STAR_UPDATE_CHECK_INTERVAL_MS)
      })
    }
    timer = window.setTimeout(run, STAR_UPDATE_FIRST_CHECK_DELAY_MS)
    return () => { cancelled = true; window.clearTimeout(timer) }
  }, [autoUpdateEnabled])

  if (!check) return null
  const version = check.latest.version ?? ''
  const notes = starReleaseNotesText(check.latest.releaseNotes ?? '')
  const dismiss = () => {
    handledThisRun.current.add(version)
    // A mandatory release asks again on the next start.
    if (!check.latest.mandatory) {
      try { localStorage.setItem(STAR_UPDATE_DISMISS_KEY, version) } catch { /* ignore */ }
    }
    setCheck(null)
  }
  return (
    <div className="fixed bottom-4 left-1/2 z-[var(--z-toast)] w-[min(360px,calc(100vw-2rem))] -translate-x-1/2 rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-surface-container-lowest)] p-4 shadow-[var(--shadow-dropdown)]" role="status">
      <div className="flex items-start gap-3">
        <Download size={18} strokeWidth={1.75} className="mt-0.5 shrink-0 text-[var(--color-brand)]" aria-hidden="true" />
        <div className="min-w-0 flex-1">
          <div className="text-[14px] font-medium text-[var(--color-text-primary)]">{t(check.latest.mandatory ? 'update.starFoundMandatory' : 'update.starFound', { version: displayStarVersion(version) })}</div>
          <div className="mt-0.5 line-clamp-3 whitespace-pre-line text-[12px] text-[var(--color-text-tertiary)]">{notes || t('update.starCurrentVersion', { version: check.current })}</div>
        </div>
        <button type="button" aria-label={t('update.later')} onClick={dismiss} className="text-[var(--color-text-tertiary)] hover:text-[var(--color-text-primary)]"><X size={15} strokeWidth={1.75} aria-hidden="true" /></button>
      </div>
      <div className="mt-3 flex justify-end gap-2">
        <Button variant="ghost" size="sm" onClick={dismiss}>{t('update.later')}</Button>
        <Button variant="primary" size="sm" onClick={() => { void getDesktopHost().shell.open(check.latest.downloadUrl!); dismiss() }}>{t('update.starDownload')}</Button>
      </div>
    </div>
  )
}
