# Tempo Pro — Launch Checklist (RevenueCat + App Store Connect)

Everything the **app code** needs is done (see below). This is the list of things only
*you* can do in the dashboards, plus how to turn Pro on for your TestFlight account so you
can make a **real sandbox purchase** and watch it unlock.

---

## ✅ Already handled in code (nothing to do)
- RevenueCat SDK wrapper, entitlement store, live entitlement listener, restore, Customer Center
  (`lib/purchases.ts`, `stores/entitlements.ts`, wired in `app/_layout.tsx`).
- **Custom on-brand paywall** (`app/paywall.tsx`) — reads prices **live** from your current
  offering (nothing hardcoded), auto-computes the annual savings %, shows a free-trial CTA when you
  configure one, Restore, and Terms/Privacy links.
- **Gating layer** — `lib/proFeatures.ts` registry + `components/ProGate.tsx`
  (`<ProGate>` / `ProLockCard` / `ProBadge`).
- **First live gate** — Advanced Analytics on the Progress tab (volume trends + strength-trend
  deep-dive). Free stays fully functional.
- **Dormant flag** — the whole system is inert until `app_config.pro_enabled` says otherwise, so this
  can ship in a build without changing anything for current users.
- iOS API key + entitlement id are in `eas.json` (`preview` + `production`).

---

## 1. RevenueCat dashboard

- [ ] **⚠️ Entitlement identifier must match EXACTLY.** `eas.json` sets
      `EXPO_PUBLIC_PRO_ENTITLEMENT = "Tempo: Fitness Planner Pro"`. The entitlement in RevenueCat
      must have that **exact** identifier (spaces, colon, capitalization). If it differs, purchases
      succeed but never unlock Pro. *(Recommendation: if it's not too late, rename the entitlement to
      a simple `pro` and change the env var to match — short slugs are the convention. Either works as
      long as they're identical.)*
- [ ] **Products** attached to the entitlement: your monthly ($7.99) and annual ($49.99) App Store
      subscription products (import them from App Store Connect once created there — step 2).
- [ ] **Offering** — create one and mark it **current**. The paywall reads `offerings.current`.
- [ ] **Packages** inside that offering — add the monthly product as the **Monthly** package and the
      annual as the **Annual** package (use RevenueCat's standard package types so the paywall's
      `offering.monthly` / `offering.annual` accessors resolve).
- [ ] **API key** — confirm the iOS **public** SDK key (`appl_…`) in the dashboard matches the one in
      `eas.json`. (Android `goog_…` is not set yet — add it when you do Android.)
- [ ] *(Optional, recommended)* **Free trial / intro offer** on the annual product (e.g. 7 days). The
      paywall auto-detects it and the CTA becomes "Start Free Trial". Configure the trial on the App
      Store Connect product; RevenueCat surfaces it.
- [ ] **Customer Center** — enable/configure it (Profile → "manage subscription" opens it for Pro
      users). Optional but recommended.

## 2. App Store Connect

- [ ] **Subscription group** (e.g. "Tempo Pro") — both products live in the same group so they're
      mutually exclusive and upgrade/downgrade cleanly.
- [ ] **Monthly** auto-renewable subscription — product id, $7.99, localized display name +
      description, review screenshot.
- [ ] **Annual** auto-renewable subscription — product id, $49.99, localized display name +
      description, review screenshot.
- [ ] **Pricing** set for your storefront(s); add localizations if you sell internationally.
- [ ] **Review information** — Apple requires the paywall to show Restore + Terms + Privacy (it does),
      and clear renewal/trial terms (the fine print is on the paywall). Fill in the subscription
      review notes + a demo account if asked.
- [ ] **Paid Apps agreement** active in App Store Connect (subscriptions won't load without it).
- [ ] **Sandbox tester** — create one under Users and Access → Sandbox, and sign into it on the
      device (Settings → App Store → Sandbox Account) before testing a purchase.

## 3. Turn Pro on for your test account (so you can buy on TestFlight)

The flag stays **off for everyone else**; only your account sees the paywall/gates. Run in the
Supabase SQL editor (or I can apply it for you once you give me your account's user id):

```sql
-- Make sure the table/row exists (safe to re-run):
insert into app_config (key, value)
values ('pro_enabled', '{"enabled": false, "test_user_ids": []}'::jsonb)
on conflict (key) do nothing;

-- Allow-list just your account:
update app_config
set value = jsonb_set(value, '{test_user_ids}', '["YOUR-USER-UUID"]'::jsonb),
    updated_at = now()
where key = 'pro_enabled';
```

Find your uuid: sign in on the app, then Supabase → Authentication → Users (match your email), or ask
me to look it up.

## 4. Build & test

- [ ] `cd mobile && npx tsc --noEmit` (passes).
- [ ] **EAS build** (RevenueCat is a native module — a JS/OTA update alone won't include it):
      `npx eas build --profile preview --platform ios` (or `production`) → submit to TestFlight.
- [ ] On the TestFlight build, signed into your sandbox account, with your uuid allow-listed:
  - Free path still works end-to-end (create/log/schedule/quick workout) — nothing gated for others.
  - Progress → the **Volume Trends** card shows the Pro lock; tapping a PR / "Search all" opens the paywall.
  - Paywall shows **live** $7.99 / $49.99, the correct savings % (48%), and (if configured) the trial CTA.
  - Buy annual (sandbox) → paywall closes, analytics unlocks instantly.
  - Kill + relaunch → still Pro. Restore Purchases → recovers. (Sandbox subs expire fast — good for
    testing the downgrade → re-lock, which must **not** delete any data.)

## 5. Go live for everyone (when you're happy)

```sql
update app_config set value = jsonb_set(value, '{enabled}', 'true'), updated_at = now()
where key = 'pro_enabled';
```

No rebuild or resubmission needed to flip it — but the **build that contains the native module +
paywall must already be in users' hands** (i.e. shipped through TestFlight/App Store first).

---

## Notes / decisions baked in
- **Model:** Depth & horizon — free is fully functional forever; Pro sells depth/foresight, not a
  crippled free tier. The engine (plan generation, adaptation, quick workouts, logging, scheduling)
  is never gated.
- **Downgrade never deletes data** — gating controls access, not storage.
- **Fast-follow Pro surfaces** (each is a `<ProGate>` wrap + a `PAYWALL_POINTS` entry, shippable via
  `eas update` with no rebuild): smart scheduling optimization, muscle-group analysis + PR
  forecasting, long-horizon/goal-date planning, premium themes + app icons, and **Tempo Coach**.
