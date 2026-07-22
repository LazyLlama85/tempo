# Tempo Pro — Setup Guide (App Store Connect + RevenueCat)

> **Goal:** take Tempo Pro from *built-but-dormant* to *live and purchasable*, with a **7-day free
> trial** on the annual plan. Everything in the app is already coded (paywall, gates, free-tier caps,
> entitlement wiring). This is the store + dashboard + flip-the-flag runbook. Follow it top to bottom.
>
> **Companion files:** `MONETIZATION_PLAN.md` (what/why), `PRO_LAUNCH_CHECKLIST.md` (earlier
> checklist), `ARCHITECTURE.md` (§ Pro), `mobile/src/lib/purchases.ts` + `proConfig.ts` (the code).

> **✅ STATUS (audited live 2026-07-18 — most of this is already DONE):**
> - **RevenueCat:** entitlement `Tempo: Fitness Planner Pro` (exact match ✓), real products
>   **`tempo_pro_month`** + **`tempo_pro_year`** attached, current offering **`default`** wires
>   `$rc_monthly`→month and `$rc_annual`→year, In-App-Purchase Key + App-Store-Connect API key both
>   "Valid credentials". **Complete.**
> - **App Store Connect:** subscription group *Tempo Pro* with Monthly **$7.99** + Yearly **$49.99**
>   (all 175 territories), localizations + review screenshots present, and the **7-day free trial**
>   (Introductory Offer → Free for the first week, all territories) is **live on the annual plan**.
>   **Complete.**
> - **Supabase:** `app_config.pro_enabled` configured; the founder's uid is in `test_user_ids`
>   (`tester_tools: true`) → Pro is live for their account only. **Complete.**
> - **⛔ REMAINING (founder-only, blocks go-live):** (1) **Paid Apps Agreement** is *Pending User Info*
>   — add a bank account + tax info under Business → Agreements; until it's **Active, no purchase
>   works**. (2) **Submit an app version with the subscriptions attached** (see §C3–C4) — for App
>   Review to approve them and reach the paywall.
> The rest of this doc is the reference for how each piece was set up (and how to redo/verify it).

---

## 0. How Tempo's Pro system works (read first — it explains every step)

Three facts drive the whole thing:

1. **A remote "dormant" flag** (`app_config` row `pro_enabled`, read by `lib/proConfig.ts`). While it's
   off, Pro is completely inert — no paywall, no gates, no caps. You flip it on with one SQL update,
   **no new build required**. You can flip it on for *just your account* first.
2. **One entitlement** unlocks everything. Its identifier is set in `mobile/eas.json` as
   `EXPO_PUBLIC_PRO_ENTITLEMENT` = **`Tempo: Fitness Planner Pro`**. ⚠️ **This string must match the
   RevenueCat entitlement identifier EXACTLY**, or purchases will succeed but never unlock Pro.
3. **The app is offering-agnostic.** No product IDs or prices are hardcoded. The paywall renders
   whatever the RevenueCat *current* offering contains (annual/monthly/lifetime, prices, and the free
   trial). So you configure everything in the dashboards — the app just reflects it.

The iOS RevenueCat public key is already in `eas.json`: `appl_GkKqdQbhrRmYuPsFcquklZsSJOf`.

**Order of operations:** App Store Connect (create the products) → RevenueCat (wire them to the
entitlement + offering) → flip the flag for yourself → TestFlight sandbox-test → flip it on for
everyone.

---

## Part A — App Store Connect (create the subscriptions + the free trial)

### A1. Prerequisites (do these once)
- **Agreements, Tax, and Banking** → the **Paid Apps** agreement must be **Active** (Apple won't show
  any IAP until it is). App Store Connect → Business → Agreements.
