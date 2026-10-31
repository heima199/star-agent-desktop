import { useCallback, useEffect, useSyncExternalStore } from 'react'
import { useSettingsStore } from '../stores/settingsStore'
import { getStarBrandName, useStarBrandStore } from '../stores/starBrandStore'
import { starBrandParams } from '../lib/starBrand'
import { en, type TranslationKey } from './locales/en'
import { zh } from './locales/zh'
import type { Locale } from './locale'

/**
 * English (the fallback for every missing key) and Simplified Chinese (what
 * STAR users run) ship in the startup bundle. The other three load the first
 * time they are needed — at boot, before the app mounts, for a user who chose
 * one of them (main.tsx), or when the language is switched — and stay loaded.
 * All five used to be parsed before the window showed anything: 1.2 MB of
 * the 1.4 MB startup chunk.
 */
const translations: Partial<Record<Locale, Record<string, string>>> = {
  en,
  zh,
}

const LOCALE_LOADERS: Partial<Record<Locale, () => Promise<Record<string, string>>>> = {
  'zh-TW': () => import('./locales/zh-TW').then((module) => module.zh),
  jp: () => import('./locales/jp').then((module) => module.jp),
  kr: () => import('./locales/kr').then((module) => module.kr),
}

const pendingLocales = new Map<Locale, Promise<void>>()
const loadedListeners = new Set<() => void>()
let loadedVersion = 0

/** Whether `translate` has this locale's own texts (until then it answers in English). */
export function isLocaleLoaded(locale: Locale): boolean {
  return Boolean(translations[locale])
}

/**
 * Loads a locale's texts once. Resolves when `translate` can use them, or
 * when loading failed (the texts stay English, and a later call tries again).
 */
export function loadLocale(locale: Locale): Promise<void> {
  if (translations[locale]) return Promise.resolve()
  const loader = LOCALE_LOADERS[locale]
  if (!loader) return Promise.resolve()
  let pending = pendingLocales.get(locale)
  if (!pending) {
    pending = loader()
      .then((texts) => {
        translations[locale] = texts
        loadedVersion += 1
        for (const listener of loadedListeners) listener()
      })
      .catch((error: unknown) => {
        console.error(`[i18n] could not load the ${locale} texts`, error)
      })
      .finally(() => {
        pendingLocales.delete(locale)
      })
    pendingLocales.set(locale, pending)
  }
  return pending
}

function subscribeLoadedLocales(listener: () => void): () => void {
  loadedListeners.add(listener)
  return () => {
    loadedListeners.delete(listener)
  }
}

function getLoadedVersion(): number {
  return loadedVersion
}

/**
 * Translate a key with optional interpolation params.
 * Falls back to English, then to the key itself, if no translation is found.
 *
 * @example
 * translate('en', 'settings.providers.connected', { latency: '42' })
 * // => "Connected (42ms)"
 */
export function translate(
  locale: Locale,
  key: TranslationKey,
  params?: Record<string, string | number>,
  brand: string = getStarBrandName(),
): string {
  let text = translations[locale]?.[key] ?? en[key] ?? key
  // {brand}, {brandAgent}, {brandCode}: the name the STAR console sets (explicit params win).
  const values = text.includes('{brand') ? { ...starBrandParams(brand), ...params } : params
  if (values) {
    for (const [k, v] of Object.entries(values)) {
      text = text.replace(new RegExp(`\\{${k}\\}`, 'g'), String(v))
    }
  }
  return text
}

/**
 * React hook that returns a `t()` function bound to the current locale.
 * Re-renders when the locale changes, and again once a locale loaded on
 * demand has arrived.
 *
 * @example
 * const t = useTranslation()
 * t('sidebar.newSession')  // => "New session" or "新建会话"
 */
export function useTranslation() {
  const locale = useSettingsStore((s) => s.locale)
  // Texts naming the product re-render when the console's name arrives.
  const brand = useStarBrandStore((s) => s.name)
  const loaded = useSyncExternalStore(subscribeLoadedLocales, getLoadedVersion, getLoadedVersion)
  useEffect(() => {
    if (!isLocaleLoaded(locale)) void loadLocale(locale)
  }, [locale])
  return useCallback(
    (key: TranslationKey, params?: Record<string, string | number>) => {
      // A new function once more texts are in, so memoized callers re-run.
      void loaded
      return translate(locale, key, params, brand)
    },
    [locale, brand, loaded],
  )
}

/**
 * Get a translation outside of React (e.g. in stores).
 * Reads the current locale from the Zustand store directly.
 */
export function t(key: TranslationKey, params?: Record<string, string | number>): string {
  const locale = useSettingsStore.getState().locale
  return translate(locale, key, params)
}

export type { TranslationKey }
export type { Locale } from './locale'
