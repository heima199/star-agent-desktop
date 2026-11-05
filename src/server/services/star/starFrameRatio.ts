/**
 * Crops a video's first / last frame to the picked picture ratio before it is
 * uploaded.
 *
 * The console sizes an image-to-video clip by its first frame: for several
 * routes (sd-2 through meai, Veo, Grok, the new-api gateway) it replaces the
 * requested ratio with the frame's own, and Seedance 2 / MiniMax follow the
 * frame as well. In production (2026-11-03) a 9:16 job with a 4:3 first frame
 * came back 1280x720. A frame that already has the picked shape is left as it
 * is, so cropping the frame is what makes the picked ratio hold.
 */

import { getImageProcessor } from '../../../tools/FileReadTool/imageProcessor.js'
import { readStarReference } from './starMediaRefs.js'

/** "9:16" → 0.5625, or null for anything that is not a plain W:H ratio. */
export function parseRatio(value: string | undefined): number | null {
  const match = /^(\d{1,2}):(\d{1,2})$/.exec(value?.trim() ?? '')
  if (!match) return null
  const width = Number(match[1])
  const height = Number(match[2])
  return width > 0 && height > 0 ? width / height : null
}

/** Centered crop box of `width`x`height` with the target ratio, or null when it already has it (within 2%). */
export function cropBoxFor(width: number, height: number, target: number): { left: number; top: number; width: number; height: number } | null {
  if (!(width > 0 && height > 0 && target > 0)) return null
  const current = width / height
  if (Math.abs(Math.log(current / target)) < Math.log(1.02)) return null
  if (current > target) {
    const cropWidth = Math.max(1, Math.round(height * target))
    return { left: Math.floor((width - cropWidth) / 2), top: 0, width: cropWidth, height }
  }
  const cropHeight = Math.max(1, Math.round(width / target))
  return { left: 0, top: Math.floor((height - cropHeight) / 2), width, height: cropHeight }
}

type CropInstance = {
  metadata(): Promise<{ width?: number; height?: number }>
  rotate(): CropInstance
  extract(box: { left: number; top: number; width: number; height: number }): CropInstance
  png(): CropInstance
  toBuffer(): Promise<Buffer>
}

/**
 * The frame as PNG bytes cropped to `ratio`, or null when it needs no crop
 * (no plain ratio picked, the frame has it already, or it cannot be read).
 * A frame that cannot be cropped is sent as it is, as before.
 */
export async function cropFrameToRatio(
  raw: string,
  ratio: string | undefined,
  options: { cwd?: string } = {},
): Promise<{ bytes: Uint8Array; name: string } | null> {
  const target = parseRatio(ratio)
  if (!target) return null
  try {
    const { bytes, name } = await readStarReference(raw, 'image', options.cwd)
    const sharp = (await getImageProcessor({ requireAutoOrient: true })) as unknown as (input: Buffer) => CropInstance
    // rotate() applies the EXIF orientation first, so the box is taken from
    // the picture as it is shown.
    const upright = await sharp(Buffer.from(bytes)).rotate().png().toBuffer()
    const meta = await sharp(upright).metadata()
    const box = cropBoxFor(meta.width ?? 0, meta.height ?? 0, target)
    if (!box) return null
    const cropped = await sharp(upright).extract(box).png().toBuffer()
    const base = name.replace(/\.[a-z0-9]+$/i, '') || 'frame'
    return { bytes: new Uint8Array(cropped), name: `${base}-${ratio!.replace(':', 'x')}.png` }
  } catch {
    return null
  }
}