- The Tempo app record must exist (it does — it's in TestFlight).
- Have your **App-Specific Shared Secret** ready (App Store Connect → your app → App Information →
  "App-Specific Shared Secret", or the newer **In-App Purchase Key** under Users and Access → Keys →
  In-App Purchase). RevenueCat needs one of these in Part B.

### A2. Create a Subscription Group
App Store Connect → your app → **Monetization → Subscriptions → Create** a Subscription Group.
- **Reference Name:** `Tempo Pro` (internal only).
- A group means the annual and monthly plans are mutually exclusive and users can upgrade/downgrade
  between them cleanly. Put **both** plans in the **same** group.

### A3. Create the two auto-renewable subscriptions
Inside the group, **Create** each of these:

| Plan | Product ID (as actually created) | Price | Duration |
|---|---|---|---|
| Annual | `tempo_pro_year` | **$49.99** | 1 Year |
| Monthly | `tempo_pro_month` | **$7.99** | 1 Month |

> **Price changed 2026-07-22** (was $34.99 / $4.99). See "Changing prices later" at the end of
> Part D2 — **there is nothing to change in RevenueCat or in the app** when a price moves.

For **each** subscription fill in:
- **Reference Name** (internal): e.g. "Tempo Pro Annual".
- **Subscription Duration** + **Price** (pick the price tier, all territories).
- **Localization** (App Store Display Name + Description). ⚠️ The Description field caps at **~55
  characters**, so keep it tight and *accurate* (Apple rejects over-claims). What's live now:
  Display Name "Tempo Pro (Yearly)" / "Tempo Pro (Monthly)", Description
  **"Unlimited custom plans, workouts & smart scheduling."** (Do NOT advertise unbuilt features like
  "AI coaching" or free ones like "photos".)
- **Review Information:** a screenshot of the Tempo paywall + a note ("Subscription unlocks Tempo Pro
  features; see review notes"). Apple requires a paywall screenshot per product.

### A4. Add the **7-day free trial** (Introductory Offer)
On the **Annual** subscription → **Subscription Prices** / **Introductory Offers → Create**:
- **Type:** Free Trial
- **Duration:** **1 week (7 days)**
- **Territories:** All
- Eligibility: new subscribers (Apple default).

> The app reads this automatically: `trialLabel()` in `paywall.tsx` turns any $0 intro offer into
> "7-days free" and the CTA becomes **"Start Free Trial"**. You do **not** touch app code to enable
> the trial — configuring it here is enough. (Optional: add a shorter intro/trial on Monthly too;
> most apps trial only the annual to push annual.)

### A5. (Optional) Lifetime — a Non-Consumable IAP
If you decide to offer lifetime (see `MONETIZATION_PLAN.md` §5): Monetization → **In-App Purchases →
Create → Non-Consumable**, product ID `tempo_pro_lifetime`, price ~**$79.99–$99.99**. You can add this
later without touching app code.

### A6. Required app metadata (before submitting for review)
- Your app's **privacy policy URL** and **terms (EULA)** — Tempo links to `/legal` in-app; make sure
  the App Store Connect fields are filled too. Apple requires functional Terms + Privacy links on any
  subscription app.
- The first subscription **must be submitted WITH an app version** — it can't be submitted standalone.
  See §C3–C4 for the (build → attach → add subscriptions → submit) flow, including the fact that you
  probably **don't need a fresh EAS build**.

---

## Part B — RevenueCat (wire the products to the entitlement)

### B1. Project + app
- Create/confirm a RevenueCat **project** for Tempo. Add an **App** → platform **App Store**.
- Enter the **bundle identifier** (must match `mobile/app.json` → `ios.bundleIdentifier`).
- Paste the **App-Specific Shared Secret / In-App Purchase Key** from Part A1 (this lets RevenueCat
  validate receipts).

### B2. API keys (confirm, don't change)
- RevenueCat → API keys → the **public** Apple SDK key should be
  **`appl_GkKqdQbhrRmYuPsFcquklZsSJOf`** (already in `eas.json`). If RevenueCat shows a *different*
  key for this app, update `EXPO_PUBLIC_REVENUECAT_KEY` (and/or `EXPO_PUBLIC_REVENUECAT_IOS_KEY`) in
  `eas.json` to match, and rebuild.

### B3. Create the entitlement — **exact identifier**
RevenueCat → **Entitlements → New**:
- **Identifier:** `Tempo: Fitness Planner Pro`  ← **must be byte-for-byte identical** to
  `EXPO_PUBLIC_PRO_ENTITLEMENT` in `eas.json`. Copy-paste it. This is the #1 thing that silently
  breaks Pro if it's off by a character.

### B4. Import the products + attach to the entitlement *(done)*
- RevenueCat → **Products → + New / Import** → import `tempo_pro_year`, `tempo_pro_month` (and
  `tempo_pro_lifetime` if you add one) from App Store Connect.
- Open each product → **attach it to the `Tempo: Fitness Planner Pro` entitlement.** They all grant
  the same entitlement. *(Note: two old "Test Store" products — `monthly`/`yearly` — are also attached
  from early testing; harmless in production, delete anytime.)*

### B5. Create the Offering (this is what the paywall reads) *(done)*
RevenueCat → **Offerings** — the **Current** offering is **`default`** (marked with the check).
- Its packages use RevenueCat's standard identifiers so the app's `offering.annual` /
  `offering.monthly` accessors light up:
  | Package | Identifier | Product |
  |---|---|---|
  | Annual | `$rc_annual` | `tempo_pro_year` |
  | Monthly | `$rc_monthly` | `tempo_pro_month` |
- *(Cleanup: there's a stray unused offering literally named `offerings.current` — it is NOT the
  current one and can be deleted to avoid confusion. The SDK's `getOfferings().current` returns
  whatever is flagged Current in the dashboard — i.e. `default` — not an offering named that.)*
  | Lifetime (optional) | `$rc_lifetime` | `tempo_pro_lifetime` |
- **Set this offering as Current.** `paywall.tsx` reads `offerings.current` and shows the annual as the
  default-selected best-value option automatically, computes the savings %, and shows the trial.

> You do **not** need to build a RevenueCat-hosted paywall — Tempo ships its own custom on-brand
> paywall (`app/paywall.tsx`). RevenueCat is only the billing/entitlement engine here.

---

## Part C — Turn Pro on in the app (staged: you first, then everyone)

### C1. Make sure `app_config` exists
Apply `mobile/supabase/add_app_config.sql` to the live project if it isn't already (Supabase SQL
editor, or MCP `apply_migration`). It creates the `app_config` table + the dormant `pro_enabled` row.

### C2. Flip it on **for your account only** (private test)
Run this in the Supabase SQL editor — replace the UUID with your own `auth.users` id:

```sql
-- Pro system LIVE for just your account (everyone else stays free).
update app_config
set value = jsonb_build_object(
  'enabled', false,                       -- still OFF for the public
  'test_user_ids', jsonb_build_array('YOUR-AUTH-UUID-HERE'),  -- paywall live for you
  'pro_user_ids', jsonb_build_array(),    -- (comp list — grant Pro without paying)
  'tester_tools', true                    -- shows the in-app Pro on/off switch (Profile → Tester Tools)
)
where key = 'pro_enabled';
```

With `test_user_ids` set, **your** account sees the real paywall + gates + caps; everyone else is
unchanged. `tester_tools: true` also gives you an in-app Pro on/off toggle (Profile → Tester Tools) so
you can flip between the free and Pro experience without buying.

### C3. Get a build with the RevenueCat module (you probably ALREADY have one)
RevenueCat is a **native module**, so it must be compiled into a build — but **that's already true of
your existing TestFlight builds** (RevenueCat is reporting live SDK usage from them). Everything added
since (paywall, free-tier caps, multi-calendar scope) is **JavaScript-only** and ships **over-the-air**:
```
cd mobile
npx eas update --branch production      # pushes latest JS to existing builds — does NOT use build quota
```
Only cut a **fresh native build** if you changed native config/plugins:
```
npx eas build --profile production --platform ios
```
> **Out of free EAS builds?** You most likely don't need one for Pro. If you truly do: `eas build
> --local` needs **macOS + Xcode** (won't run on Windows), so either wait for the monthly quota to
> reset, buy on-demand builds / upgrade at **expo.dev/pricing**, or build on a Mac (`expo prebuild` →
> Xcode Archive).

Install/test on a **real device** (StoreKit/sandbox doesn't work in the simulator or Expo Go).

### C3b. Submit the app version WITH the subscriptions (required for Apple to approve them)
The build alone does **not** submit the subscriptions, and the first subscription can't be submitted
on its own. In App Store Connect:
1. Open the **1.0 app version** → select a build for it (an existing TestFlight build is fine).
2. Add the two subscriptions to the submission — the **"Add for Review"** button on the *Tempo Pro*
   subscription group, or the version's **In-App Purchases and Subscriptions** section.
3. **Submit** — the app + subscriptions are reviewed together.
> ⚠️ The App Review tester must be able to **reach the paywall**. While Pro is dormant (only your uid
> in `test_user_ids`) a reviewer can't find the purchase → likely rejection. Before submitting, either
> flip `pro_enabled → enabled: true` (§C5) so the paywall is reachable, or add reviewer notes with
> exact steps to trigger it (e.g. "create a 2nd custom plan to see the paywall").

### C4. Sandbox-test everything
On the device, signed into a **Sandbox Apple ID** (Settings → App Store → Sandbox Account):
- [ ] Paywall loads with **Annual (7-days free)** + Monthly, correct prices, savings %.
- [ ] **Start Free Trial** → completes → Pro unlocks instantly; gated features open.
- [ ] Each **free-tier cap** shows the paywall at the right moment (as a free/test user):
  create a **2nd custom plan**, a **6th custom exercise**, a **6th saved workout** → paywall.
  Editing existing ones is **never** blocked; logging/adaptive-plan/library are **never** blocked.
- [ ] **Reschedule-my-week**, **multi-calendar picker**, **travel mode** show the paywall when locked.
- [ ] **Restore** works on a fresh install with the same Apple ID.
- [ ] Cancel from the App Store → entitlement drops on next refresh.

### C5. Public launch
When you're happy, flip the global switch:
```sql
update app_config
set value = jsonb_set(
  jsonb_set(value, '{enabled}', 'true'),   -- Pro LIVE for everyone
  '{tester_tools}', 'false'                -- hide the tester toggle from the public
)
where key = 'pro_enabled';
```
No rebuild needed for the flip itself — it's read on app open. (A build *was* needed once, in C3, to
get the native module onto devices.)

---

## Part D — Pricing changes later (zero code)
Because the app is offering-agnostic, changing price, swapping the trial length, or adding lifetime is
a **dashboard-only** change: edit the price/intro offer in App Store Connect, and RevenueCat + the
paywall reflect it on next launch. Revisit pricing the day Tempo Coach ships (see `MONETIZATION_PLAN.md`
§5's note).

---

## Part D2 — Android / Google Play (all founder-only; audited 2026-07-18)

The app is `com.fittempo.app` on Play (name "Tempo: Fitness Scheduling"), in **Closed testing**. The
same RevenueCat entitlement + offering serve Android. Progress as of 2026-07-18:

1. **✅ Google Play merchant account — DONE** (founder). The *Monetize with Play* page no longer shows
   the "set up a merchant account" block.
2. **✅ Play subscriptions created + activated** (2026-07-18, **repriced 2026-07-22**):
   `tempo_pro_month` → monthly base plan **$7.99**; `tempo_pro_year` → yearly base plan **$49.99**
   **+ a `free-trial` offer** (Free trial phase, **1 week**, eligibility "New customer acquisition →
   Never had any subscription" — one trial per user, matching iOS). Prices auto-converted to all
   174–177 regions.
3. **⛔ RevenueCat → Play Store app → Service account credentials JSON — STILL EMPTY (do this next).**
   Without it RevenueCat can't validate Android purchases *and can't even import the Play products*.
   **This is the only thing blocking Android.** Full walkthrough in **D2.1** below.
4. **RevenueCat wiring** (after 3): import `tempo_pro_month:monthly` / `tempo_pro_year:yearly` (Play
   products are `subscriptionId:basePlanId`), **attach both to the `Tempo: Fitness Planner Pro`
   entitlement**, and add them to the **`default` offering**'s `$rc_monthly` / `$rc_annual` packages
   (so each package holds *both* the App Store and Play product). *(I can do this once the credential
   is set — same as I did the iOS wiring.)*
5. **Android SDK key — DONE (verify):** `EXPO_PUBLIC_REVENUECAT_ANDROID_KEY` is now in `eas.json`
   (`goog_oxlGATTCFaOSINDjTcKnkPbPBSp`). ⚠️ **Verify this matches RevenueCat → Apps → Play Store → Public
   API Key exactly** — it was read off-screen; a single wrong character silently breaks Android purchases
   (same class of failure as the entitlement id). `purchases.ts` already uses this key on Android.
6. **Build + test:** Android builds **can** be done on Windows (`eas build --profile production
   --platform android`, or `--local`), unlike iOS. Test purchases on the **Closed testing** track with a
   **License tester** account (Play Console → Setup → License testing) — no need to go to production.

The `pro_enabled` flag and the paywall/caps code are already cross-platform — once step 3 (credential)
+ step 4 (wiring) are done and an Android build ships, Pro works on Android identically to iOS.

---

### D2.1 — Google Play service-account credentials (the step 3 walkthrough)

Founder-only; ~15 minutes of clicking, then **up to 36 hours of waiting**. Start it early — the wait
is the long pole on Android, not the setup.

You are creating a robot Google account that RevenueCat uses to ask Play "is this purchase real, and
is it still active?" It lives in **Google Cloud Console** (the project behind your Play account) and
is then *invited into* **Play Console** like a team member.

**Step 1 — Enable three APIs.** Google Cloud Console → make sure you're in the project linked to your
Play developer account → **APIs & Services → Library**, and Enable each:
- **Google Play Android Developer API** (a.k.a. Android Publisher API) — purchase validation.
- **Google Play Developer Reporting API** — reporting.
- **Cloud Pub/Sub API** — real-time developer notifications (renewals, cancellations, refunds
  reaching RevenueCat without polling). **Easy to forget, and the most common cause of "renewals
  don't show up."**

Each shows **Manage** instead of **Enable** once it's on.

**Step 2 — Create the service account.** Cloud Console → **IAM & Admin → Service Accounts → Create
service account**. Name it something obvious like `revenuecat`. **Create and continue.**

**Step 3 — Grant it two roles** (on the "Grant this service account access to project" step):
- **Pub/Sub Editor** — lets it receive Play's notifications. *(If you later hit permission errors,
  Pub/Sub Admin is the documented fallback.)*
- **Monitoring Viewer** — lets RevenueCat monitor the notification queue.

Skip the optional third step → **Done**.

**Step 4 — Create the JSON key.** In the Service Accounts list, the **⋮** menu on your new account →
**Manage keys → Add key → Create new key → JSON** → it downloads immediately.
⚠️ **This file is a credential — treat it like a password.** Do **not** commit it to this repo, do not
put it in `mobile/`, do not paste it into a chat. Upload it to RevenueCat, then delete the download.
Google auto-disables service accounts whose keys it detects as leaked.

**Step 5 — Invite the service account into Play Console.** Play Console → **Users and permissions →
Invite new user** → paste the service account's **email address** (it looks like
`revenuecat@your-project.iam.gserviceaccount.com`, visible in the Service Accounts list).
- Under **App permissions**, add **Tempo** (`com.fittempo.app`).
- Grant these **Account permissions**:
  - **View app information and download bulk reports** (read-only)
  - **View financial data, orders, and cancellation survey responses**
  - **Manage orders and subscriptions**
- **Invite user.**

**Step 6 — Upload to RevenueCat.** RevenueCat → **Project Settings → Apps → your Play Store app** →
**Service Account Credentials JSON** → upload the file → Save.

**Step 7 — Wait, then verify.** Google's docs say **up to 36 hours** for the credential to start
working. Until then RevenueCat may show a validation error (503/521) — that is expected, not a
mistake you made. Documented accelerant: open Play Console → **Monetize → Subscriptions**, make a
trivial edit to a product description and save it; that sometimes nudges validation through sooner.

**When it's working**, RevenueCat can import the Play products, and you can do step 4 of D2 above
(attach `tempo_pro_month:monthly` / `tempo_pro_year:yearly` to the `Tempo: Fitness Planner Pro`
entitlement and add them to the `default` offering's existing `$rc_monthly` / `$rc_annual` packages,
so each package holds *both* the App Store and the Play product).

**If it doesn't work after 36 hours**, check in this order — these are the documented failure modes:
1. Was **Cloud Pub/Sub API** actually enabled? (Step 1, third one.)
2. Are all **three** Play Console account permissions granted? (Step 5.)
3. Is the uploaded JSON the right file, from the right project?
4. Has a **signed AAB/APK ever been uploaded** to this Play app? Play won't serve the API for an app
   with no release. *(Tempo is in Closed testing, so this one is satisfied.)*
5. Was the service account auto-disabled? (Cloud Console → Service Accounts → check it's enabled.)

---

### Changing prices later (e.g. the 2026-07-22 move to $7.99 / $49.99)

**There is nothing to do in RevenueCat, and nothing to do in the app.** This is worth stating plainly
because it looks like it should require work:

- **Prices come from the stores, not from RevenueCat.** The SDK reads the live product from StoreKit
  (iOS) / Billing Client (Android) on the device. RevenueCat maps products to entitlements; it does
  not store the price you charge.
- **The app hardcodes no prices.** `app/paywall.tsx` renders `product.priceString`,
  `pricePerMonthString`, and an auto-computed savings % straight from the current offering. At
  $7.99 / $49.99 the paywall will show **$4.17/mo billed yearly** and a **SAVE 48%** badge with no
  code change. (It also updates over the air — even the layout ships via `eas update`.)
- **The 7-day free trial is unaffected** — it's an Introductory Offer (iOS) / offer phase (Play)
  attached to the annual product, independent of the base price.

What to actually verify after a reprice:
- [ ] **App Store Connect** → each subscription shows the new price as *current*, all territories.
      There is no existing paying cohort, so "preserve prices for existing subscribers" is moot —
      apply to everyone.
- [ ] **Play Console** → each base plan shows the new price and is still **Active**. Play treats a
      base plan's **ID and billing period as immutable** once created; price is editable, but if the
      console won't let you change it, the fallback is a **new base plan** at the new price with the
      old one deactivated — in which case the RevenueCat product id changes
      (`tempo_pro_year:<new-base-plan-id>`) and the offering must be re-pointed at it.
- [ ] **RevenueCat → Offerings → `default`** still shows both packages resolving to a product, with
      the new price displayed. If RevenueCat shows a stale price, it's a cache — it refreshes from
      the stores; the *device* is the source of truth for what the user is charged.
- [ ] Open the paywall on a real device and confirm the price, the `/mo` line, and the savings badge.

---

## Part E — Gotchas checklist
- [ ] **Entitlement identifier** in RevenueCat is *exactly* `Tempo: Fitness Planner Pro` (Part B3).
      This is the most common silent failure.
- [ ] **Paid Apps agreement** is Active (Part A1) — without it, no products appear.
- [ ] The RevenueCat **iOS key matches `eas.json`** (`appl_GkKq…`), else the SDK can't reach RevenueCat.
- [ ] Offering is set as **Current** and its packages use `$rc_annual` / `$rc_monthly` identifiers.
- [ ] The **free trial** is an **Introductory Offer** on the annual product (Part A4) — the app shows
      it automatically; nothing to code.
- [ ] Test on a **real device** from **TestFlight** with a **Sandbox Apple ID** — never the simulator.
- [ ] Each product has a **paywall screenshot** in its Review Information (Apple rejects otherwise).
- [ ] Terms + Privacy URLs are set in App Store Connect (subscription apps require them).
- [ ] After launch, `tester_tools` is `false` so the public never sees the in-app Pro override.
- [ ] **Android (Part D2):** merchant account set up, Play subscriptions created, RevenueCat service-
      account credential uploaded, Play products attached to the entitlement + offering, and the
      `goog_` key in `eas.json` verified. All still open.
