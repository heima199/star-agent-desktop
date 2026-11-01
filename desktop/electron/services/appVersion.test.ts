import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { resolveAppVersion } from './appVersion'

describe('resolveAppVersion', () => {
  const desktopRoot = path.join('/repo', 'desktop')

  it('trusts the packaged build metadata', () => {
    const readFile = () => { throw new Error('must not read package.json') }
    expect(resolveAppVersion({ isPackaged: true, appVersion: '1.0.0', appRoot: desktopRoot, readFile })).toBe('1.0.0')
  })

  it('reads desktop/package.json in development, where Electron reports its own version', () => {
    const files: string[] = []
    const readFile = (file: string) => {
      files.push(file)
      return JSON.stringify({ name: 'd', version: '1.0.0' })
    }
    expect(resolveAppVersion({ isPackaged: false, appVersion: '42.7.0', appRoot: desktopRoot, readFile })).toBe('1.0.0')
    expect(files).toEqual([path.join(desktopRoot, 'package.json')])
  })

  it('keeps Electron\'s answer when package.json is missing or has no version', () => {
    const missing = () => { throw Object.assign(new Error('missing'), { code: 'ENOENT' }) }
    expect(resolveAppVersion({ isPackaged: false, appVersion: '42.7.0', appRoot: desktopRoot, readFile: missing })).toBe('42.7.0')
    expect(resolveAppVersion({ isPackaged: false, appVersion: '42.7.0', appRoot: desktopRoot, readFile: () => '{"name":"d"}' })).toBe('42.7.0')
  })

  it('agrees with the real desktop/package.json', () => {
    const appRoot = path.join(__dirname, '..', '..')
    const expected = JSON.parse(readFileSync(path.join(appRoot, 'package.json'), 'utf8')).version
    expect(resolveAppVersion({ isPackaged: false, appVersion: '42.7.0', appRoot })).toBe(expected)
    expect(expected).not.toBe('42.7.0')
  })
})
