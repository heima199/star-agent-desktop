/**
 * Online updates come only from a STAR update feed: an electron-updater
 * `generic` feed (the folder that serves latest*.yml and the installers) whose
 * URL is set at build time through STAR_UPDATE_URL. package.json ships
 * `build.publish: null`, so a build without that variable has no
 * app-update.yml and its updater stays idle. Any other feed, including the
 * GitHub releases of the project this app was forked from, counts as "no feed"
 * and is never contacted.
 *
 * No Electron imports: the packaging scripts use this module too.
 */

export type StarUpdateFeed = { url: string }

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]'])

/** HTTPS, or plain HTTP to this machine for local feed testing. */
export function isAllowedStarUpdateFeedUrl(value: string): boolean {
  let url: URL
  try {
    url = new URL(value)
  } catch {
    return false
  }
  if (url.username || url.password) return false
  return url.protocol === 'https:' || (url.protocol === 'http:' && LOOPBACK_HOSTS.has(url.hostname))
}

function readField(configText: string, key: string): string {
  const match = configText.match(new RegExp(`^${key}:[ \\t]*(.*)$`, 'm'))
  return (match?.[1] ?? '').trim().replace(/^(['"])(.*)\1$/, '$2').trim()
}

/** Parses the packaged app-update.yml that electron-builder writes. */
export function parseStarUpdateFeed(configText: string): StarUpdateFeed | null {
  if (readField(configText, 'provider') !== 'generic') return null
  const url = readField(configText, 'url')
  return isAllowedStarUpdateFeedUrl(url) ? { url } : null
}

/** The feed configured for this build, or null when there is none. Throws for a bad value. */
export function starUpdateFeedFromEnv(env: NodeJS.ProcessEnv = process.env): StarUpdateFeed | null {
  const value = env.STAR_UPDATE_URL?.trim()
  if (!value) return null
  // The value itself is not echoed: it names the operator's update server.
  if (!isAllowedStarUpdateFeedUrl(value)) {
    throw new Error('STAR_UPDATE_URL must be an https:// URL (http:// only for localhost) without credentials.')
  }
  return { url: value }
}

/** electron-builder `-c.` overrides that publish this build's update metadata to the feed. */
export function starUpdatePublishArgs(env: NodeJS.ProcessEnv = process.env): string[] {
  const feed = starUpdateFeedFromEnv(env)
  return feed ? ['-c.publish.provider=generic', `-c.publish.url=${feed.url}`] : []
}
