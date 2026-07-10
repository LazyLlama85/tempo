# Tempo — Full System Audit (2026-07-09)

Lead-PM / design / QA / engineering pass over every system. Each finding is tagged:
- **[FIXED-NOW]** — implemented in the `expansion/audit-round-2` branch (this round).
- **[DESIGNED]** — architecture decided + documented below; deliberately not built yet.
- **[WATCH]** — acceptable today; revisit at a stated trigger.

---

## 1. Identity & friend discovery

| Finding | Severity | Status |
|---|---|---|
| **Duplicate display names are ambiguous.** Search returns two "Jacob"s with identical rows — nothing tells you which to add. | High | **[FIXED-NOW]** — unique `@username` shown under every name in search/friends/profile |
| No stable public identity: display_name is editable free text, not unique | High | **[FIXED-NOW]** — `username` column (unique, `a–z 0–9 _`, 3–20), auto-generated for existing users, editable in Profile |
| No out-of-band way to add a specific person (gym buddy standing next to you) | High | **[FIXED-NOW]** — per-user **friend code** (`T8P4XK` style), shown with copy/share on the Friends screen; pasting a code in search finds exactly that person |
| QR code add | Med | **[DESIGNED]** — render: `react-native-qrcode-svg` (+`react-native-svg`, native rebuild); scan: `expo-camera`. Payload = `tempo://add/<friend_code>`. Deferred: two native modules for a flow the friend code already covers; build when social usage justifies it |
| Users with no display_name are unsearchable | Med | **[FIXED-NOW]** — every user now has a username + friend code regardless of display name |
| No block/report; declined requesters can re-request forever | Med | **[WATCH]** — friends-only surface area (no comments/DMs) keeps abuse potential low. Trigger: any user report, or before public profiles. Schema is ready (a `status='blocked'` value + policy filter) |

## 2. Friend profiles & social depth

| Finding | Severity | Status |
|---|---|---|
| Profile too thin (3 stats + 5 sessions) | High | **[FIXED-NOW]** — adds longest streak, this-week/this-month counts, total volume, favorite muscle group, account age, active goal; all inside the existing privacy gates |
| No activity feed — friends are invisible unless you open their profile | High | **[FIXED-NOW]** — feed on Friends screen: "X completed Push Day · 2h ago" from accepted friends (privacy_activity-gated RPC) |
| PRs not surfaced socially | Med | **[DESIGNED]** — PR detection is client-side (`lib/prs`) at completion time; correct architecture is an `activity_events` table written at workout-complete (type: `workout|pr|streak|level`), feed reads events instead of recomputing. Deferred until feed usage proves out; current feed derives from `scheduled_workouts` so it needed zero new writes |
| Likes / comments / saves on workouts | Med | **[DESIGNED]** — future `activity_reactions (event_id, user_id, kind)` on top of `activity_events`; comments deliberately last (moderation cost). Do **likes before comments** |
| Leaderboards / challenges | Med | **[FIXED-NOW (leaderboard)]** — friends-only weekly leaderboard (workouts this week, privacy-gated, only visible participants). **[DESIGNED (challenges)]** — weekly challenge = `challenges` table (metric: sessions/volume/minutes, week window) + auto-enrolled friends; needs activity_events for cheap scoring. Friends-only by design; no global boards (toxicity) |

## 3. Sharing

| Finding | Severity | Status |
|---|---|---|
| Share preview lacks context (difficulty/equipment/goal/duration) | Med | **[FIXED-NOW]** — share snapshot now carries equipment summary + est duration + exercise count; preview renders them as chips |
| Can't share a whole split/program | High | **[FIXED-NOW]** — `workout_shares.kind='split'` + `days` jsonb; share from My Splits; import recreates the split (and its day workouts) under the recipient's account with attribution |
| Share rows accumulate forever | Low | **[WATCH]** — snapshot rows are tiny; add a 1-year TTL sweep if volume ever matters |
| Shared link requires sign-in (no web preview) | Med | **[DESIGNED]** — `web/` can render a public share page from `workout_shares` via anon read policy scoped to `code =` param. Needs universal links (apple-app-site-association) — same work that makes `tempo.app/w/x` open the app |

## 4. Split system

