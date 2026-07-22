// Cover for lib/units — display conversion for a codebase that stores lbs and
// shows whatever the user picked.
//
// compactVolume (2026-07-22) exists because the profile's Volume stat tile had
// two real bugs at once: it rendered `stats.totalVolume`, a raw lbs string, so a
// kg user saw lbs on Profile and correctly-converted kg on Progress — two
// different numbers for the same metric, and the Profile one carried no unit
// label. It also used toLocaleString() inside a tile that is ~72pt wide on a
// 375pt phone at 25pt type with numberOfLines={1}, so lifetime volume truncated
// exactly for the users who had trained the most.

import { compactVolume, displayVolume, unitLabel, formatWeight } from '@/lib/units'

// The tile renders at ~25pt in ~72pt of content. Inter digits run ~0.55em, so
// roughly 6 glyphs fit. Anything longer truncates mid-number.
const MAX_TILE_GLYPHS = 6

describe('compactVolume', () => {
  it('leaves small totals readable and exact', () => {
    expect(compactVolume(0, 'lb')).toBe('0')
    expect(compactVolume(1320, 'lb')).toBe('1,320')
    expect(compactVolume(9999, 'lb')).toBe('9,999')
  })

  it('abbreviates thousands', () => {
    expect(compactVolume(10_000, 'lb')).toBe('10k')
    expect(compactVolume(124_500, 'lb')).toBe('125k')
    expect(compactVolume(999_000, 'lb')).toBe('999k')
  })

  it('abbreviates millions, with a decimal only while it fits', () => {
    expect(compactVolume(1_284_500, 'lb')).toBe('1.3M')
    expect(compactVolume(12_800_000, 'lb')).toBe('13M')
  })

  it('converts to kg — the bug that made Profile disagree with Progress', () => {
    const lbs = 100_000
    expect(compactVolume(lbs, 'kg')).not.toBe(compactVolume(lbs, 'lb'))
    // 100,000 lb is ~45,359 kg -> "45k"
    expect(compactVolume(lbs, 'kg')).toBe('45k')
  })

  it('never exceeds what the tile can actually show, at any tenure or unit', () => {
    // Walk a plausible lifetime, from first session to a decade of heavy training.
    const totals = [0, 500, 9_999, 10_000, 87_400, 999_999, 1_000_000, 9_400_000, 88_000_000]
    for (const t of totals) {
      for (const unit of ['lb', 'kg'] as const) {
        expect(compactVolume(t, unit).length).toBeLessThanOrEqual(MAX_TILE_GLYPHS)
      }
    }
  })
})

describe('displayVolume — unchanged, still exact where there is room', () => {
  it('keeps full precision for the Progress tab', () => {
    expect(displayVolume(1_284_500, 'lb')).toBe((1_284_500).toLocaleString())
  })

  it('converts to kg', () => {
    expect(displayVolume(100_000, 'kg')).toBe((45_359).toLocaleString())
  })
})

describe('unitLabel / formatWeight', () => {
  it('labels each unit', () => {
    expect(unitLabel('lb')).toBe('lbs')
    expect(unitLabel('kg')).toBe('kg')
  })

  it('formats a weight with its unit', () => {
    expect(formatWeight(100, 'lb')).toBe('100 lbs')
    expect(formatWeight(0, 'lb')).toBe('0 lbs')
  })
})
