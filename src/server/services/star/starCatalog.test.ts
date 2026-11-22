import { afterEach, describe, expect, test } from 'bun:test'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'

import { STAR_CATALOG_VERSION, flattenStarCatalog, readStarCatalog } from './starCatalog.js'

describe('a media model with several channels', () => {
  // The console's lists on 2026-11-22: one entry per channel, highest priority first.
  const image = [
    { id: 'gpt-image-2', label: 'GPT Image 2', pricePerImage: 10 },
    { id: 'gemini-3.1-flash-image', label: 'Gemini 3.1 Flash Image', pricePerImage: 3 },
    { id: 'gpt-image-2', label: 'GPT Image 2', pricePerImage: 4 },
  ]
  const video = [
    { id: 'MiniMax-H3', label: 'MiniMax H3', pricePerGeneration: 10 },
    { id: 'MiniMax-H3', label: 'MiniMax H3', pricePerGeneration: 6 },
  ]
  const configDir = process.env.CLAUDE_CONFIG_DIR
  let tempDir: string | null = null

  afterEach(() => {
    if (configDir === undefined) delete process.env.CLAUDE_CONFIG_DIR
    else process.env.CLAUDE_CONFIG_DIR = configDir
    if (tempDir) fs.rmSync(tempDir, { recursive: true, force: true })
    tempDir = null
  })

  test('is listed once, at the price of its first entry', () => {
    const catalog = flattenStarCatalog([], { media: { image: { list: image }, video: { list: video } } })
    expect(catalog.image.map(model => [model.id, model.pricePerImage])).toEqual([['gpt-image-2', 10], ['gemini-3.1-flash-image', 3]])
    expect(catalog.video.map(model => [model.id, model.pricePerGeneration])).toEqual([['MiniMax-H3', 10]])
  })

  test('is listed once from a cache file written with every entry', () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'star-catalog-'))
    process.env.CLAUDE_CONFIG_DIR = tempDir
    const starDir = path.join(tempDir, 'cc-haha', 'star')
    fs.mkdirSync(starDir, { recursive: true })
    fs.writeFileSync(path.join(starDir, 'catalog.json'), JSON.stringify({
      version: STAR_CATALOG_VERSION, fetchedAt: Date.now(), brands: [], chat: [], image, video,
      videoLimits: { maxReferenceImages: 3, maxReferenceVideos: 0, mediaTypes: [] },
    }))
    const catalog = readStarCatalog()
    expect(catalog?.image.map(model => [model.id, model.pricePerImage])).toEqual([['gpt-image-2', 10], ['gemini-3.1-flash-image', 3]])
    expect(catalog?.video.map(model => [model.id, model.pricePerGeneration])).toEqual([['MiniMax-H3', 10]])
  })
})
