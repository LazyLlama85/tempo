import { historyCutoffDate, historyCutoffIso, FREE_HISTORY_MONTHS } from '@/lib/historyHorizon'

describe('historyHorizon — free tier 4-month cutoff', () => {
  it('FREE_HISTORY_MONTHS is 4, matching the founder-specified promise', () => {
    expect(FREE_HISTORY_MONTHS).toBe(4)
  })

  it('historyCutoffDate subtracts exactly 4 calendar months, not a fixed day count', () => {
    const now = new Date(2026, 7, 2) // Aug 2, 2026 (month is 0-indexed)
    const cutoff = historyCutoffDate(now)
    expect(cutoff.getFullYear()).toBe(2026)
    expect(cutoff.getMonth()).toBe(3) // April (0-indexed) — 4 months before August
    expect(cutoff.getDate()).toBe(2)
  })

  it('handles a year rollover correctly', () => {
    const now = new Date(2026, 1, 15) // Feb 15, 2026
    const cutoff = historyCutoffDate(now)
    expect(cutoff.getFullYear()).toBe(2025)
    expect(cutoff.getMonth()).toBe(9) // October (0-indexed) 2025
    expect(cutoff.getDate()).toBe(15)
  })

  it('historyCutoffIso returns a valid ISO string matching historyCutoffDate', () => {
    const now = new Date(2026, 7, 2)
    expect(historyCutoffIso(now)).toBe(historyCutoffDate(now).toISOString())
  })
})
