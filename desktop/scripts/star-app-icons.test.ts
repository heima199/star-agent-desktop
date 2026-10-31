import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { inflateSync } from 'node:zlib'
import { describe, expect, it } from 'vitest'

// The app icons (exe, installer and shortcuts via icon.ico, tray via icon.png,
// Linux NxN.png, macOS icon.icns, favicon and default avatar via
// public/app-icon.*) are the STAR logo, not the fork's old "CC" mark: the
// white glass star on a black rounded tile. 桌面打包logo用download (2).png:
// they are scaled down from that finished image (1280×1320, made square with
// transparent side margins); below 48px the star is brightened, so it still
// reads in the tray and the taskbar. One image per size: the ICO, the icns,
// @2x and public/app-icon.* carry the PNGs' exact bytes.

const desktopRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const iconsDir = path.join(desktopRoot, 'src-tauri', 'icons')
const read = (...parts: string[]) => readFileSync(path.join(desktopRoot, ...parts))
const icon = (name: string) => read('src-tauri', 'icons', name)
const logo = icon('256x256.png')

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

function pngSize(png: Buffer): { width: number; height: number } {
  expect(png.subarray(0, 8).equals(PNG_SIGNATURE)).toBe(true)
  return { width: png.readUInt32BE(16), height: png.readUInt32BE(20) }
}

/** The pixels of an 8-bit RGBA, non-interlaced PNG (what the icon renderer writes). */
function pngPixels(png: Buffer): { width: number; height: number; data: Uint8Array } {
  const { width, height } = pngSize(png)
  expect([png[24], png[25], png[28]]).toEqual([8, 6, 0])
  const idat: Buffer[] = []
  for (let offset = 8; offset < png.length;) {
    const length = png.readUInt32BE(offset)
    if (png.toString('ascii', offset + 4, offset + 8) === 'IDAT') idat.push(png.subarray(offset + 8, offset + 8 + length))
    offset += 12 + length
  }
  const raw = inflateSync(Buffer.concat(idat))
  const stride = width * 4
  const data = new Uint8Array(stride * height)
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)]!
    for (let x = 0; x < stride; x++) {
      const left = x >= 4 ? data[y * stride + x - 4]! : 0
      const up = y > 0 ? data[(y - 1) * stride + x]! : 0
      const upLeft = x >= 4 && y > 0 ? data[(y - 1) * stride + x - 4]! : 0
      let value = raw[y * (stride + 1) + 1 + x]!
      if (filter === 1) value += left
      else if (filter === 2) value += up
      else if (filter === 3) value += (left + up) >> 1
      else if (filter === 4) {
        const estimate = left + up - upLeft
        const [toLeft, toUp, toUpLeft] = [left, up, upLeft].map(near => Math.abs(estimate - near))
        value += toLeft! <= toUp! && toLeft! <= toUpLeft! ? left : toUp! <= toUpLeft! ? up : upLeft
      }
      data[y * stride + x] = value & 0xff
    }
  }
  return { width, height, data }
}
/** The images of a Windows ICO: size (0 in the directory means 256) and bytes. */
function icoEntries(ico: Buffer): { size: number; data: Buffer }[] {
  expect(ico.readUInt16LE(0)).toBe(0)
  expect(ico.readUInt16LE(2)).toBe(1)
  const count = ico.readUInt16LE(4)
  return Array.from({ length: count }, (_, index) => {
    const entry = 6 + 16 * index
    const length = ico.readUInt32LE(entry + 8)
    const offset = ico.readUInt32LE(entry + 12)
    return { size: ico[entry] || 256, data: ico.subarray(offset, offset + length) }
  })
}

/** The entries of a macOS icns: OSType and data. */
function icnsEntries(icns: Buffer): Map<string, Buffer> {
  expect(icns.toString('ascii', 0, 4)).toBe('icns')
  expect(icns.readUInt32BE(4)).toBe(icns.length)
  const entries = new Map<string, Buffer>()
  for (let offset = 8; offset < icns.length;) {
    const length = icns.readUInt32BE(offset + 4)
    entries.set(icns.toString('ascii', offset, offset + 4), icns.subarray(offset + 8, offset + length))
    offset += length
  }
  return entries
}

