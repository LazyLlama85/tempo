# Tempo Pro — Setup Guide (App Store Connect + RevenueCat)

> **Goal:** take Tempo Pro from *built-but-dormant* to *live and purchasable*, with a **7-day free
> trial** on the annual plan. Everything in the app is already coded (paywall, gates, free-tier caps,
> entitlement wiring). This is the store + dashboard + flip-the-flag runbook. Follow it top to bottom.
>
> **Companion files:** `MONETIZATION_PLAN.md` (what/why), `PRO_LAUNCH_CHECKLIST.md` (earlier
> checklist), `ARCHITECTURE.md` (§ Pro), `mobile/src/lib/purchases.ts` + `proConfig.ts` (the code).

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

| Plan | Product ID (suggested) | Price | Duration |
|---|---|---|---|
| Annual | `tempo_pro_annual` | **$34.99** | 1 Year |
| Monthly | `tempo_pro_monthly` | **$4.99** | 1 Month |

For **each** subscription fill in:
- **Reference Name** (internal): e.g. "Tempo Pro Annual".
- **Subscription Duration** + **Price** (pick the price tier, all territories).
- **Localization** (App Store Display Name + Description) — e.g. Display Name "Tempo Pro (Annual)",
  Description "Unlimited custom plans, workouts & exercises, one-tap reschedule-my-week, multi-calendar
  scheduling, travel mode, and premium themes."
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
- Subscriptions can be submitted **with a new app version**. They stay "Ready to Submit" until then.

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

### B4. Import the products + attach to the entitlement
- RevenueCat → **Products → + New / Import** → import `tempo_pro_annual`, `tempo_pro_monthly` (and
  `tempo_pro_lifetime` if created) from App Store Connect.
- Open each product → **attach it to the `Tempo: Fitness Planner Pro` entitlement.** All three grant
  the same entitlement.

### B5. Create the Offering (this is what the paywall reads)
RevenueCat → **Offerings → New** (make it the **Current** offering):
- **Identifier:** `default` (any name; "current" is what matters).
- Add **Packages** — use RevenueCat's standard package identifiers so the app's `offering.annual` /
  `offering.monthly` accessors light up:
  | Package | Identifier | Product |
  |---|---|---|
  | Annual | `$rc_annual` | `tempo_pro_annual` |
  | Monthly | `$rc_monthly` | `tempo_pro_monthly` |
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

### C3. Build + install via TestFlight
RevenueCat is a **native module** — an OTA update won't pick up a first-time config. Build and ship to
TestFlight:
```
cd mobile
npx eas build --profile production --platform ios   # or a preview profile
```
Then install that build from TestFlight on a real device (StoreKit/sandbox doesn't work in the
simulator or Expo Go).

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
