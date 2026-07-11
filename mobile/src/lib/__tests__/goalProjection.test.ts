import { projectGoal } from '@/lib/goalProjection'

describe('goalProjection — honest ETA math', () => {
  it('fat loss: weeks to drop 10 lbs at the current rate', () => {
    const p = projectGoal({ goal: 'fat_loss', weightPerWeek: -0.8, benchMax: null })
    expect(p?.headline).toBe('13 weeks to lose 10 lbs') // ceil(10 / 0.8) = 13
    expect(p?.pct).toBeNull()
  })

  it('fat loss with no weight trend shows a "log your weight" prompt, not a bogus ETA', () => {
    const p = projectGoal({ goal: 'fat_loss', weightPerWeek: null, benchMax: null })
    expect(p?.headline).toBe('Log your weight to see your ETA')
    // A tiny/flat rate isn't enough signal either.
    expect(projectGoal({ goal: 'fat_loss', weightPerWeek: -0.05, benchMax: null })?.headline)
      .toBe('Log your weight to see your ETA')
  })

  it('muscle gain: weeks to add 5 lbs of bodyweight at the current rate', () => {
    const p = projectGoal({ goal: 'muscle_gain', weightPerWeek: 0.25, benchMax: null })
    expect(p?.headline).toBe('20 weeks to gain 5 lbs') // ceil(5 / 0.25) = 20
  })

  it('strength: weeks to the next bench milestone, with a progress percentage', () => {
    const p = projectGoal({ goal: 'strength', experience: 'intermediate', weightPerWeek: null, benchMax: 200 })
    expect(p?.headline).toBe('10 weeks to a projected 225 bench') // (225-200)/2.5 = 10
    expect(p?.pct).toBe(89) // round(200 / 225 * 100)
  })

  it('milestones snap to 225 just under it, else the next 25-lb step', () => {
    expect(projectGoal({ goal: 'strength', experience: 'intermediate', weightPerWeek: null, benchMax: 185 })?.headline)
      .toBe('16 weeks to a projected 225 bench') // (225-185)/2.5 = 16
    expect(projectGoal({ goal: 'strength', experience: 'beginner', weightPerWeek: null, benchMax: 100 })?.headline)
      .toBe('5 weeks to a projected 125 bench') // nextMilestone(100)=125, /5 = 5
  })

  it('training age changes the assumed strength rate', () => {
    const beginner = projectGoal({ goal: 'strength', experience: 'beginner', weightPerWeek: null, benchMax: 200 })
    const advanced = projectGoal({ goal: 'strength', experience: 'advanced', weightPerWeek: null, benchMax: 200 })
    // Same gap to 225, but a beginner is assumed to close it faster.
    expect(beginner!.headline).toBe('5 weeks to a projected 225 bench') // 25/5
    expect(advanced!.headline).toBe('25 weeks to a projected 225 bench') // 25/1
  })

  it('muscle gain with no weight trend falls back to a strength projection', () => {
    const p = projectGoal({ goal: 'muscle_gain', experience: 'intermediate', weightPerWeek: null, benchMax: 200 })
    expect(p?.headline).toBe('10 weeks to a projected 225 bench')
  })

  it('general fitness leans on the weight trend when there is one', () => {
    const p = projectGoal({ goal: 'general_fitness', weightPerWeek: 0.5, benchMax: null })
    expect(p?.headline).toBe('10 weeks to gain 5 lbs') // ceil(5 / 0.5)
  })

  it('returns null when there is no usable signal at all', () => {
    expect(projectGoal({ goal: 'general_fitness', weightPerWeek: null, benchMax: null })).toBeNull()
    expect(projectGoal({ goal: 'muscle_gain', weightPerWeek: 0.02, benchMax: null })).toBeNull()
  })
})
