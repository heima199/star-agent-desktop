import { describe, expect, it } from 'vitest'

import { policyOffersProvider } from './modelPolicy'

describe('policyOffersProvider', () => {
  it('offers every provider when any model service may be used', () => {
    expect(policyOffersProvider('any', null, null)).toBe(true)
    expect(policyOffersProvider('any', 'own-api', 'star')).toBe(true)
  })

  it('offers the STAR provider alone under the star-only policy', () => {
    expect(policyOffersProvider('star-only', 'star', 'star')).toBe(true)
    expect(policyOffersProvider('star-only', 'own-api', 'star')).toBe(false)
    expect(policyOffersProvider('star-only', null, 'star')).toBe(false)
  })

  it('offers nothing before a STAR provider exists, Claude official included', () => {
    // Both are `null` here: the official provider by convention, the STAR one
    // because nobody has signed in.
    expect(policyOffersProvider('star-only', null, null)).toBe(false)
    expect(policyOffersProvider('star-only', 'own-api', null)).toBe(false)
  })
})
