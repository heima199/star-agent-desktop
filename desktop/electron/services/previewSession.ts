import { randomUUID } from 'node:crypto'
import type { Session } from 'electron'

const PREVIEW_SESSION_PARTITION_PREFIX = 'cc-haha-preview-'

export function createPreviewSessionPartition(): string {
  return `${PREVIEW_SESSION_PARTITION_PREFIX}${randomUUID()}`
}

export type PreviewLocalAccess = {
  serverUrl: string
  token: string
}

export type LocalServerRequestDetails = {
  method?: string
  resourceType?: string
  url: string
  webContentsId?: number
}

export type LocalServerRequestAuthorizer = (
  details: LocalServerRequestDetails,
) => boolean

const MAIN_RENDERER_MEDIA_PATHS = [
  '/api/desktop-ui/preferences/profile/avatar',
  '/api/filesystem/file',
]

const MAIN_RENDERER_MEDIA_PREFIXES = [
  '/api/open-targets/icons/',
  '/preview-fs/',
]

function sameOrigin(left: string, right: string): boolean {
  try {
    return new URL(left).origin === new URL(right).origin
  } catch {
    return false
  }
}

/**
 * The packaged renderer is loaded from `file://`, so its intentional local
 * images and videos look like cross-site browser subresources to the sidecar.
 * Keep this allowlist limited to read-only media routes: arbitrary API fetches,
 * scripts, styles, frames and preview-window traffic must remain unauthenticated.
 */
export function isAllowlistedMainRendererMediaRequest(
  details: LocalServerRequestDetails,
  mainRendererWebContentsId: number,
): boolean {
  if (details.webContentsId !== mainRendererWebContentsId) return false

  const method = details.method?.toUpperCase()
  if (method !== 'GET' && method !== 'HEAD') return false
  if (details.resourceType !== 'image' && details.resourceType !== 'media') {
    return false
  }

  let pathname: string
  try {
    pathname = new URL(details.url).pathname
  } catch {
    return false
  }

  return MAIN_RENDERER_MEDIA_PATHS.includes(pathname) ||
    MAIN_RENDERER_MEDIA_PREFIXES.some((prefix) => pathname.startsWith(prefix))
}

export function configureLocalServerRequestAuth(
  webRequest: Pick<Session['webRequest'], 'onBeforeSendHeaders'>,
  resolveLocalAccess: () => PreviewLocalAccess | null,
  shouldAuthorize: LocalServerRequestAuthorizer = () => true,
): void {
  webRequest.onBeforeSendHeaders((details, callback) => {
    const localAccess = resolveLocalAccess()
    if (
      !localAccess ||
      !sameOrigin(details.url, localAccess.serverUrl) ||
      !shouldAuthorize(details)
    ) {
      callback({ requestHeaders: details.requestHeaders })
      return
    }

    callback({
      requestHeaders: {
        ...details.requestHeaders,
        Authorization: `Bearer ${localAccess.token}`,
      },
    })
  })
}

export function configurePreviewSessionPermissions(
  session: Pick<Session, 'setPermissionCheckHandler' | 'setPermissionRequestHandler'>,
): void {
  session.setPermissionCheckHandler(() => false)
  session.setPermissionRequestHandler((_webContents, _permission, callback) => {
    callback(false)
  })
}

/**
 * What a page of the in-app browser (workspace browser, sidebar 推荐 tabs) may
 * use: none of the OS permissions (camera, microphone, location,
 * notifications, ...) and no clipboard reads. Writing to the clipboard is the
 * one exception. Sites' copy buttons call `navigator.clipboard.writeText`,
 * which Chrome allows without asking, and denying it leaves those buttons dead.
 */
const BROWSER_PAGE_PERMISSIONS: ReadonlySet<string> = new Set(['clipboard-sanitized-write'])

export function configureBrowserSessionPermissions(
  session: Pick<Session, 'setPermissionCheckHandler' | 'setPermissionRequestHandler'>,
): void {
  session.setPermissionCheckHandler((_webContents, permission) => BROWSER_PAGE_PERMISSIONS.has(permission))
  session.setPermissionRequestHandler((_webContents, permission, callback) => {
    callback(BROWSER_PAGE_PERMISSIONS.has(permission))
  })
}
