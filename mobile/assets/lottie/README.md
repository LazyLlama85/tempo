# Tempo — Lottie animations

Character/celebration animations rendered via `lottie-react-native`
(`components/TempoLottie.tsx`) — distinct from the app's existing hand-built
`Animated`+SVG primitives (`SvgProgressRing`, `TempoPulse`, `celebration.tsx`'s
`ConfettiBurst`), which stay exactly as they are. This is for the
character-driven, "Duolingo feel" animations that genuinely need a rigged
asset instead of procedural shapes.

## Current files

- **`pulse.json`** — a hand-authored placeholder (a single circle breathing
  in/out, Tempo blue). **Not a final asset** — it exists so the
  `TempoLottie`/`lottie-react-native` pipeline has something real to render
  end to end before a real character design exists. Currently wired into:
  - `sign-in.tsx` — a subtle accent behind the wordmark ("live logo" moment).
  - `FocusMode.tsx` — a small badge above the rest ring while resting (stands
    in for "the coach" until a real running-coach animation replaces it).
- **`LottieLogo1.json`** — the official example animation bundled with the
  `lottie-react-native` library's own demo app (from
  `github.com/lottie-react-native/lottie-react-native`, `example/animations/`,
  Apache License 2.0 — same repo and license as the `lottie-react-native`
  dependency itself). A real, complex (48 layers, ~6s), known-good file.
  **Not wired into any screen** — it's a test fixture only, useful for
  the on-device pass: if something renders wrong, swapping a screen's
  `pulse.json` for this file for a minute tells you whether the problem is
  `lottie-react-native`'s native setup (this would also fail) or specifically
  the hand-authored `pulse.json` (this would render fine, `pulse.json`
  wouldn't). Delete it once you've got real Tempo-branded assets and no
  longer need that isolation check.

## Adding a real animation (free tier)

1. Find one on [LottieFiles](https://lottiefiles.com/), filtered to their
   **free** license (every asset page states its license — always check it,
   even on the free tier, before shipping it in the app).
2. Download the `.json` (not `.lottie`/dotLottie — `lottie-react-native`
   wants the plain JSON export) and drop it in this folder.
3. Point a `TempoLottie` `source` prop at it: `require('@/assets/lottie/yourFile.json')`.
4. **Recoloring to Tempo's palette doesn't need LottieFiles' paid recolor
   tool.** `lottie-react-native`'s own `colorFilters` prop (free, part of the
   library) recolors specific layers by keypath:
   ```tsx
   <TempoLottie
     source={require('@/assets/lottie/yourFile.json')}
     colorFilters={[{ keypath: 'Layer Name', color: '#4E8BFF' }]}
   />
   ```
   Find each layer's keypath in LottieFiles' free online preview (the Layers
   panel lists every layer name), or by opening the JSON directly and reading
   each layer's `"nm"` field.
5. Delete `pulse.json`'s `require()` call at that call site once the real
   asset is in — leave `pulse.json` itself alone if anything else still
   references it.

## Where the "Tempo Coach" character (once designed) should go

Named by the founder as the target for a consistent running-coach mascot,
once a character design exists (see the chat history for concept-art
prompts):

- **`FocusMode.tsx`** — already wired to a placeholder; swap `pulse.json` for
  a running/waiting pose, ideally driven by `progress` synced to
  `restSecondsLeft / restTotal` so the coach's animation actually tracks the
  real countdown (same idea as `SvgProgressRing`'s `value` prop).
- **`sign-in.tsx`** — swap for a coach idle/wave loop.
- **`why-tempo.tsx`** (onboarding) — additive alongside the existing
  hand-built `ScheduleAnimation` (workout block sliding into a calendar gap);
  a coach pointing at it, not a replacement.
- **`plan-preview.tsx`** reveal — optional, a coach "walking in" once the
  7-day plan finishes animating into place.