| Finding | Severity | Status |
|---|---|---|
| Editing an active split doesn't restamp already-materialized future weeks | High | **[FIXED-NOW]** — saving an *active* split now retires its future materialized sessions and re-materializes, so edits actually reach the calendar |
| "Edit this day vs all future weeks" versioning | Med | **[DESIGNED]** — one-off day change = `edit-session` on the scheduled row (exists); "all future weeks" = the split-editor path above. The two entry points now cover both intents; true versioning (history of split revisions) is not worth the complexity |
| Multiple active schedules (school/summer/travel split) | Med | **[WATCH]** — architecture already supports N saved splits with 1 active (cheap switching). A "scheduled activation" (activate X on date D) is a small future feature: `splits.activate_on date` + app-open check |

## 5. Workout runner (gym reality)

| Finding | Severity | Status |
|---|---|---|
| Machine occupied → only option was Swap | High | **[FIXED-NOW]** — per-exercise ⋯ menu: **Swap** (equipment-aware substitute), **Move to end** (do it later), **Skip today** (removes from session, plan untouched) |
| Can't reorder exercises mid-workout | High | **[FIXED-NOW]** — move up/down in the per-exercise menu (list reorders with LayoutAnimation; persisted to the scheduled row) |
| No workout notes ("bench felt heavy") | High | **[FIXED-NOW]** — session note button in the runner → saved to `workout_logs.notes`; shown in session-detail |
| No warm-up sets — warm-ups pollute PREV/progression/volume | High | **[FIXED-NOW]** — `set_logs.is_warmup` column; "+ Warm-up" adds W-tagged sets excluded from progression history, PREV, and volume/PR math |
| First-workout guidance (tooltips/walkthrough) | Med | **[FIXED-NOW]** — one-time coach overlay on the first live session (logs ✓ / rest timer / pause explained); dismissible, never returns (localStorage flag) |
| Per-exercise notes | Low | **[WATCH]** — session note + existing exercise swap memory covers most; add `exercise_notes (user_id, exercise_id, note)` if requested |

## 6. Calendar & scheduling

| Finding | Severity | Status |
|---|---|---|
| Late workout (5 PM plan, 8 PM start) | — | **Verified OK** — missed sweep only fires when `planned_date < today`; same-day starts always work, reminders are best-effort |
| When does "missed" happen? | — | **Verified**: midnight local, on next app open. Reasonable default. **[WATCH]** user-configurable grace (e.g. "give me until noon next day") — only if users complain |
| Vacation / pause plan | High | **[DESIGNED]** — chosen design: "Pause plan for N days" = shift every future `status='scheduled'` plan/split row's `planned_date` by +N (one UPDATE via RPC), cancel+resync calendar events/reminders, and suppress the missed sweep during the window (profile `paused_until date`). Preserves progression (week_index untouched — the mesocycle resumes where it left off). Travel mode already covers "away but training". Deferred this round: touches calendar-sync + dedupe + missed sweep + streak simultaneously — needs its own careful pass, not a drive-by |
| Timezone changes mid-plan | Low | **[WATCH]** — dates are device-local strings; a flight across midnight can double/skip a day edge-case. Known, rare, self-heals next day |

## 7. Retention & motivation

