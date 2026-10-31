import { describe, expect, it, vi } from 'vitest'
import { acquireSingleInstanceLock, isSingleInstanceLockDisabled } from './singleInstance'

describe('Electron single-instance service', () => {
  it('is single-instance unless a validation run opts out with exactly 1', () => {
    expect(isSingleInstanceLockDisabled({})).toBe(false)
    expect(isSingleInstanceLockDisabled({ CC_HAHA_ELECTRON_DISABLE_SINGLE_INSTANCE_LOCK: '0' })).toBe(false)
    expect(isSingleInstanceLockDisabled({ CC_HAHA_ELECTRON_DISABLE_SINGLE_INSTANCE_LOCK: '1' })).toBe(true)
  })

  it('takes the lock for development runs too: nothing about packaging is consulted', () => {
    const app = {
      requestSingleInstanceLock: vi.fn(() => false),
      quit: vi.fn(),
      on: vi.fn(),
      isPackaged: false,
    }

    expect(acquireSingleInstanceLock(app as never, () => null, {})).toBe(false)
    expect(app.requestSingleInstanceLock).toHaveBeenCalledTimes(1)
    expect(app.quit).toHaveBeenCalledTimes(1)
  })

  it('allows validation runs to bypass the single-instance lock explicitly', () => {
    const app = {
      requestSingleInstanceLock: vi.fn(() => false),
      quit: vi.fn(),
      on: vi.fn(),
    }

    expect(acquireSingleInstanceLock(app as never, () => null, {
      CC_HAHA_ELECTRON_DISABLE_SINGLE_INSTANCE_LOCK: '1',
    })).toBe(true)
    expect(app.requestSingleInstanceLock).not.toHaveBeenCalled()
    expect(app.quit).not.toHaveBeenCalled()
    expect(app.on).not.toHaveBeenCalled()
  })

  it('quits duplicate launches when the lock cannot be acquired', () => {
    const app = {
      requestSingleInstanceLock: vi.fn(() => false),
      quit: vi.fn(),
      on: vi.fn(),
    }

    expect(acquireSingleInstanceLock(app as never, () => null)).toBe(false)
    expect(app.quit).toHaveBeenCalledTimes(1)
    expect(app.on).not.toHaveBeenCalled()
  })

  it('registers a second-instance focus handler after acquiring the lock', () => {
    let secondInstanceHandler: (() => void) | undefined
    const window = {
      isVisible: () => false,
      isMinimized: () => false,
      show: vi.fn(),
      restore: vi.fn(),
      focus: vi.fn(),
    }
    const app = {
      requestSingleInstanceLock: vi.fn(() => true),
      quit: vi.fn(),
      show: vi.fn(),
      on: vi.fn((_event: string, handler: () => void) => {
        secondInstanceHandler = handler
      }),
    }

    expect(acquireSingleInstanceLock(app as never, () => window as never)).toBe(true)
    expect(app.on).toHaveBeenCalledWith('second-instance', expect.any(Function))

    secondInstanceHandler?.()
    expect(app.show).toHaveBeenCalledTimes(1)
    expect(window.show).toHaveBeenCalledTimes(1)
    expect(window.focus).toHaveBeenCalledTimes(1)
  })
})
