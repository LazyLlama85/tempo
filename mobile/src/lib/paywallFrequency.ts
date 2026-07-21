// Tempo — automatic-paywall frequency cap (§25 L7).
//
// Onboarding completion and first-workout completion can both fire in one
// session (a fast, motivated first day) — without this a brand-new user could
// get shown the paywall twice within an hour. Applies ONLY to automatic
// redirects (onboarding, first_workout) — a user-initiated open (Settings, a
// Pro badge, the Home conflict card's own explicit tap-through) is a
// deliberate action, not a nag, and must never be suppressed by this.

const KEY = 'tempo.paywall.lastAutoShownAt'
const COOLDOWN_MS = 48 * 60 * 60 * 1000 // 48h

export function shouldAutoShowPaywall(): boolean {
  try {
    const raw = (globalThis as { localStorage?: Storage }).localStorage?.getItem(KEY)
    if (!raw) return true
    return Date.now() - Number(raw) > COOLDOWN_MS
  } catch {
    return true
  }
}

export function markPaywallAutoShown(): void {
  try {
    (globalThis as { localStorage?: Storage }).localStorage?.setItem(KEY, String(Date.now()))
  } catch { /* best-effort */ }
}
