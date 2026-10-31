import { describe, expect, it } from 'vitest'
import type { StarUpdateInfo } from '../api/star'
import { translate, type TranslationKey } from '../i18n'
import {
  compareVersions,
  shouldAnnounceStarUpdate,
  starReleaseNotesText,
  starUpdateStatusText as statusText,
  type StarUpdateCheck,
} from './starUpdate'

const t = (key: TranslationKey, params?: Record<string, string | number>) => translate('zh', key, params)
const starUpdateStatusText = (check: StarUpdateCheck | null, failed: boolean) => statusText(check, failed, t)

const release = (overrides: Partial<StarUpdateInfo> = {}): StarUpdateInfo => ({
  version: '0.2.0',
  downloadUrl: 'https://star.example.com/download/0.2.0',
  releaseNotes: '',
  mandatory: false,
  publishedAt: null,
  ...overrides,
})

const check = (hasUpdate: boolean, latest = release()): StarUpdateCheck => ({ current: '0.1.0', latest, hasUpdate })

describe('starUpdateStatusText', () => {
  it('reads calm when the check failed, whatever an earlier check found', () => {
    expect(starUpdateStatusText(null, true)).toBe('暂未开放在线更新')
    expect(starUpdateStatusText(check(false), true)).toBe('暂未开放在线更新')
  })

  it('reports a current build and a newer release', () => {
    expect(starUpdateStatusText(null, false)).toBe('')
    expect(starUpdateStatusText(check(false), false)).toBe('当前已是最新版本')
    expect(starUpdateStatusText(check(true), false)).toBe('发现新版本 0.2.0')
    expect(starUpdateStatusText(check(true, release({ version: 'v0.2.0' })), false)).toBe('发现新版本 0.2.0')
    expect(starUpdateStatusText(check(true, release({ mandatory: true })), false)).toBe('发现新版本 0.2.0（需要更新）')
  })

  it('follows the interface language', () => {
    expect(statusText(check(true), false, (key, params) => translate('en', key, params))).toBe('New version 0.2.0 available')
  })
})

describe('compareVersions', () => {
  it('compares dotted versions numerically', () => {
    expect(compareVersions('1.10.0', '1.9.3')).toBe(1)
    expect(compareVersions('v0.7.5', '0.7.5')).toBe(0)
    expect(compareVersions('0.7.4', '0.7.5')).toBe(-1)
  })

  it('matches the backend: missing segments are 0 and a pre-release is lower', () => {
    expect(compareVersions('1.2', '1.2.0')).toBe(0)
    expect(compareVersions('1.0.0-beta', '1.0.0')).toBe(-1)
    expect(compareVersions('1.0.0', '1.0.0-beta')).toBe(1)
    expect(compareVersions('1.0.1-beta', '1.0.0')).toBe(1)
    expect(compareVersions('1.0.0-beta.2', '1.0.0-beta.1')).toBe(1)
    expect(compareVersions('1.0.0', '1.0.0')).toBe(0)
  })
})

describe('starReleaseNotesText', () => {
  it('turns rich text into plain lines', () => {
    expect(starReleaseNotesText('<p>修复登录&amp;同步</p><ul><li>更快</li><li>更稳</li></ul>')).toBe('修复登录&同步\n• 更快\n• 更稳')
    expect(starReleaseNotesText('第一行\r\n\r\n\r\n第二行')).toBe('第一行\n\n第二行')
  })

  it('caps very long notes', () => {
    expect(starReleaseNotesText('长'.repeat(20), 10)).toBe(`${'长'.repeat(10)}…`)
  })
})

describe('shouldAnnounceStarUpdate', () => {
  const none = new Set<string>()

  it('announces a newer optional release until it was put off', () => {
    expect(shouldAnnounceStarUpdate(check(true), { dismissedVersion: '', handledThisRun: none })).toBe(true)
    expect(shouldAnnounceStarUpdate(check(true), { dismissedVersion: '0.2.0', handledThisRun: none })).toBe(false)
    expect(shouldAnnounceStarUpdate(check(false), { dismissedVersion: '', handledThisRun: none })).toBe(false)
  })

  it('announces a mandatory release on every start, once per run', () => {
    const mandatory = check(true, release({ mandatory: true }))
    expect(shouldAnnounceStarUpdate(mandatory, { dismissedVersion: '0.2.0', handledThisRun: none })).toBe(true)
    expect(shouldAnnounceStarUpdate(mandatory, { dismissedVersion: '0.2.0', handledThisRun: new Set(['0.2.0']) })).toBe(false)
  })
})
