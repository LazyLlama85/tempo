// Guards the raw-enum leak that shipped in an App Store screenshot: the Plan
// screen rendered "UPPER_CHEST · TRICEPS" because muscle keys went to the UI
// untransformed. Every snake_case key in the exercise DB must render clean.

import { formatMuscleName } from '@/lib/exerciseProgramming'

describe('formatMuscleName', () => {
  it('replaces underscores so no raw enum reaches the UI', () => {
    expect(formatMuscleName('upper_chest')).toBe('upper chest')
    expect(formatMuscleName('rear_delts')).toBe('rear delts')
    expect(formatMuscleName('lateral_deltoids')).toBe('lateral deltoids')
  })

  it('leaves single-word keys untouched', () => {
    for (const m of ['chest', 'triceps', 'quads', 'lats', 'abs']) {
      expect(formatMuscleName(m)).toBe(m)
    }
  })

  it('is faithful, not prose — it must NOT relabel lats as "back"', () => {
    // sessionRationale's MUSCLE_LABEL does that on purpose for coaching copy;
    // the "Muscles worked" chips must keep showing the real muscle.
    expect(formatMuscleName('lats')).toBe('lats')
  })

  it('never leaves an underscore, whatever the key', () => {
    const keys = [
      'upper_chest', 'rear_delts', 'lateral_deltoids', 'upper_back',
      'serratus_anterior', 'levator_scapulae', 'a_b_c',
    ]
    for (const k of keys) expect(formatMuscleName(k)).not.toMatch(/_/)
  })

  it('uppercases cleanly the way the Plan row renders it', () => {
    expect(['upper_chest', 'triceps'].map(formatMuscleName).join(' · ').toUpperCase())
      .toBe('UPPER CHEST · TRICEPS')
  })
})
