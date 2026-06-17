// Tempo — common form mistakes by movement pattern.
// Keyed by pattern (not per-exercise) so every lift gets accurate, coach-grade
// cues without inventing per-exercise data we don't have. These are the errors
// that actually show up for each movement family.

export const COMMON_MISTAKES: Record<string, string[]> = {
  push: [
    'Letting your elbows flare straight out — keep them about 45° from your torso.',
    'Bouncing the weight instead of controlling the lowering phase.',
    'Losing tightness in your shoulder blades at the top.',
  ],
  pull: [
    'Yanking with your arms instead of leading with your elbows and back.',
    'Using momentum or swinging your torso to move the weight.',
    'Cutting the range short — get a full stretch at the bottom.',
  ],
  squat: [
    'Letting your knees cave inward — actively push them out.',
    'Heels lifting off the floor — drive through your mid-foot.',
    'Rounding your lower back instead of bracing and staying tall.',
  ],
  hinge: [
    'Turning it into a squat — push your hips back first, knees bend only slightly.',
    'Rounding your back instead of keeping a flat, braced spine.',
    'Letting the bar or dumbbells drift away from your legs.',
  ],
  core: [
    'Holding your breath — breathe steadily throughout.',
    'Letting your hips sag or pike out of a straight line.',
    'Rushing reps instead of controlling every inch.',
  ],
  carry: [
    'Leaning or twisting — stay tall and braced the whole way.',
    'Letting the load pull your shoulders forward.',
    'Holding your breath under load instead of breathing behind your brace.',
  ],
  cardio: [
    'Going too hard too early — pace it for the full interval.',
    'Letting form get sloppy as you fatigue.',
    'Skipping a light warm-up before ramping intensity.',
  ],
}

export function getCommonMistakes(movementPattern: string): string[] {
  return COMMON_MISTAKES[movementPattern] ?? []
}
