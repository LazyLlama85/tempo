import { calculatePlates, defaultBarWeight } from '@/lib/plateCalc'

describe('calculatePlates', () => {
  it('225 lbs on a 45 lb bar is two 45s per side, exact', () => {
    const r = calculatePlates(225, 45, 'lb')
    expect(r.perSide).toEqual([45, 45])
    expect(r.total).toBe(225)
    expect(r.exact).toBe(true)
  })

  it('235 lbs fills down to smaller plates when the big ones overshoot', () => {
    const r = calculatePlates(235, 45, 'lb')
    expect(r.perSide).toEqual([45, 45, 5])
    expect(r.total).toBe(235)
    expect(r.exact).toBe(true)
  })

  it('reports inexact when the target cannot be hit with standard plates', () => {
    const r = calculatePlates(227, 45, 'lb')
    expect(r.exact).toBe(false)
    expect(r.total).toBe(225)
    expect(r.remainder).toBeCloseTo(1)
  })

  it('a target at or below the bar weight needs nothing per side', () => {
    const r = calculatePlates(45, 45, 'lb')
    expect(r.perSide).toEqual([])
    expect(r.exact).toBe(true)
    const under = calculatePlates(30, 45, 'lb')
    expect(under.perSide).toEqual([])
    expect(under.total).toBe(45)
  })

  it('works in kg with the kg plate set (greedy largest-first)', () => {
    const r = calculatePlates(100, 20, 'kg')
    expect(r.perSide).toEqual([25, 15])
    expect(r.total).toBe(100)
    expect(r.exact).toBe(true)
  })

  it('defaultBarWeight matches the standard bar for each unit', () => {
    expect(defaultBarWeight('lb')).toBe(45)
    expect(defaultBarWeight('kg')).toBe(20)
  })
})
