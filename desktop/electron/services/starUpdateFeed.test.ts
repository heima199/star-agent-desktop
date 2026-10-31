import { describe, expect, it } from 'vitest'
import {
  isAllowedStarUpdateFeedUrl,
  parseStarUpdateFeed,
  starUpdateFeedFromEnv,
  starUpdatePublishArgs,
} from './starUpdateFeed'

describe('STAR update feed', () => {
  it('accepts only https feeds, or http to this machine', () => {
    expect(isAllowedStarUpdateFeedUrl('https://updates.example.com/star-agent/')).toBe(true)
    expect(isAllowedStarUpdateFeedUrl('http://127.0.0.1:8080/feed')).toBe(true)
    expect(isAllowedStarUpdateFeedUrl('http://localhost:8080/feed')).toBe(true)
    expect(isAllowedStarUpdateFeedUrl('http://[::1]:8080/feed')).toBe(true)
    expect(isAllowedStarUpdateFeedUrl('http://updates.example.com/feed')).toBe(false)
    expect(isAllowedStarUpdateFeedUrl('https://user:secret@updates.example.com/feed')).toBe(false)
    expect(isAllowedStarUpdateFeedUrl('file:///C:/feed')).toBe(false)
    expect(isAllowedStarUpdateFeedUrl('not a url')).toBe(false)
  })

  it('reads the generic feed electron-builder writes into app-update.yml', () => {
    expect(parseStarUpdateFeed('provider: generic\nurl: https://updates.example.com/star\nupdaterCacheDirName: x-updater\n'))
      .toEqual({ url: 'https://updates.example.com/star' })
    expect(parseStarUpdateFeed("url: 'https://updates.example.com/star'\r\nprovider: \"generic\"\r\n"))
      .toEqual({ url: 'https://updates.example.com/star' })
  })

  it('treats a code-host feed or an incomplete config as no feed', () => {
    expect(parseStarUpdateFeed('owner: NanmiCoder\nrepo: cc-haha\nprovider: github\n')).toBeNull()
    expect(parseStarUpdateFeed('provider: generic\n')).toBeNull()
    expect(parseStarUpdateFeed('provider: generic\nurl: http://updates.example.com/star\n')).toBeNull()
    expect(parseStarUpdateFeed('')).toBeNull()
  })

  it('publishes to the feed only when STAR_UPDATE_URL is set at build time', () => {
    expect(starUpdateFeedFromEnv({})).toBeNull()
    expect(starUpdateFeedFromEnv({ STAR_UPDATE_URL: '   ' })).toBeNull()
    expect(starUpdatePublishArgs({})).toEqual([])
    expect(starUpdatePublishArgs({ STAR_UPDATE_URL: ' https://updates.example.com/star-agent/ ' })).toEqual([
      '-c.publish.provider=generic',
      '-c.publish.url=https://updates.example.com/star-agent/',
    ])
  })

  it('fails the build for an unusable feed without echoing it', () => {
    let message = ''
    try {
      starUpdatePublishArgs({ STAR_UPDATE_URL: 'http://updates.example.com/private-feed' })
    } catch (error) {
      message = error instanceof Error ? error.message : String(error)
    }
    expect(message).toContain('STAR_UPDATE_URL must be an https:// URL')
    expect(message).not.toContain('updates.example.com')
  })
})
