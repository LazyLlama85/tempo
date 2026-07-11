import { weekProgression, isRecoveryWeek, BLOCK_WEEKS, type AdaptationMode } from '@/lib/periodization'

describe('periodization — mesocycle wave', () => {
  it('uses a 4-week block', () => {
    expect(BLOCK_WEEKS).toBe(4)
  })

  it('produces exactly one deload every 4 weeks in the default (normal) wave', () => {
    // The audit's core assertion: over any 4 consecutive weeks the normal template
    // schedules one — and only one — deload (a bad change here silently removes the
    // recovery week and users overtrain, or doubles it and they stall).
    for (let block = 0; block < 6; block++) {
      const weeks = [0, 1, 2, 3].map(i => weekProgression(block * 4 + i, 'intermediate', 'normal'))
      expect(weeks.filter(w => w.isDeload)).toHaveLength(1)
      // …and it's the 4th week of the block, not a random one.
      expect(weeks[3].isDeload).toBe(true)
      expect(weeks[3].phase).toBe('deload')
    }
  })

  it('cycles the wave modulo the block length so a plan past week 4 never "ends"', () => {
    const w0 = weekProgression(0, 'intermediate', 'normal')
    const w4 = weekProgression(4, 'intermediate', 'normal')
    const w8 = weekProgression(8, 'intermediate', 'normal')
    expect(w4.phase).toBe(w0.phase)
    expect(w4.label).toBe(w0.label)
    expect(w8.phase).toBe(w0.phase)
    // weekIndex itself keeps counting up even though the wave repeats.
    expect(w4.weekIndex).toBe(4)
    expect(w8.weekIndex).toBe(8)
  })

  it('handles a negative week index by wrapping into the block', () => {
    // Defensive: a bad caller must not read undefined off the table.
    const wNeg = weekProgression(-1, 'intermediate', 'normal')
    const w3 = weekProgression(3, 'intermediate', 'normal')
    expect(wNeg.phase).toBe(w3.phase)
    expect(wNeg.isDeload).toBe(true)
  })

  it('gives beginners a gentler peak (no volume spike) and a shallower deload', () => {
    const peak = weekProgression(2, 'beginner', 'normal')
    expect(peak.phase).toBe('peak')
    expect(peak.setsDelta).toBe(0) // intermediate would be +1

    const deload = weekProgression(3, 'beginner', 'normal')
    expect(deload.isDeload).toBe(true)
    expect(deload.intensityPct).toBeGreaterThanOrEqual(0.9) // milder than the 0.85 default

    const peakInt = weekProgression(2, 'intermediate', 'normal')
    expect(peakInt.setsDelta).toBe(1)
  })

  it('keeps working-week intensity at 1.0 so planned + reactive load never stack', () => {
    for (const wk of [0, 1, 2]) {
      expect(weekProgression(wk, 'intermediate', 'normal').intensityPct).toBe(1)
    }
    // Only the deload dips the planned load.
    expect(weekProgression(3, 'intermediate', 'normal').intensityPct).toBeLessThan(1)
  })

  it('recovery mode leads with an immediate deload; deload mode does too', () => {
    const recovery = weekProgression(0, 'intermediate', 'recovery')
    expect(recovery.isDeload).toBe(true)
    const deloadFirst = weekProgression(0, 'intermediate', 'deload')
    expect(deloadFirst.isDeload).toBe(true)
  })

  it('every adaptation mode returns a defined directive for every week of a block', () => {
    const modes: AdaptationMode[] = ['normal', 'maintenance', 'recovery', 'deload']
    for (const mode of modes) {
      for (let i = 0; i < BLOCK_WEEKS; i++) {
        const p = weekProgression(i, 'intermediate', mode)
        expect(p.phase).toBeTruthy()
        expect(typeof p.setsDelta).toBe('number')
        expect(p.intensityPct).toBeGreaterThan(0)
      }
    }
  })

  it('isRecoveryWeek mirrors the deload flag and tolerates null/undefined', () => {
    expect(isRecoveryWeek(weekProgression(3, 'intermediate', 'normal'))).toBe(true)
    expect(isRecoveryWeek(weekProgression(0, 'intermediate', 'normal'))).toBe(false)
    expect(isRecoveryWeek(null)).toBe(false)
    expect(isRecoveryWeek(undefined)).toBe(false)
  })
})
