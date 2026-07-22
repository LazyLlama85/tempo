// Tempo — device-preference storage (theme, weight unit, focus mode, dev Pro override).
//
// These four preferences all persist the same way, and until 2026-07-22 they all
// did it ASYMMETRICALLY: the write went to `globalThis.localStorage` while the
// read came from `expo-sqlite/kv-store`. On native those happen to be the same
// SQLite database, so it worked — but nothing in the code said so, nothing
// enforced it, and on web (different stores entirely) every one of these
// preferences silently failed to persist. Set kg, reload, back to lbs.
//
// That is a silent-data-loss shape: no error, no crash, the setting just doesn't
// stick. This module makes the pair symmetric and explicit — write both ways,
// read either — so the behaviour no longer depends on an undocumented
// coincidence about how Expo polyfills localStorage.
//
// IMPORTANT — why reads are async and must stay that way: Zustand `create()` runs
// at MODULE EVALUATION TIME, before React mounts and before any error boundary
// exists. A synchronous SQLite-backed read there is what caused the "blank screen
// on first launch, have to force-quit" bug. Every store must default to a safe
// constant synchronously and correct itself post-mount via `readPref`. Do not
// call `readPref` from a store initializer.

/**
 * Persist a preference. Fire-and-forget and best-effort by design: the in-memory
 * store is already updated by the caller, so a storage failure costs the user the
 * setting on next launch, never the current interaction.
 *
 * Writes BOTH ways on purpose — the synchronous localStorage write keeps the old
 * behaviour (and is what a sync reader elsewhere would still see), while the
 * async kv-store write is what `readPref` below actually reads back.
 */
export function writePref(key: string, value: string): void {
  try { (globalThis as { localStorage?: Storage }).localStorage?.setItem(key, value) } catch { /* best-effort */ }
  void (async () => {
    try {
      const { default: AsyncStorage } = await import('expo-sqlite/kv-store')
      await AsyncStorage.setItem(key, value)
    } catch { /* best-effort */ }
  })()
}

/** Clear a preference, both ways. Same fire-and-forget contract as `writePref`. */
export function removePref(key: string): void {
  try { (globalThis as { localStorage?: Storage }).localStorage?.removeItem(key) } catch { /* best-effort */ }
  void (async () => {
    try {
      const { default: AsyncStorage } = await import('expo-sqlite/kv-store')
      await AsyncStorage.removeItem(key)
    } catch { /* best-effort */ }
  })()
}

/**
 * Read a preference after mount. Tries the async SQLite store first (the native
 * source of truth), then falls back to localStorage so a value written by the
 * sync path — or on a platform where kv-store isn't backed by the same database —
 * is still found. Never throws; callers keep their default on any failure.
 */
export async function readPref(key: string): Promise<string | null> {
  try {
    const { default: AsyncStorage } = await import('expo-sqlite/kv-store')
    const v = await AsyncStorage.getItem(key)
    if (v != null) return v
  } catch { /* fall through to localStorage */ }
  try {
    return (globalThis as { localStorage?: Storage }).localStorage?.getItem(key) ?? null
  } catch {
    return null
  }
}
