# Tempo — Store Submission & OAuth Verification (filled-in answers)

Companion to `LAUNCH.md`. This is the paste-ready detail for the parts that trip people up:
Google OAuth verification, the App Store **App Privacy** questionnaire, and the Play **Data safety**
form. Values below match the actual app (`com.fittempo.app`, domain `fittempo.app`).

> **Support email:** `fittempo.app@gmail.com` — now used consistently across the app (`legal.tsx`)
> and the web pages (privacy, terms, delete-account). Use the same address on the store listings and
> the OAuth consent screen.

---

## 0. Brand assets to upload (in `brand-assets/`)

| Asset | File | Where it goes |
|-------|------|---------------|
| Google OAuth consent-screen logo (120×120, no alpha) | `brand-assets/google-oauth-logo-120.png` | Google Cloud → OAuth consent screen → App logo |
| App icon 512×512 (no alpha) | `brand-assets/app-icon-512.png` | Play Console → Store listing → App icon |
| App icon 1024×1024 | `mobile/assets/images/icon.png` | App Store Connect → App icon (EAS also embeds it) |

Still to make (need text/screenshots — do in Canva/Figma): Play **feature graphic** 1024×500, and
phone **screenshots** for both stores (6.7" + 5.5" for iOS; phone for Android).

---

## 1. Google OAuth verification (the "app isn't verified" fix)

You need this because the app requests `https://www.googleapis.com/auth/calendar.events`, which Google
classifies as a **sensitive** scope. Until verified you're capped at 100 test users, testers see the
"unverified" warning, and — importantly — **calendar refresh tokens expire after 7 days in "Testing"
mode**, so connected calendars silently stop syncing weekly. Verifying + publishing to Production fixes
all of that.

