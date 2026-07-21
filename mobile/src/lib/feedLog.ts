// Tempo — the Feed's local message log (device-local, same localStorage idiom
// as lib/feedSeen.ts, which this replaces for the Feed screen specifically).
//
// The old Feed sheet recomputed "today's eligible context items" live on every
// open — so a still-eligible item (Goal ETA, rest-day advice, a live block-phase
// note) reappeared every single day with the same content, forever, because
// eligibility was never distinguished from "is this actually new." This module
// is a real append-only log instead: an item is written ONCE when it first
// becomes eligible, then suppressed for `cooldownMs` even if it stays eligible
// the whole time — so the Feed reads like message history, not a live status
// mirror. (Home's own banner/chip row is untouched — that's normal live
// dashboard state, not a notification, and was never the complaint.)

export interface FeedItem {
  id: string            // stable per logical item (e.g. 'context:goal'); used for dedupe + read-state
  icon: string
  title: string
  body: string
  screen?: string        // route to open on tap — matches the push payload's `data.screen` convention
  params?: Record<string, string>
  createdAt: number      // epoch ms
}

const logKey = (userId: string) => `tempo.feed.log.${userId}`
const readKey = (userId: string) => `tempo.feed.lastRead.${userId}`

const MAX_ITEMS = 80
// Context items are live conditions, not discrete events — a week of "still
// on a deload" shouldn't be 7 messages. One week is enough to feel "new
// again" without ever feeling repetitive day to day.
export const DEFAULT_COOLDOWN_MS = 7 * 24 * 60 * 60 * 1000

function readJSON<T>(key: string, fallback: T): T {
  try {
    const raw = (globalThis as { localStorage?: Storage }).localStorage?.getItem(key)
    return raw ? (JSON.parse(raw) as T) : fallback
  } catch { return fallback }
}
function writeJSON(key: string, value: unknown): void {
  try { (globalThis as { localStorage?: Storage }).localStorage?.setItem(key, JSON.stringify(value)) } catch { /* best-effort */ }
}

/** Every logged item, newest first. */
export function getFeedLog(userId: string): FeedItem[] {
  return readJSON<FeedItem[]>(logKey(userId), []).sort((a, b) => b.createdAt - a.createdAt)
}

/**
 * Log an item unless one with the same `id` was already logged within
 * `cooldownMs` — the whole fix for "same content every day." A cooldown miss
 * (item genuinely went away and came back) logs a fresh, genuinely-new entry.
 */
export function logFeedItem(userId: string, item: Omit<FeedItem, 'createdAt'>, cooldownMs = DEFAULT_COOLDOWN_MS): void {
  if (!userId) return
  const existing = readJSON<FeedItem[]>(logKey(userId), [])
  const recent = existing.find(e => e.id === item.id && Date.now() - e.createdAt < cooldownMs)
  if (recent) return
  const next = [{ ...item, createdAt: Date.now() }, ...existing.filter(e => e.id !== item.id)]
    .sort((a, b) => b.createdAt - a.createdAt)
    .slice(0, MAX_ITEMS)
  writeJSON(logKey(userId), next)
}

/** `{ id: epoch-ms-last-marked-read }` — an item is unread when its own createdAt is newer than this. */
export function getLastReadAt(userId: string): Record<string, number> {
  return readJSON<Record<string, number>>(readKey(userId), {})
}

export function markRead(userId: string, ids: Iterable<string>): void {
  if (!userId) return
  const map = getLastReadAt(userId)
  const now = Date.now()
  for (const id of ids) map[id] = now
  writeJSON(readKey(userId), map)
}

export function isUnread(item: Pick<FeedItem, 'id' | 'createdAt'>, lastReadAt: Record<string, number>): boolean {
  return item.createdAt > (lastReadAt[item.id] ?? 0)
}
