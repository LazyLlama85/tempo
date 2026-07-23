import { computePRForecast, type PRForecastPoint } from '@/lib/prForecast'

const day = (n: number): Date => new Date(2026, 0, 1 + n)

// A clean, noise-free upward trend: +2 lbs e1RM every 7 days, starting at 205.
function risingTrend(sessions: number): PRForecastPoint[] {
  return Array.from({ length: sessions }, (_, i) => ({ date: day(i * 7), e1rm: 205 + i * 2 }))
}

describe('computePRForecast — honest per-lift foresight', () => {
  it('returns null with fewer than 4 sessions — two good days is not a trend', () => {
    expect(computePRForecast(risingTrend(3))).toBeNull()
  })

  it('returns null when the whole history spans under 14 days', () => {
    const points: PRForecastPoint[] = [
      { date: day(0), e1rm: 200 }, { date: day(2), e1rm: 202 },
      { date: day(4), e1rm: 204 }, { date: day(6), e1rm: 206 },
    ]
    expect(computePRForecast(points)).toBeNull()
  })

  it('returns null on a flat trend — no fabricated ETA for a plateau', () => {
    const points: PRForecastPoint[] = Array.from({ length: 5 }, (_, i) => ({ date: day(i * 10), e1rm: 205 }))
    expect(computePRForecast(points)).toBeNull()
  })

  it('returns null on a declining trend', () => {
    const points: PRForecastPoint[] = Array.from({ length: 5 }, (_, i) => ({ date: day(i * 10), e1rm: 220 - i * 3 }))
    expect(computePRForecast(points)).toBeNull()
  })

  it('projects the next round milestone on a real upward trend, with a future date', () => {
    const now = day(1000) // well after the trend's last point
    const f = computePRForecast(risingTrend(6), now)
    expect(f).not.toBeNull()
    // 6 points, +2 lbs/week to 215 at the last point → next milestone 225.
    expect(f?.targetLbs).toBe(225)
    expect(f?.ratePerWeek).toBeCloseTo(2, 0)
    expect(f?.projectedDate.getTime()).toBeGreaterThan(now.getTime())
    expect(f?.projectedDateLabel).toMatch(/\w+ \d+/) // "March 15"-shaped
  })

  it('returns null when the projection is more than a year out — not useful foresight', () => {
    // Extremely slow trend: +0.05 lbs/week over a long enough window to pass
    // the earlier guards, but the milestone is decades away at that rate.
    const points: PRForecastPoint[] = Array.from({ length: 6 }, (_, i) => ({
      date: day(i * 30), e1rm: 200 + i * 0.06,
    }))
    expect(computePRForecast(points)).toBeNull()
  })

  it('returns null when every point falls on the same day (no slope to fit)', () => {
    const points: PRForecastPoint[] = Array.from({ length: 4 }, (_, i) => ({ date: day(5), e1rm: 200 + i }))
    expect(computePRForecast(points)).toBeNull()
  })

  it('is order-independent — unsorted input fits the same trend', () => {
    const sorted = risingTrend(6)
    const shuffled = [sorted[3], sorted[0], sorted[5], sorted[1], sorted[4], sorted[2]]
    const now = day(1000)
    expect(computePRForecast(shuffled, now)?.targetLbs).toBe(computePRForecast(sorted, now)?.targetLbs)
  })
})
