import { afterEach, describe, expect, it } from 'vitest'
import type { StarStatus } from '../api/star'
import { formatStarBrand, normalizeStarBrandName, starBrandParams, starBrandProductName } from '../lib/starBrand'
import { getStarBrandName, useStarBrandStore } from './starBrandStore'
import { useStarStore } from './starStore'

const STATUS: StarStatus = {
  configured: true,
  baseUrl: 'https://star.example.test',
  signedIn: false,
  user: null,
  provider: { id: null, active: false, relayReady: false, mainModel: null },
  catalog: { fetchedAt: null, chatModels: 0, imageModels: 0, videoModels: 0 },
  starWorkSignInAvailable: false,
}

describe('STAR brand name', () => {
  afterEach(() => {
    useStarStore.setState({ status: null })
    useStarBrandStore.getState().setName('STAR')
  })

  it('normalizes like the server and STAR Code', () => {
    expect(normalizeStarBrandName('  PRIVO  ')).toBe('PRIVO')
    expect(normalizeStarBrandName('<i>PR\u0007IVO</i>')).toBe('i PR IVO /i')
    expect(normalizeStarBrandName('x'.repeat(30))).toHaveLength(24)
    for (const raw of ['', ' ', 'MaxClaw', 'maxclaw', undefined, null, 7]) expect(normalizeStarBrandName(raw)).toBe('STAR')
  })

  it('names the products without doubling', () => {
    // The desktop app is "X STAR WORK" since 1.2.0; the IDE stays "X Code"
    expect(starBrandProductName('PRIVO', 'Agent')).toBe('PRIVO STAR WORK')
    expect(starBrandProductName('PRIVO star work', 'Agent')).toBe('PRIVO star work')
    expect(starBrandProductName('STAR', 'Agent')).toBe('STAR WORK')
    expect(starBrandProductName('PRIVO STAR', 'Agent')).toBe('PRIVO STAR WORK')
    expect(starBrandProductName('PRIVO Code', 'Code')).toBe('PRIVO Code')
    expect(starBrandParams('PRIVO')).toEqual({ brand: 'PRIVO', brandAgent: 'PRIVO STAR WORK', brandCode: 'PRIVO Code' })
    expect(formatStarBrand('使用 {brandAgent} 的登录 · {0}', 'PRIVO')).toBe('使用 PRIVO STAR WORK 的登录 · {0}')
  })

  it('starts as STAR and keeps only normalized names', () => {
    expect(getStarBrandName()).toBe('STAR')
    useStarBrandStore.getState().setName(' PRIVO\n')
    expect(getStarBrandName()).toBe('PRIVO')
    useStarBrandStore.getState().setName('MaxClaw')
    expect(getStarBrandName()).toBe('STAR')
  })

  it('follows the name in every STAR status answer', () => {
    useStarStore.setState({ status: { ...STATUS, brandName: 'PRIVO' } })
    expect(getStarBrandName()).toBe('PRIVO')

    // A status from an older server without the field means STAR.
    useStarStore.setState({ status: { ...STATUS } })
    expect(getStarBrandName()).toBe('STAR')

    // Other store updates keep the name.
    useStarStore.setState({ status: { ...STATUS, brandName: 'PRIVO' } })
    useStarStore.setState({ loginOpen: true })
    expect(getStarBrandName()).toBe('PRIVO')
  })
})