### 1a. Verify your domain (once)
1. Go to **[Google Search Console](https://search.google.com/search-console)** with the same Google
   account that owns your Cloud project.
2. Add property `fittempo.app` → verify via **DNS TXT record** (add the record at your domain registrar).

### 1b. Configure the OAuth consent screen
Google Cloud Console → your project → **APIs & Services → OAuth consent screen**
(newer projects: **Google Auth Platform → Branding / Audience / Verification**). Enter exactly:

| Field | Value |
|-------|-------|
| User type | External |
| App name | `Tempo` |
| User support email | *your support email* |
| App logo | `brand-assets/google-oauth-logo-120.png` |
| Application home page | `https://fittempo.app` |
| Application privacy policy | `https://fittempo.app/privacy.html` |
| Application terms of service | `https://fittempo.app/terms.html` |
| Authorized domain | `fittempo.app` |
| Developer contact email | *your email* |

### 1c. Confirm the redirect URI (Credentials)
APIs & Services → **Credentials** → your OAuth 2.0 Client ID → **Authorized redirect URIs** must contain
your Supabase callback:
```
https://rtoahppnekykgmjukujm.supabase.co/auth/v1/callback
```
(If you set up the Supabase custom domain in §3, change this to `https://auth.fittempo.app/auth/v1/callback`.)

### 1d. Scopes + justification (paste-ready)
Add these scopes:
```
openid
https://www.googleapis.com/auth/userinfo.email
https://www.googleapis.com/auth/userinfo.profile
https://www.googleapis.com/auth/calendar.events        ← sensitive, needs justification
```
Justification for `calendar.events`:
> Tempo is a workout-planning app. With the user's explicit opt-in, it reads the times of the user's
> Google Calendar events to schedule training sessions around their real commitments, and it adds the
> workouts the user schedules to their calendar. The `calendar.events` scope is the minimum needed to
> read event times and create/update the app's own workout events. Calendar data is used solely for
> this scheduling feature, is never sold, and is never used for advertising.

### 1e. Demo video (required for sensitive scopes)
Record an unlisted YouTube video (~60–90s) showing:
1. The OAuth consent screen with the app name **Tempo** and the domain visible.
2. The user granting the calendar permission.
3. In-app: Profile → Connect Google Calendar, then a scheduled workout appearing on the calendar.
Narrate that calendar access is only used to schedule workouts.

### 1f. Submit
Set **Publishing status → In production**, then **Submit for verification** and attach the video.
Sensitive-scope review typically takes **2–6 weeks**; respond quickly to any follow-ups.

**Until it's approved:** add your email under **Test users** so you can click through the warning.

### 1g. "Additional info" field (paste-ready, ≤1000 chars)
This box caps at **1000 characters**. The text below is 928; swapping in a short `youtu.be/…` link and
your project ID keeps the final under 1000. Replace the two «placeholders»:

```
Tempo (iOS & Android, com.fittempo.app) plans workouts around the user's life. We request one Google scope: calendar.events. With the user's opt-in, it reads their event times to schedule workouts around commitments and creates/updates its own workout events on their primary calendar. We don't touch other calendars, sharing, or settings, so calendar.events (not full calendar) is minimal. The refresh token is stored server-side (Supabase), never on-device, deleted on disconnect/account deletion. Google data is used only for scheduling — never sold, shared, or read by humans — per the Limited Use requirements (see privacy policy). The app is in closed beta (not public); demo video «URL» shows the full consent + sync flow. We can add a reviewer to TestFlight/Play internal or send an APK (fittempo.app@gmail.com). Single Google Cloud project (ID «id»); auth is brokered by Supabase, so the redirect URI is on supabase.co.
```

---

## 2. Apple — App Store Connect "App Privacy" answers

App Store Connect → your app → **App Privacy**. "Do you or your third-party partners collect data?" → **Yes**.

Declare these data types (all **linked to the user's identity**, all purpose **App Functionality**,
none **used for tracking**):

| Data type | Category | Notes |
|-----------|----------|-------|
| Email Address | Contact Info | From Apple/Google sign-in |
| Name | Contact Info | If provided by the sign-in provider |
| Health & Fitness | Health & Fitness | Workouts, sets/reps/weight, body measurements |
| Photos | User Content | Progress photos (only if the user adds them) |
| User ID | Identifiers | Account identifier |
| Coarse/other usage | Usage Data → Product Interaction | **Only if** `EXPO_PUBLIC_POSTHOG_KEY` is set (also purpose: Analytics) |
| Crash Data + Performance Data | Diagnostics | **Only if** `EXPO_PUBLIC_SENTRY_DSN` is set |

**Tracking:** answer **No** — Tempo does not track users across apps/websites or share data with data
brokers, so **no App Tracking Transparency prompt is required**. (If you ever add ad SDKs, revisit this.)

Account deletion: the app has Profile → Delete Account, and the public URL is
`https://fittempo.app/delete-account.html` — reference it if asked.

Apple review note (put in "Notes for Reviewer"): *"You can explore the full app without an account via
'Continue as guest' on the sign-in screen."*

---

## 3. Google Play — "Data safety" answers

Play Console → your app → **App content → Data safety**.

- **Does your app collect or share user data?** → **Yes** (collected; **not shared** with third parties).
- **Is all data encrypted in transit?** → **Yes**.
- **Do you provide a way to request data deletion?** → **Yes** →
  URL `https://fittempo.app/delete-account.html` (and in-app Profile → Delete Account).

Data types to declare (all **Collected**, **Not shared**, purpose **App functionality** unless noted):

| Play data type | Category |
|----------------|----------|
| Email address | Personal info |
| Name | Personal info |
| User IDs | Personal info |
| Health & fitness info | Health and fitness |
| Photos | Photos and videos (progress photos) |
| Calendar events | Calendar — mark collected for App functionality (server can access via the stored Google token) |
| App interactions | App activity — **only if** PostHog is enabled (purpose: Analytics) |
| Crash logs + Diagnostics | App info and performance — **only if** Sentry is enabled |

Also complete: content rating questionnaire (Health & Fitness, no objectionable content → likely
Everyone/PEGI 3), target audience (13+), and the privacy-policy URL `https://fittempo.app/privacy.html`.

---

## 4. The "weird supabase.co URL" during Google sign-in

Supabase is the OAuth broker, so the callback is on `…supabase.co`. Options:
- **Cleanest:** enable a **Supabase custom domain** (Project Settings → General → Custom Domains, paid
  add-on) so the callback becomes `auth.fittempo.app`. Then update the redirect URI in §1c and your
  Supabase site URL. Users only ever see `fittempo.app`.
- **Free:** once the consent screen is branded (name + logo) and verified, it leads with "Tempo" and
  the supabase.co host is a minor detail.
- **Later / biggest win:** switch Google to *native* sign-in (`@react-native-google-signin/google-signin`
  + Supabase `signInWithIdToken`, same pattern as Apple) — native account picker, no browser, no
  supabase.co at all. New dependency + iOS/web client IDs + a rebuild.

---

## 5. Store listing metadata (both stores)
App name **Tempo** · category **Health & Fitness** · short + full description · keywords · app icon
(1024 iOS / 512 Android) · phone screenshots · privacy-policy URL `https://fittempo.app/privacy.html` ·
support email · age rating · the data forms above.

---

## 6. Order of operations
1. Deploy `web/` so `fittempo.app`, `/privacy.html`, `/terms.html`, `/delete-account.html` are all live.
2. Verify `fittempo.app` in Search Console.
3. Configure + submit the OAuth consent screen for verification (long pole — do it early).
4. Add yourself as a Test user so you're unblocked meanwhile.
5. EAS production build → TestFlight / Play internal (new icon, splash, buttons ship here).
6. Fill App Privacy + Data safety using §2/§3.
7. Upload screenshots + metadata, then submit for review.
