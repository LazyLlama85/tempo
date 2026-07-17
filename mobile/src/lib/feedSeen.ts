// Tempo — Feed "seen" tracking (device-local), same idiom as lib/badges.ts's
// unviewed-badge count: the Feed button's badge is UNVIEWED items, not just
// "currently eligible" — opening the Feed marks everything currently showing as
// seen, so the badge clears immediately and only counts genuinely NEW items
// (or a real increase in social notifications) after that.
//
// Context items are keyed by `${id}:${dateStr}` rather than a permanent key —
// most of them (rest-day advice, Quick Workout, the weekly report banner) are
// legitimately eligible again on a different day with different content, and a
// permanently-seen id would wrongly suppress that. Marking seen for today doesn't
// stop tomorrow's version of the same item type from counting as new.

const seenItemsKey = (userId: string) => `tempo.feed.seenItems.${userId}`
const seenSocialKey = (userId: string) => `tempo.feed.seenSocial.${userId}`

export function feedItemKey(id: string, dateStr: string): string {
  return `${id}:${dateStr}`
}

export function getSeenFeedItems(userId: string): Set<string> {
  try {
    const raw = (globalThis as { localStorage?: Storage }).localStorage?.getItem(seenItemsKey(userId))
    return new Set(raw ? (JSON.parse(raw) as string[]) : [])
  } catch { return new Set() }
}

export function markFeedItemsSeen(userId: string, keys: Iterable<string>): void {
  try {
    const ls = (globalThis as { localStorage?: Storage }).localStorage
    if (!ls) return
    const merged = getSeenFeedItems(userId)
    for (const k of keys) merged.add(k)
    // Cap growth — keep only the most recent 60 entries (plenty for a rolling
    // handful of item types over ~2 months of dated keys) so this never grows
    // unbounded in localStorage.
    const trimmed = [...merged].slice(-60)
    ls.setItem(seenItemsKey(userId), JSON.stringify(trimmed))
  } catch { /* best-effort */ }
}

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
