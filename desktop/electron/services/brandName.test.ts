import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { tmpdir } from 'node:os'
import { describe, expect, it, vi } from 'vitest'
import {
  brandAgentName,
  brandNameFile,
  brandNotificationText,
  brandWindowTitle,
  readBrandName,
  watchBrandName,
} from './brandName'
import { sendDesktopNotification, type ElectronNotificationConstructor } from './notifications'

// 「star需要跟随后台设置的名称来展示」: the tray, the window title and desktop
// notifications use the name the local server caches in brand.json.
describe('Electron brand name', () => {
  it('reads brand.json next to the STAR session', () => {
    expect(brandNameFile({ CLAUDE_CONFIG_DIR: '/cfg' }, '/home/u')).toBe(path.join('/cfg', 'cc-haha', 'star', 'brand.json'))
    expect(brandNameFile({}, '/home/u')).toBe(path.join('/home/u', '.claude', 'cc-haha', 'star', 'brand.json'))
  })

  it('normalizes the cached name and falls back to STAR', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'electron-brand-'))
    try {
      const file = path.join(root, 'cc-haha', 'star', 'brand.json')
      expect(readBrandName(file)).toBe('STAR')
      mkdirSync(path.dirname(file), { recursive: true })
      writeFileSync(file, JSON.stringify({ name: '  <PRIVO>  ', updatedAt: 1 }))
      expect(readBrandName(file)).toBe('PRIVO')
      writeFileSync(file, JSON.stringify({ name: 'MaxClaw' }))
      expect(readBrandName(file)).toBe('STAR')
      writeFileSync(file, '{ broken')
      expect(readBrandName(file)).toBe('STAR')
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('names the tray product and the window', () => {
    expect(brandAgentName('PRIVO')).toBe('PRIVO STAR WORK')
    expect(brandAgentName('PRIVO STAR WORK')).toBe('PRIVO STAR WORK')
    expect(brandWindowTitle('PRIVO')).toBe('PRIVO')
    expect(brandWindowTitle(' ')).toBe('STAR')
  })

  it('never repeats words the console name already ends with', () => {
    // No name set in the console: "STAR WORK", not "STAR STAR WORK"
    expect(brandAgentName('STAR')).toBe('STAR WORK')
    expect(brandAgentName(' ')).toBe('STAR WORK')
    expect(brandAgentName('PRIVO STAR')).toBe('PRIVO STAR WORK')
    expect(brandAgentName('privo star work')).toBe('privo star work')
    // "STAR" inside a word is not an overlap
    expect(brandAgentName('SUPERSTAR')).toBe('SUPERSTAR STAR WORK')
  })

  it('renames the brand word in notification texts, not identifiers', () => {
    expect(brandNotificationText('STAR 需要你的确认', 'PRIVO')).toBe('PRIVO 需要你的确认')
    expect(brandNotificationText('{brandAgent} 已完成回复', 'PRIVO')).toBe('PRIVO STAR WORK 已完成回复')
    expect(brandNotificationText('{brandCode} 已打开', 'PRIVO')).toBe('PRIVO Code 已打开')
    expect(brandNotificationText('STAR-DEBUG STAR_X star', 'PRIVO')).toBe('STAR-DEBUG STAR_X star')
    expect(brandNotificationText('STAR 通知已启用', 'STAR')).toBe('STAR 通知已启用')
  })

  it('follows brand.json changes and reports only real changes', () => {
    let content = JSON.stringify({ name: 'STAR' })
    let poll: (() => void) | undefined
    const unwatch = vi.fn()
    const onChange = vi.fn()
    const source = watchBrandName({
      file: '/cfg/brand.json',
      onChange,
      read: () => content,
      watch: (_file, options, listener) => {
        expect(options.persistent).toBe(false)
        poll = listener
      },
      unwatch,
    })
    expect(source.current()).toBe('STAR')

    content = JSON.stringify({ name: 'PRIVO' })
    poll?.()
    expect(onChange).toHaveBeenCalledWith('PRIVO')
    expect(source.current()).toBe('PRIVO')

    // Window focus reads again; the same name is no change.
    source.refresh()
    expect(onChange).toHaveBeenCalledTimes(1)

    source.dispose()
    expect(unwatch).toHaveBeenCalledWith('/cfg/brand.json', expect.any(Function))
  })

  it('shows notifications with the console name', () => {
    const created: Array<{ title: string, body?: string }> = []
    class FakeNotification {
      constructor(options: { title: string, body?: string }) {
        created.push(options)
      }
      static isSupported() {
        return true
      }
      show() {}
      on() {
        return this
      }
    }
    const NotificationClass = FakeNotification as unknown as ElectronNotificationConstructor
    sendDesktopNotification({
      NotificationClass,
      options: { title: 'STAR 需要你的确认', body: '{brand} 正在等待允许。' },
      onAction: () => {},
      brandName: 'PRIVO',
    })
    sendDesktopNotification({ NotificationClass, options: { title: 'STAR 已完成回复' }, onAction: () => {} })
    expect(created).toEqual([
      { title: 'PRIVO 需要你的确认', body: 'PRIVO 正在等待允许。', icon: undefined },
      { title: 'STAR 已完成回复', body: undefined, icon: undefined },
    ])
  })
})