describe('STAR Agent app icons', () => {
  // exe / 安装包 / 托盘 / 网页图标：黑色圆角底上的白色玻璃星，吉祥物不再当 logo。
  /** Share of the image that is opaque and light: the white star. */
  const lightShare = (png: Buffer) => {
    const { width, height, data } = pngPixels(png)
    let light = 0
    for (let index = 0; index < width * height; index += 1) {
      const [red, green, blue, alpha] = data.subarray(index * 4, index * 4 + 4)
      if (alpha === 255 && (red! + green! + blue!) / 3 > 128) light += 1
    }
    return light / (width * height)
  }

  it('is the white glass star on a black rounded tile', () => {
    for (const png of [logo, icon('512x512.png')]) {
      const { width, data } = pngPixels(png)
      const pixel = (x: number, y: number) => Array.from(data.subarray((y * width + x) * 4, (y * width + x) * 4 + 4))
      // Transparent corners (rounded tile), a black edge, the star across the middle.
      expect(pixel(0, 0)[3]).toBe(0)
      expect(pixel(width / 2, Math.round(width * 0.08))).toEqual([0, 0, 0, 255])
      expect(pixel(width / 2, width / 2)[3]).toBe(255)
      // Its facets are dark glass, so look for its light edges anywhere in the central third.
      let lightInMiddle = 0
      for (let y = Math.floor(width / 3); y < Math.ceil((width * 2) / 3); y += 1) {
        for (let x = Math.floor(width / 3); x < Math.ceil((width * 2) / 3); x += 1) {
          const [red, green, blue, alpha] = pixel(x, y)
          if (alpha === 255 && (red! + green! + blue!) / 3 > 128) lightInMiddle += 1
        }
      }
      expect(lightInMiddle).toBeGreaterThan(0)
      // A thin star lights about 2% of the tile; the cloud mascot it replaced lit 36%.
      expect(lightShare(png)).toBeGreaterThan(0.01)
      expect(lightShare(png)).toBeLessThan(0.15)
    }
  })

  it('draws a bolder star below 48px, so it still reads in the tray and taskbar', () => {
    for (const name of ['32x32.png', 'Square30x30Logo.png', 'Square44x44Logo.png']) {
      expect(lightShare(icon(name)), name).toBeGreaterThan(lightShare(logo) * 3)
    }
    expect(pngPixels(icon('32x32.png')).data[3]).toBe(0)
  })

  it('uses one image per size for the NxN, @2x and app icons', () => {
    expect(pngSize(logo)).toEqual({ width: 256, height: 256 })
    expect(icon('128x128@2x.png').equals(logo)).toBe(true)
    expect(icon('icon.png').equals(icon('512x512.png'))).toBe(true)
  })

  it('puts the icons into the Windows ICO with every size Explorer and the taskbar ask for', () => {
    const entries = icoEntries(icon('icon.ico'))
    expect(entries.map(entry => entry.size)).toEqual([16, 24, 32, 48, 64, 128, 256])
    for (const entry of entries) expect(pngSize(entry.data)).toEqual({ width: entry.size, height: entry.size })
    for (const size of [32, 64, 128, 256]) {
      expect(entries.find(entry => entry.size === size)!.data.equals(icon(`${size}x${size}.png`)), `${size}px`).toBe(true)
    }
    // The small entries carry the bold star too.
    expect(lightShare(entries[0]!.data)).toBeGreaterThan(lightShare(logo) * 3)
  })

  it('puts the icons into the macOS icns from 32 to 1024px', () => {
    const entries = icnsEntries(icon('icon.icns'))
    expect([...entries.keys()].sort()).toEqual(['ic07', 'ic08', 'ic09', 'ic10', 'ic11', 'ic12', 'ic13', 'ic14'])
    const expected: Record<string, string> = {
      ic11: '32x32.png', ic12: '64x64.png', ic07: '128x128.png', ic13: '256x256.png', ic08: '256x256.png', ic14: '512x512.png', ic09: '512x512.png',
    }
    for (const [type, name] of Object.entries(expected)) expect(entries.get(type)!.equals(icon(name)), type).toBe(true)
    expect(pngSize(entries.get('ic10')!)).toEqual({ width: 1024, height: 1024 })
  })

  it('gives every PNG icon the size its name says', () => {
    const expected = (name: string): number | undefined => {
      if (name === 'icon.png') return 512
      if (name === 'StoreLogo.png') return 50
      const match = /^(?:Square)?(\d+)x\1(@2x)?(?:Logo)?\.png$/.exec(name)
      return match ? Number(match[1]) * (match[2] ? 2 : 1) : undefined
    }
    const pngs = readdirSync(iconsDir).filter(name => name.endsWith('.png'))
    // NxN for Linux and the tray, @2x, and the Windows Store tiles
    expect(pngs.length).toBeGreaterThanOrEqual(17)
    for (const name of pngs) {
      const size = expected(name)
      expect(size, name).toBeDefined()
      expect(pngSize(readFileSync(path.join(iconsDir, name))), name).toEqual({ width: size, height: size })
    }
  })

  it('shows the logo as the favicon and default avatar, also in the SVG', () => {
    expect(pngSize(read('public', 'app-icon.png'))).toEqual({ width: 512, height: 512 })
    expect(read('public', 'app-icon.png').equals(icon('512x512.png'))).toBe(true)
    const svg = read('public', 'app-icon.svg').toString('utf8')
    const embedded = /data:image\/png;base64,([A-Za-z0-9+/=]+)/.exec(svg)?.[1]
    expect(embedded).toBeDefined()
    expect(Buffer.from(embedded!, 'base64').equals(logo)).toBe(true)
  })
})
