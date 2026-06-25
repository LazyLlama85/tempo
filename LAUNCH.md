# 🚀 Tempo — Launch Guide (iOS + Android)

Last updated June 2026. This is the single source of truth for shipping Tempo to the App Store and
Google Play. The **code and backend are launch-ready**; what's left is account/credential setup that
only you can do (marked 👤). Everything marked ✅ is already done in the repo / live in Supabase.

---

## 1. What you have (audited)

**Onboarding & auth** — Apple Sign In, Google OAuth (PKCE), guest mode; real Google + device
calendar connect during onboarding; goal/experience/equipment/availability capture.

**Core loop** — unified day/week/month schedule, autoregulated workout runner with RPE logging,
rest timer, smart swaps, form guides + exercise GIFs, Quick Workouts sized to free time.

**Adaptive coaching** — periodized mesocycle (overload + scheduled deload), `adaptation_mode` driven
by real signals (missed sessions, "too hard"); block-phase banner on Home.

**Progress & profile** — stats, PRs, achievements/levels, Wrapped share cards, body-weight +
body-fat + waist trends, **progress photos**, **injury/limitations editor**, **notifications
toggle**, equipment editor, travel mode, recovery check-ins.

**Backend (Supabase, live)** — 15+ tables with RLS, edge functions (`delete-account`,
`google-calendar-token`, `retention-push`), hourly retention-push cron, push + body-measurement +
periodization + progress-photo storage.

**Infra** — analytics (PostHog) + crash reporting (Sentry), both no-op without keys; server-driven
push retention engine.

**Store-readiness** — app icon, splash, Android adaptive icons; in-app Privacy Policy + Terms;
App Store-compliant account deletion (Guideline 5.1.1(v)); marketing site in `web/` to host the
public privacy URL.

---

## 2. Launch blockers — what's done vs. what you must do

| Item | Status |
|------|--------|
| iOS export-compliance flag (`ITSAppUsesNonExemptEncryption`) | ✅ in `app.json` |
| Photo-library permission string | ✅ in `app.json` |
| `eas submit` profile scaffold | ✅ in `eas.json` (fill the placeholders) |
| Supabase backend (tables, functions, cron, storage) | ✅ live |
| **Expo account + `eas init`** (own the project) | 👤 |
| **Apple Developer Program** ($99/yr) | 👤 |
| **Google Play Console** ($25 once) | 👤 |
| **APNs key** (iOS push) + **FCM service-account JSON** (Android push) via `eas credentials` | 👤 |
| **Public privacy-policy URL** (host `legal.tsx` text on your `web/` site) | 👤 |
| **Store metadata** (screenshots, description, category, age rating, data-collection forms) | 👤 |
| Telemetry keys (`EXPO_PUBLIC_POSTHOG_KEY`, `EXPO_PUBLIC_SENTRY_DSN`) — optional | 👤 |

---

## 3. How to launch — step by step

### Pre-flight
1. `cd mobile && npx tsc --noEmit` → clean.
2. `npm i -g eas-cli && eas login && eas init` (links the project to **your** Expo account).
3. (Optional) add `EXPO_PUBLIC_POSTHOG_KEY` / `EXPO_PUBLIC_SENTRY_DSN` to `eas.json` →
   `build.production.env`. For symbolicated crash stacks also set `SENTRY_ORG` / `SENTRY_PROJECT` /
   `SENTRY_AUTH_TOKEN` as EAS secrets **and remove `SENTRY_DISABLE_AUTO_UPLOAD` from the
   `preview`/`production` env** — that flag is currently set so release builds skip the Sentry
   source-map upload (which otherwise fails the Gradle build when the token is absent).
4. All Supabase migrations are already applied — nothing to run.

### iOS
1. Enroll in Apple Developer; enable the **Sign in with Apple** capability for `com.tempo.app`.
2. `eas build --profile production --platform ios` (EAS provisions signing).
   For push: `eas credentials` → **iOS → Push Notifications → upload an APNs key**.
3. App Store Connect: create the app (`com.tempo.app`); fill metadata, screenshots (6.7" + 5.5"),
   1024px icon, privacy URL, age rating, and the **App Privacy** form. Declare: account email,
   fitness/health data; add **analytics/usage** + **crash data** only if PostHog/Sentry keys are set.
4. In `eas.json` fill `submit.production.ios` (`appleId`, `ascAppId`, `appleTeamId`), then
   `eas submit --profile production --platform ios`.
5. Submit for review. In review notes, tell them to use **guest mode** (no login needed).

### Android
1. Create the Play Console app (`com.fittempo.app`).
2. `eas build --profile production --platform android` (app-bundle).
   For push: upload the **FCM v1 service-account JSON** (`eas credentials` or Play/Firebase console).
3. Complete Play **Data safety**, content rating, target audience, privacy URL, store listing +
   phone screenshots.
4. Save the Play service-account JSON as `mobile/play-service-account.json` (git-ignored), then
   `eas submit --profile production --platform android` → roll out to **internal testing** first,
   then promote to production.

### Post-launch
- Watch **Sentry** (crashes) and the **PostHog** funnel (`app_open → onboarding_complete →
  session_start`).
- The `retention-push` cron runs hourly; check `notification_log` for delivery/failures.

---

## 4. Store metadata checklist (both stores)
App name (Tempo) · short + full description · keywords · **Health & Fitness** category ·
app icon (1024px) · phone screenshots · **privacy-policy URL** · support email
(`fittempo.app@gmail.com`) · age rating · data-collection disclosures (match what's actually
enabled).

---

## 5. Remaining roadmap (post-launch, not blockers)

Built this pass: ✅ injury editor, ✅ notifications toggle, ✅ body-fat/waist trends, ✅ progress
photos, ✅ mobility/stretch exercise content.

Still open:
- **Free-time-gap push from real calendar** — the retention rule currently uses a daytime heuristic.
  True calendar-aware gaps need device calendar free/busy synced to the backend (the engine runs
  server-side and can't read the on-device calendar). Architectural; deferred.
- **Progress-photo gallery / before-after compare** — photos are captured + stored privately now;
  a timeline/compare view is a follow-up.
- **HealthKit / Google Fit** weight import; Apple Watch.
- **Automated test suite** — pure logic (`scoring`/`periodization`/`progression`/trends) is
  structured for unit tests; none exist yet.

---

## 6. Key commands
```
cd mobile
npx tsc --noEmit                                   # typecheck
eas build --profile preview --platform ios         # installable test build
eas build --profile production --platform ios      # store build (or --platform android)
eas submit  --profile production --platform ios     # upload to the store
eas credentials                                     # manage APNs / FCM push keys
```
