# Tempo Project

## GitHub Push Protocol
Don't push to GitHub. Make code changes locally only — no commits or pushes unless explicitly asked.

## Documentation Protocol
**Update `ARCHITECTURE.md` (repo root) every time a change is made** — whenever you add or
change a screen, lib module, table, edge function, or feature, reflect it in `ARCHITECTURE.md`
in the same turn so it stays an accurate map of the system.

## Stack
- Expo ~56 (React Native) in `mobile/` — **SDK changes fast; read the versioned docs
  at https://docs.expo.dev/versions/v56.0.0/ before writing native/config code.**
- Web in `web/`
- Backend: Supabase (project ref `rtoahppnekykgmjukujm`, name "Tempo")

## Running the App
- Mobile: `cd mobile && npx expo start --ios`
- Requires `mobile/.env.local` (see `mobile/.env.example` for the full list).

### ⚠️ Native modules — Expo Go no longer works
The app now depends on native modules that aren't in the Expo Go runtime:
`@sentry/react-native`, `posthog-react-native`, and push via `expo-notifications`.
**You must run a dev client / EAS build, not Expo Go.** After any dependency or
`app.json` plugin change, rebuild the native project:
```
cd mobile
npx expo run:ios      # or run:android  (local dev client)
# or a cloud build:
npx eas build --profile development --platform ios
```
A plain `expo start` JS reload will NOT pick up new native modules.

## Environment variables
All client keys are `EXPO_PUBLIC_*` so they're inlined at build time. Local dev
reads `mobile/.env.local`. **EAS Build does NOT read `.env.local`** — build-time
vars live in `eas.json` → `build.<profile>.env`. The Supabase + RapidAPI config is
**already wired into the `preview` and `production` profiles**, so builds connect to
the backend with no extra setup. Add telemetry keys to those same `env` blocks if/when
you obtain them.

| Var | Purpose | Status |
|-----|---------|--------|
| `EXPO_PUBLIC_SUPABASE_URL` / `EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Backend | ✅ In `eas.json` |
| `EXPO_PUBLIC_RAPIDAPI_KEY` | Exercise media | ✅ In `eas.json` |
| `EXPO_PUBLIC_POSTHOG_KEY` (+ `_HOST`) | Analytics | Optional — no-ops if unset |
| `EXPO_PUBLIC_SENTRY_DSN` | Crash reporting | Optional — no-ops if unset |

## Telemetry (analytics + crash reporting)
- `src/lib/analytics.ts` — PostHog wrapper; typed events via `EventProperties`;
  `track()` / `identifyUser()` / `resetUser()`. No-ops without `EXPO_PUBLIC_POSTHOG_KEY`.
- `src/lib/crashReporting.ts` — Sentry wrapper; `captureException` / `captureApiError`.
  Disabled in `__DEV__` by design, so test crash capture in a release/preview build.
- Both initialized in `src/app/_layout.tsx`; failed React Query requests funnel to Sentry.
- **Sentry source maps:** the `@sentry/react-native/expo` plugin needs `SENTRY_ORG`,
  `SENTRY_PROJECT`, and `SENTRY_AUTH_TOKEN` at build time to upload symbols. Without
  them crashes still report, but stack traces won't be symbolicated. Set them as EAS
  secrets before a production build.

## Push notifications (server-driven retention)
The backend (already provisioned in Supabase) drives all retention pushes:
- Tables `device_tokens` + `notification_log` (migration `mobile/supabase/add_push_notifications.sql`).
- Edge Function `retention-push` (deployed, `verify_jwt=false`) — see its README. Evaluates
  per-user rules (missed workout, streak-at-risk, free-time gap, reactivation), sends via
  the Expo Push API, logs every attempt, and disables dead tokens.
- A `pg_cron` job `retention-push-hourly` invokes it every hour.
- Client registers tokens in `src/lib/pushTokens.ts` (on login) and routes taps in `_layout.tsx`.

**Before pushes deliver on real builds you must upload provider credentials to Expo:**
- iOS: an APNs key — `cd mobile && npx eas credentials` (Push Notifications) or upload in the Expo dashboard.
- Android: an FCM v1 service-account JSON — upload via `eas credentials` / dashboard.
Local pre-workout reminders (`src/lib/notifications.ts`) still run on-device; only the
retention nudges are server-driven.

## Body measurements (weight/measurement history)
- Table `body_measurements` (migration `mobile/supabase/add_body_measurements_history.sql`,
  applied + backfilled from the old `user_profiles.bodyweight_lbs`, which is now just a
  denormalised "latest weight" cache).
- `src/lib/bodyMeasurements.ts` — `logMeasurement`, `fetchMeasurements`, and trend math
  (`computeWeightTrend` = least-squares lb/week, `rollingAverage`). UI lives in the Profile tab.

## Progression (periodization + adaptive deload)
- Columns `scheduled_workouts.week_index` + `progression` (jsonb) — migration
  `mobile/supabase/add_periodization.sql`, **applied**.
- `src/lib/periodization.ts` — the mesocycle: overload weeks 1–3 + a scheduled
  deload (week 4), with `normal` / `recovery` / `deload` / `maintenance` variants
  selected by the plan's `adaptation_mode`.
- `src/lib/progression.ts` — `buildPrescription` now also takes the week's
  `WeekProgression` (volume wave + deload load cut) on top of reactive load
  autoregulation. The two layers are deliberately separated so load never
  double-counts (planned intensity only deviates from 1.0 on a deload).
- `src/lib/adaptation.ts` — `refreshAdaptation()` evaluates real signals (missed
  sessions, repeated "too hard") and flips `adaptation_mode`, **re-stamping every
  future plan workout** so the coming weeks actually change. Runs on app open
  (after missed-workout sweep) and after each workout/feedback. This is what makes
  `adaptation_mode` a live input rather than an unused column.

## Applying Supabase changes
SQL files in `mobile/supabase/*.sql` are the source of truth. The push-notification and
body-measurement migrations are **already applied** to the live project. For new changes,
add a `.sql` file and apply it (Supabase SQL editor or the MCP `apply_migration`); deploy
function changes with `npx supabase functions deploy <name>`.

## Pre-publish checklist (iOS + Android)
- [ ] All required `EXPO_PUBLIC_*` vars set in the production EAS build profile.
- [ ] APNs key (iOS) + FCM service account (Android) uploaded to Expo for push.
- [ ] Sentry `SENTRY_ORG`/`SENTRY_PROJECT`/`SENTRY_AUTH_TOKEN` set for source maps.
- [ ] `npx tsc --noEmit` passes in `mobile/`.
- [ ] Built with EAS (not Expo Go) and smoke-tested on a physical device — push tokens
      and crash reporting only work on real builds/devices.
- [ ] App Store account-deletion flow intact (Profile → Delete Account; Guideline 5.1.1(v)).
