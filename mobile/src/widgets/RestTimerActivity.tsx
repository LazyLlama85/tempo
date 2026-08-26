// Arclo — Rest Timer Live Activity: no-op on EVERY platform, iOS included.
//
// SHELVED 2026-08-26. This used to be the Android/web stub while
// `RestTimerActivity.ios.tsx` carried a real iOS implementation. That file now
// sits in `./dormant/`, which nothing imports, so Metro no longer finds a
// platform-specific override and iOS resolves to this file too. Net effect: the
// Lock Screen Live Activity is never started on any platform.
//
// WHY. The Live Activity rendered as a blank dark capsule on a real device —
// no ring, no "RESTING" label, no countdown (see EXECUTION_STATUS.md N7). The
// layout code reads correctly on inspection; `expo-widgets` compiles it into
// native SwiftUI in a separate pass, and diagnosing that needs Xcode on a Mac.
// Rather than ship a visibly broken Lock Screen surface into App Review as
// Guideline 2.1 bait, the feature is switched off at the resolution layer.
//
// HOW TO BRING IT BACK. Move `dormant/RestTimerActivity.ios.tsx` back up one
// directory. That is the whole change — the call sites in `plan.tsx` and
// `_layout.tsx` were never touched and still call these four names. The file
// stays under `src/` on purpose so `tsc` keeps compiling it and it cannot rot
// into something unrevivable, which is what commenting it out would have done.
//
// The in-app rest timer is unaffected: it is separate state, and all four
// functions below return void with no caller reading a result.

export interface RestTimerActivityProps {
  exerciseName: string
  startedAt: number
  endsAt: number
}

export function startRestActivity(_exerciseName: string, _endsAtMs: number, _totalSec: number): void {}
export function updateRestActivity(_exerciseName: string, _endsAtMs: number, _totalSec: number): void {}
export function endRestActivity(): void {}
export function endStaleRestActivities(): void {}
