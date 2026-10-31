import { useState } from 'react'
import { PictureInPicture2 } from 'lucide-react'
import { desktopUiPreferencesApi } from '../../api/desktopUiPreferences'
import { useTranslation } from '../../i18n'
import { getDesktopHost } from '../../lib/desktopHost'
import { useUIStore } from '../../stores/uiStore'
import { IconButton } from '../ui/IconButton'

/**
 * From the conversation to the desktop pet in one click: the pet comes out
 * (turned on first when it was off) and the window minimizes. The pet keeps
 * showing what the tasks are doing; clicking it brings the window back.
 */
export async function minimizeToPet(): Promise<void> {
  const host = getDesktopHost()
  const { pet } = await desktopUiPreferencesApi.getPetPreferences()
  if (!pet.enabled) await desktopUiPreferencesApi.updatePetPreferences({ enabled: true })
  await host.pets.show()
  await host.window.minimize()
}

export function MinimizeToPetButton() {
  const t = useTranslation()
  const [busy, setBusy] = useState(false)
  return (
    <IconButton
      icon={<PictureInPicture2 size={16} strokeWidth={1.75} aria-hidden="true" />}
      label={t('tabs.minimizeToPet')}
      size="sm"
      tone="muted"
      disabled={busy}
      data-testid="minimize-to-pet"
      onClick={() => {
        setBusy(true)
        void minimizeToPet()
          .catch(() => useUIStore.getState().addToast({ type: 'error', message: t('tabs.minimizeToPetFailed') }))
          .finally(() => setBusy(false))
      }}
    />
  )
}
