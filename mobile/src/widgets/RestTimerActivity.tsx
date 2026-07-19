// Tempo — Rest Timer Live Activity: Android/web no-op stub.
//
// The real implementation is `RestTimerActivity.ios.tsx` — Live Activities
// are an iOS-only concept, and `@expo/ui/swift-ui`'s components (which that
// file imports) call into a native view manager that doesn't exist on
// Android or web at all. A runtime `Platform.OS` check can't prevent that:
// the `import` itself executes before any guard runs, which is exactly what
// broke both platforms' bundling the first time this shipped. Metro's
// platform-extension resolution (`.ios.tsx` beats this bare file on iOS,
// this file is all that's left for every other platform) keeps the two
// files from ever being bundled together. Same public shape as the real
// file, safe no-ops throughout.

export interface RestTimerActivityProps {
  exerciseName: string
  startedAt: number
  endsAt: number
}

export function startRestActivity(_exerciseName: string, _endsAtMs: number, _totalSec: number): void {}
export function updateRestActivity(_exerciseName: string, _endsAtMs: number, _totalSec: number): void {}
export function endRestActivity(): void {}
export function endStaleRestActivities(): void {}
