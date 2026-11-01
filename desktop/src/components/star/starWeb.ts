import { isWorkspaceBrowserAvailable } from '../../lib/workspace/browserHost'
import { STAR_WEB_TAB_PREFIX, useTabStore } from '../../stores/tabStore'
import { openExternal } from './starPages'

/** The http(s) address `value` names, or null: nothing else opens as a web page. */
export function starWebUrl(value: string): string | null {
  try {
    const url = new URL(value.trim())
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.toString() : null
  } catch {
    return null
  }
}

/** FNV-1a: a short id that is the same for the same text. */
function hashText(value: string): string {
  let hash = 0x811c9dc5
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193)
  }
  return (hash >>> 0).toString(36)
}

/**
 * Tab id of a sidebar 推荐 entry, derived from its name and address: a second
 * click focuses the tab the first one opened, and two entries that share an
 * address still get a tab each.
 */
export function starWebTabId(name: string, url: string): string {
  return `${STAR_WEB_TAB_PREFIX}${hashText(`${name.trim()}\n${starWebUrl(url) ?? url}`)}`
}

let unpinnedSequence = 0

/**
 * Opens a web page inside the app, in a tab of its own.
 *
 * `title` names the tab (a sidebar entry's name); without one the tab takes
 * the page's title. With `tabId` an open tab of that id is focused instead of
 * opening another; without it (a page's popup) every open gets a new tab.
 * `background` adds the tab without leaving the current one. Hosts without
 * the in-app browser (the web build) open the system browser, as before.
 */
export function openStarWeb(value: string, options: { title?: string; tabId?: string; background?: boolean } = {}): void {
  const url = starWebUrl(value)
  if (!url) return
  if (!isWorkspaceBrowserAvailable()) {
    openExternal(url)
    return
  }
  unpinnedSequence += 1
  const tabId = options.tabId ?? `${STAR_WEB_TAB_PREFIX}${Date.now().toString(36)}-${unpinnedSequence}`
  const title = options.title?.trim() || new URL(url).hostname
  useTabStore.getState().openWebTab(tabId, title, url, {
    followTitle: !options.title?.trim(),
    background: options.background === true,
  })
}