| Finding | Severity | Status |
|---|---|---|
| Server retention pushes exist (missed/streak/gap/reactivation) | — | Verified in `retention-push` (hourly cron) |
| Returning-user moments in-app (3/7/14/30-day absences) | Med | **[DESIGNED]** — client knows `last completed_at`; Home should swap its hero: 3d "pick up where you left off", 7d "fresh start — want a lighter week?" (one-tap recovery mode via existing `adaptation_mode`), 30d re-onboarding lite. Uses only existing data; a Home-screen pass, scheduled next round |
| Personalized encouragement engine | Med | **[DESIGNED]** — the inputs already exist (streak, weekly target, PRs, friends' activity, adaptation state). Right shape: a ranked "one true sentence" selector like workout-complete's `lead` — reuse that pattern on Home rather than inventing a new system |
| Milestones (10/50/100 workouts…) | Med | **Partially exists** (`lib/achievements` levels + unlockables). **[WATCH]** — surface achievement unlocks as celebration moments (currently passive) |

## 8. Onboarding

| Finding | Severity | Status |
|---|---|---|
| Goal step lacks expectation-setting ("Build muscle → 3–5 sessions/wk") | Low-Med | **[DESIGNED]** — copy-only change to `onboarding/goal.tsx`; queued next UI pass to avoid churning onboarding twice in one week |
| First-session guidance | Med | **[FIXED-NOW]** — see runner coach overlay above |
| Username capture at onboarding | Med | **[FIXED-NOW]** — auto-generated at first need; editable in Profile. Deliberately NOT a new onboarding step (each step costs conversion) |

## 9. Body progress

| Finding | Severity | Status |
|---|---|---|
| Photos attach to measurements but have no timeline / compare | Med | **[DESIGNED]** — data model already correct (`body_measurements.photo_url` time series). Screen = grid timeline + 2-up compare slider reading `fetchMeasurements`. Pure-UI feature, no backend; scheduled next round (this round prioritized social + runner) |
| Weight trend exists (least-squares + rolling avg) | — | Verified OK |

## 10. Notifications audit

Current inventory — every one has a purpose and an owner:
- Pre-workout reminder (local, user-toggleable) ✅
- Rest-done (local, only during an active rest) ✅
- Server: missed-workout nudge, streak-at-risk (rest-day-aware), weekly report, free-time gap, reactivation — all rule-gated + logged in `notification_log`, dead tokens disabled ✅
- **[WATCH]**: friend request / request accepted push — worth adding to `retention-push`'s rule set once social usage exists (needs a `friendships` trigger or poll in the hourly run). No other additions; anything unranked = spam.

## 11. Apple Health / Google Fit

**[DESIGNED]** — do not build until store-ready need: requires dev-build native modules
(`expo-health-connect` / HealthKit via `@kingstinct/react-native-healthkit` or `expo-apple-health`… landscape moves fast — re-verify at build time).
Architecture decided now so nothing needs re-modeling later:
- **Export (first)**: on workout-complete write a HealthKit/Health Connect workout sample (duration, calories estimated from volume+bodyweight). One-way, no consent complexity beyond the OS prompt.
- **Import weight**: HealthKit weight samples → `body_measurements` rows (source-tagged column `source text default 'manual'` to avoid feedback loops).
- Steps/calories import: skip — not core to the product loop.

## 12. Performance audit

- **Scale test data:** seeded-in-thought against 500 workouts / 10-yr history:
  - `plan.tsx` PREV/history query: `set_logs .in(exercise_ids) order completed_at desc` — **unbounded**; 10 years ≈ tens of thousands of rows. **[FIXED-NOW]** — `.limit()` added (per-exercise last session only needs recent rows).
  - `workout-history`: paginated? **[WATCH]** — verify before 1.1; currently fine at beta scale.
  - Friends screens: RPCs return bounded rows (limit 20/100); leaderboard bounded by friend count. 500 friends → `get_public_profiles` caps at 100; acceptable (UI shows first 100). **[WATCH]**.
  - Splits: hydration now 1 query (fixed last round). Editor state is local; no re-render hotspots found.
- **Cold start:** persisted React Query cache paints instantly (verified pattern exists). ✅

## 13. Data integrity

| Finding | Severity | Status |
|---|---|---|
| `attachRpe` vs in-flight insert race | Med | Fixed last round (verify-and-retry) |
| Set removal renumbering | Med | Fixed last round (always renumber) |
| Share import can reference deleted exercises | Low | Handled (readable-ids filter + dropped-count messaging) |
| Split-day permanent add: same exercise twice guarded | Low | Verified (`includes` check) |
| Two devices logging the same session | Low | **[WATCH]** — both adopt the same open log (good); set_number collisions possible; single-user product, acceptable |
| `friendships` accepted-pair uniqueness incl. reversed direction | — | Verified (unordered unique index) |

## 14. Design / delight audit

Honest read: **core screens feel intentional (Strava-adjacent); edge screens still read "solid indie".**
- Strong: runner instrument, completion celebration (confetti/count-up/level-ups), themed design system, motion toolkit, branded sheets.
- **[FIXED-NOW]**: activity feed rows + leaderboard give the social screen life; share preview chips; first-session coach overlay; friend-code card is a premium-feeling artifact.
- **[WATCH / next design pass]**: illustrated empty states (current ones are good text + icon; real illustration is an asset task), Home returning-user hero (see §7), achievement unlock moments, progress-photo compare.

---

## Priority queue after this round
1. Vacation/pause mode (§6 — designed, needs its own careful pass)
2. Activity events table → PR feed items + likes (§2)
3. Progress-photo timeline/compare (§9)
4. Returning-user Home heroes + encouragement selector (§7)
5. Web share preview + universal links (§3)
6. Weekly friend challenges on top of activity events (§2)
7. QR add (§1) and friend-request push (§10)
8. Apple Health export (§11)
