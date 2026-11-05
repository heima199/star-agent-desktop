import { describe, expect, test } from 'bun:test'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import sharp from 'sharp'
import { cropBoxFor, cropFrameToRatio, parseRatio } from './starFrameRatio.js'

describe('first-frame crop to the picked video ratio', () => {
  test('reads plain W:H ratios only', () => {
    expect(parseRatio('9:16')).toBeCloseTo(0.5625)
    expect(parseRatio('16:9')).toBeCloseTo(16 / 9)
    expect(parseRatio('adaptive')).toBeNull()
    expect(parseRatio(undefined)).toBeNull()
  })

  test('crops the long side around the center, and leaves a frame of the right shape', () => {
    // The production case: a 4:3 frame for a 9:16 clip.
    expect(cropBoxFor(2304, 1728, 9 / 16)).toEqual({ left: 666, top: 0, width: 972, height: 1728 })
    expect(cropBoxFor(1024, 1024, 16 / 9)).toEqual({ left: 0, top: 224, width: 1024, height: 576 })
    expect(cropBoxFor(1280, 720, 16 / 9)).toBeNull()
    expect(cropBoxFor(768, 1344, 9 / 16)).toBeNull()
  })

  test('returns a cropped PNG of the picked shape, and nothing when no crop is needed', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'star-frame-'))
    try {
      const file = path.join(dir, 'frame.png')
      writeFileSync(file, await sharp({ create: { width: 400, height: 300, channels: 3, background: { r: 200, g: 40, b: 40 } } }).png().toBuffer())
      const cropped = await cropFrameToRatio(file, '9:16')
      expect(cropped).not.toBeNull()
      const meta = await sharp(Buffer.from(cropped!.bytes)).metadata()
      expect(meta.format).toBe('png')
      expect(meta.height).toBe(300)
      expect(meta.width).toBe(169)
      expect(cropped!.name).toBe('frame-9x16.png')
      expect(await cropFrameToRatio(file, '4:3')).toBeNull()
      expect(await cropFrameToRatio(file, 'adaptive')).toBeNull()
      expect(await cropFrameToRatio(path.join(dir, 'missing.png'), '9:16')).toBeNull()
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
