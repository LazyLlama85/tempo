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
 * Read a preference. **Must only be called after mount** — never from a store
 * initializer (see this module's header).
 *
 * Reads `localStorage` FIRST, then falls back to the async kv-store. That order
 * is deliberate and was chosen on-device:
 *
 *  • On native `globalThis.localStorage` IS the SQLite-backed store, so the first
 *    branch is already the source of truth — the dynamic import is redundant work
 *    on the happy path.
 *  • `import('expo-sqlite/kv-store')` resolves fine in a production bundle but
 *    FAILS under Metro's lazy bundling in dev with `Requiring unknown module`.
 *    With the old order that threw on every launch, once per preference — four
 *    red LogBox overlays covering the app before you could touch it. Harmless
 *    (each was caught, and the fallback returned the right value) but it made the
 *    dev build unusable to look at, which is its whole purpose.
 *  • The synchronous read is safe HERE specifically because this runs post-mount.
 *    The "blank screen on first launch" bug was a sync SQLite read at
 *    module-evaluation time; the app already does sync `localStorage.setItem`
 *    post-mount on every preference write, so this is the same exposure.
 *
 * The kv-store branch is kept as a genuine fallback: on web the two are different
 * stores, so a value written only through the async path is still found.
 * Never throws; callers keep their default on any failure.
 */
export async function readPref(key: string): Promise<string | null> {
  try {
    const ls = (globalThis as { localStorage?: Storage }).localStorage
    if (ls) {
      // localStorage EXISTS, so it is authoritative: on native it is the SQLite
      // store itself, and on web `writePref` always writes here too. A null here
      // therefore means the preference is genuinely unset — returning early
      // (rather than also consulting kv-store) is not just an optimisation, it
      // avoids the dynamic import entirely on every normal launch, which is what
      // was spraying LogBox errors over a fresh install that has nothing saved yet.
      return ls.getItem(key) ?? null
    }
  } catch { /* fall through to the async store */ }
  // Only reached where localStorage is unavailable altogether.
  try {
    const { default: AsyncStorage } = await import('expo-sqlite/kv-store')
    return (await AsyncStorage.getItem(key)) ?? null
  } catch {
    return null
  }
}
