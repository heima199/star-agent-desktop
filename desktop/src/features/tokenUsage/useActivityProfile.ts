import { useCallback, useEffect, useMemo, useState, type ChangeEvent } from 'react'

import {
  desktopUiPreferencesApi,
  getProfileAvatarUrl,
  type DesktopProfilePreferences,
} from '../../api/desktopUiPreferences'
import { useTranslation } from '../../i18n'
import { publicAssetPath } from '../../lib/publicAsset'
import { getStarBrandName, useStarBrand } from '../../stores/starBrandStore'

/**
 * What a profile is called until someone names it: the local server's default,
 * which is still the upstream project's name. The page shows the product's
 * name in its place (设置 → 数据管理 → 使用统计 read "cc-haha").
 */
export const UNNAMED_PROFILE_DISPLAY_NAME = 'cc-haha'

export const DEFAULT_PROFILE: DesktopProfilePreferences = {
  displayName: UNNAMED_PROFILE_DISPLAY_NAME,
  subtitle: 'STAR',
  avatarFile: null,
  avatarUpdatedAt: null,
}

/** The profile as the page shows it: one nobody named carries the product's name. */
export function withProductName(profile: DesktopProfilePreferences, productName: string): DesktopProfilePreferences {
  return profile.displayName === UNNAMED_PROFILE_DISPLAY_NAME ? { ...profile, displayName: productName } : profile
}

export const DEFAULT_AVATAR_SRC = publicAssetPath('app-icon.png')

function withProfileDefaults(profile: Partial<DesktopProfilePreferences> | null | undefined): DesktopProfilePreferences {
  return { ...DEFAULT_PROFILE, ...profile }
}

/** A second line that looks like a URL (with or without a scheme) becomes a link. */
export function getProfileSubtitleHref(subtitle: string) {
  if (/^https?:\/\//i.test(subtitle)) return subtitle
  if (/^[\w.-]+\.[a-z]{2,}(?:\/.*)?$/i.test(subtitle)) return `https://${subtitle}`
  return null
}

/** Where the profile's picture comes from; null means the page falls back to the app icon. */
export function getProfileAvatarSource(profile: DesktopProfilePreferences) {
  return profile.avatarFile ? getProfileAvatarUrl(profile.avatarUpdatedAt) : null
}

export type ActivityProfile = ReturnType<typeof useActivityProfile>

/** The identity shown on the usage page and its edit dialog: load, edit, save, avatar upload and removal. */
export function useActivityProfile() {
  const t = useTranslation()
  const brand = useStarBrand()
  const [stored, setStored] = useState<DesktopProfilePreferences>(DEFAULT_PROFILE)
  const profile = useMemo(() => withProductName(stored, brand.name), [stored, brand.name])
  const [error, setError] = useState<string | null>(null)
  const [status, setStatus] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [isEditing, setIsEditing] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const [draftDisplayName, setDraftDisplayName] = useState(profile.displayName)
  const [draftSubtitle, setDraftSubtitle] = useState(DEFAULT_PROFILE.subtitle)

  const adopt = useCallback((next: DesktopProfilePreferences) => {
    setStored(next)
    setDraftDisplayName(withProductName(next, getStarBrandName()).displayName)
    setDraftSubtitle(next.subtitle)
  }, [])

  useEffect(() => {
    let cancelled = false
    setIsLoading(true)
    setError(null)
    desktopUiPreferencesApi.getPreferences()
      .then((result) => {
        if (!cancelled) adopt(withProfileDefaults(result.preferences.profile))
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err))
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [adopt])

  const run = async (work: () => Promise<DesktopProfilePreferences>, afterSave?: () => void) => {
    setIsSaving(true)
    setError(null)
    setStatus(null)
    try {
      adopt(await work())
      afterSave?.()
      setStatus(t('settings.activity.profileSaved'))
    } catch (err) {
      setError(err instanceof Error ? err.message : t('settings.activity.profileSaveFailed'))
    } finally {
      setIsSaving(false)
    }
  }

  return {
    profile,
    error,
    status,
    isLoading,
    isEditing,
    isSaving,
    draftDisplayName,
    draftSubtitle,
    setDraftDisplayName,
    setDraftSubtitle,
    startEdit: () => {
      setIsEditing(true)
      setDraftDisplayName(profile.displayName)
      setDraftSubtitle(profile.subtitle)
    },
    cancelEdit: () => {
      setIsEditing(false)
      setDraftDisplayName(profile.displayName)
      setDraftSubtitle(profile.subtitle)
      setError(null)
    },
    save: () => run(
      async () => withProfileDefaults((await desktopUiPreferencesApi.updateProfilePreferences({
        displayName: draftDisplayName,
        subtitle: draftSubtitle,
      })).preferences.profile),
      () => setIsEditing(false),
    ),
    uploadAvatar: (event: ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0]
      event.target.value = ''
      if (!file) return Promise.resolve()
      return run(async () => withProfileDefaults((await desktopUiPreferencesApi.uploadProfileAvatar(file)).preferences.profile))
    },
    removeAvatar: () => run(async () => withProfileDefaults((await desktopUiPreferencesApi.deleteProfileAvatar()).preferences.profile)),
  }
}
