// Tempo — social-notification "seen" tracking (device-local). The Feed's own
// item log/read-state moved to lib/feedLog.ts (2026-07-22 redesign) — this
// file now only tracks the acknowledged count for pending friend requests/
// invites, which stays a live count (not discrete logged messages) since
// lib/social.ts's fetchSocialNotifCount has no per-event history to log.

const seenSocialKey = (userId: string) => `tempo.feed.seenSocial.${userId}`

/** The social-notification count already acknowledged (friend requests/invites). */
export function getSeenSocialCount(userId: string): number {
  try {
    const raw = (globalThis as { localStorage?: Storage }).localStorage?.getItem(seenSocialKey(userId))
    return raw ? parseInt(raw, 10) || 0 : 0
  } catch { return 0 }
}

export function setSeenSocialCount(userId: string, n: number): void {
  try {
    (globalThis as { localStorage?: Storage }).localStorage?.setItem(seenSocialKey(userId), String(n))
  } catch { /* best-effort */ }
}
