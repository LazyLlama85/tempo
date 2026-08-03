// Tempo — free-tier history horizon (Pro gate: `full_history`).
//
// Free sees the last 4 months of training history on every "browse my history"
// surface (per-exercise trend, muscle-level trend, the workout history list);
// Pro removes the cutoff entirely. This is a READ-TIME clamp only — nothing is
// ever deleted or hidden at the database level for a free user, so buying Pro
// immediately reveals everything that was always there, with no backfill or
// migration needed. Extends the existing "depth & horizon" Pro model
// (lib/proFeatures.ts) the same way `pr_forecasting` already does for one lift's
// forward-looking projection — this is the read-backward counterpart.
//
// Deliberately NOT applied to current-state facts that happen to be derived
// from all-time data — streak, all-time PRs/best-ever stats, adaptation
// signals, badges, Tempo Score. Those describe the user's PRESENT standing,
// not a history browse; clamping them would misrepresent who the user
// currently is, not just hide an old chart. Only apply this to a screen whose
// entire purpose is looking backward through time.

export const FREE_HISTORY_MONTHS = 4

export function historyCutoffDate(now: Date = new Date()): Date {
  const d = new Date(now)
  d.setMonth(d.getMonth() - FREE_HISTORY_MONTHS)
  return d
}

export function historyCutoffIso(now: Date = new Date()): string {
  return historyCutoffDate(now).toISOString()
}
