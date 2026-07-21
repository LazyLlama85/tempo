# Tempo — Master Fix Plan

> **What this file is:** a complete, Sonnet-executable inventory of everything currently wrong with
> Tempo's code, logic, and UI — as found by a full-codebase review on 2026-07-19 — turned into
> ordered, one-session-sized batches. Unlike `EXECUTION.md` (which sequences *strategy* toward
> product-market fit), this file sequences *correctness and craft*: the defects that would embarrass
> a launch today, then the polish that makes Tempo feel like the #1 app in its category, then the
> features that extend the wedge, then nice-to-haves.
>
> **Read `CLAUDE.md`'s "No Regressions" section and `EXECUTION.md` §2/§9 before touching anything.**
> Every batch here is additive-by-default: extend, don't rewrite; hide, don't delete; fix the root
> cause, don't paper over it. Each batch names its own done-when and required tests — treat those as
> a contract, not a suggestion.
>
> **How to use this with Sonnet:** copy the "Sonnet prompt" block for one batch at a time into a
> fresh or continuing session. Each prompt is self-contained (states the bug, the files, the fix,
> the edge cases, and the verification bar) so it works even with zero memory of this document.
> **Do one batch per session**, verify (`tsc` + tests), then move to the next. Do not batch multiple
> `F` items into one commit — each is its own regression surface.

---

## 0. Publishing-today shortlist

**Status (2026-07-19): P0 is fully done — F1 through F10 all shipped, verified, and pushed
(`tsc` clean, full suite green at 237 tests throughout). Two items below stay open because only
the founder can do them.**

| # | Issue | Who fixes it | Status |
|---|---|---|---|
| F1 | Plan-cliff can reopen (empty schedule for a paying user) | Sonnet | ✅ done |
| F9a | Verify RevenueCat entitlement ID matches `EXPO_PUBLIC_PRO_ENTITLEMENT` exactly | **Founder** (RevenueCat dashboard) | 🔲 open — a loud Sentry report now fires if a mismatch exists, but only the founder can confirm the dashboard value |
| F9b | Rotate + remove the leaked `EXPO_PUBLIC_RAPIDAPI_KEY` from `eas.json` | Sonnet (remove) + **Founder** (rotate key) | ⚠ investigated, NOT removed — see F9's own note: this key is still genuinely load-bearing (641/1,285 exercises uncached); founder should still rotate it, but eas.json's entry stays until a server-side proxy exists or the backfill completes |
| F2 | All-day calendar events don't block scheduling | Sonnet | ✅ done |
| F3 | Several mutations ignore write errors (silent data loss) | Sonnet | ✅ done |
| F8 | No crash fallback UI — a render error is a blank white screen | Sonnet | ✅ done |
| — | Apply the retention-push cron SQL (currently commented out — engine is inert) | **Founder** (Supabase SQL editor) | 🔲 open |
| — | Ship a build with the real PostHog key, then on-device test the 🔍 backlog in `EXECUTION_STATUS.md` | **Founder** | 🔲 open |

Everything below is organized P0 (ship-blockers) → P1 (craft/coherence) → P2 (wedge amplifiers) →
P3 (table stakes) → P4 (deferred, M4-gated). **Work top to bottom.** Do not skip ahead to P2 while
P0 items remain — a beautiful app that loses your workout data is not a #1 app.
**P0 is now clear — P1 (craft/coherence) is next.**

---

## P0 — Ship-blockers (correctness)

### F1 — Plan-cliff hardening (the plan-generation "week_index" bug) — ✅ DONE 2026-07-19

**The bug:** `scheduled_workouts.week_index` is used for two different things that have quietly
drifted apart:
1. In `generatePlan.ts`, it's a **date offset** — `date = startMonday + week_index*7 + (slot-1)`
   (`generatePlan.ts:655`), and rollover derives the next block's start from
   `lastWeek = max(week_index)` (`generatePlan.ts:737`).
2. In `periodization.ts`/`weekProgression`, it's a **mesocycle phase index** (mod 4: overload
   weeks 1-3 + deload week 4).

`adaptation.applyAdaptationMode` (`adaptation.ts:177-184`) re-anchors `week_index` to the *current*
week for recovery/deload modes — which is correct for meaning #2 (phase) but corrupts meaning #1
(date offset). The next time `extendActivePlan` runs, `lastWeek = max(week_index)` reads the
re-anchored value, computes `startMonday + (lastWeek+1)*7`, and can land **in the past** — which the
past-date guard (`generatePlan.ts:659`) then filters out, producing **zero new rows**. A user whose
adaptation mode changed can silently run out of scheduled workouts with no error shown anywhere.

**The fix:**
1. Add a new column `scheduled_workouts.week_offset` (int, nullable initially) that captures the
   **pure date-offset meaning** at insert time and is **never** rewritten by adaptation. Backfill it
   from the existing `week_index` for all current rows (`week_offset = week_index` at migration
   time — safe because adaptation hasn't yet corrupted historical rows differently from how they
   were inserted).
2. Change `extendActivePlan`'s `lastWeek = max(week_index)` to `lastWeek = max(week_offset)`
   (`generatePlan.ts:737`) and the date computation to use `week_offset` instead of `week_index`.
3. Leave `week_index` as the mesocycle-phase field only — `applyAdaptationMode` can keep rewriting
   it for periodization purposes, since rollover no longer reads it for dates.
4. In `applyAdaptationMode`, when inserting/updating rows, never touch `week_offset`.

**Also fix, same file, same root cause (F1b — rollover atomicity):**
`extendActivePlan` does one bulk `.insert(rows)` (`generatePlan.ts:778`). If ANY one target date
already holds a scheduled plan row (violates the partial unique index
`scheduled_workouts_one_plan_per_day`), the **entire insert fails**, and the `catch { return 0 }`
(`generatePlan.ts:787-789`) silently swallows it — reporting nothing, extending nothing. Because
`dedupeScheduledWorkouts` (which would clear the stale blocking row) runs **after** `extendActivePlan`
in the app-open sequence (`index.tsx:568` vs `:586`), the block can never clear itself — the cliff
reopens on every app open until a user manually intervenes.

Fix:
1. In `index.tsx`'s app-open sweep, move `dedupeScheduledWorkouts()` to run **before**
   `extendActivePlan()`.
2. Change `extendActivePlan`'s insert from one bulk call to a per-date `upsert` (or insert with
   `onConflict` ignore) so one blocked date can't void the whole block.
3. Replace the silent `catch { return 0 }` with: log to Sentry (`captureException`) including the
   count of rows that failed vs succeeded, and return the actual count inserted (not a hardcoded 0)
   so callers can tell partial success from total failure.

**Edge cases to test:**
- A user goes from `normal` → `recovery` mode mid-block, then their plan later needs rollover: does
  the new block still generate correct future dates?
- A stale scheduled row occupies one date in an otherwise-clean 4-week block: does rollover still
  insert the other 27 dates?
- Two rapid app-opens race the sweep (background/foreground toggle): does the second run see clean
  state from the first (idempotent)?
- A user whose plan already has corrupted (pre-migration) rows: does the backfill produce sane
  `week_offset` values, or do we need a repair query for rows already re-anchored by adaptation
  before this fix ships?

**Files:** `mobile/src/lib/generatePlan.ts`, `mobile/src/lib/adaptation.ts`, `mobile/src/app/(tabs)/index.tsx`,
new migration `mobile/supabase/add_week_offset.sql`.

**Tests:** extend `mobile/src/lib/__tests__/` (use the existing `fakeSupabase` harness) — a test that
seeds a plan, runs `applyAdaptationMode` for recovery mode, then runs `extendActivePlan` and asserts
the new rows land on real future dates (not filtered out). A second test: seed one stale blocking row
on day 15 of a 28-day block, run `extendActivePlan`, assert days 1-14 and 16-28 all get inserted.

**Done-when:** both new tests pass; `npx tsc --noEmit` clean; a manual trace through the sequence
(dedupe → extend → autoschedule) confirms order in `index.tsx`.

**Sonnet prompt:**
```
Read MASTER_FIX_PLAN.md section "F1 — Plan-cliff hardening" in full before starting. Implement
exactly what it specifies: (1) add scheduled_workouts.week_offset via a new migration, backfilled
from week_index; (2) extendActivePlan in generatePlan.ts reads/writes week_offset instead of
week_index for date math; (3) applyAdaptationMode in adaptation.ts never touches week_offset;
(4) reorder index.tsx's app-open sweep so dedupeScheduledWorkouts runs before extendActivePlan;
(5) change extendActivePlan's bulk insert to per-date upsert with onConflict ignore, and replace
the silent catch{return 0} with a Sentry captureException + accurate return count. Add the two
tests described in the "Tests" subsection using the existing fakeSupabase harness in
mobile/src/lib/__tests__/. Follow CLAUDE.md's No-Regressions rules — do not touch any other
scheduling logic. Run npx tsc --noEmit and the full test suite before reporting done. Show me a
diff summary and the on-device test checklist from the "Edge cases" subsection before committing.
```

---

### F2 — All-day calendar events don't block scheduling — ✅ DONE 2026-07-19

**The bug:** `fetchUserBusySlots` (`CalendarApiService.ts:182-183`) only keeps Google events with a
`dateTime` field, dropping `date`-only (all-day) events entirely. The device-calendar path does the
same (`calendarService.ts:81`, filters `!e.allDay`). A user with an all-day "Vacation," "Flight to
Chicago," or "Out of Office" event on their calendar will have Tempo schedule a workout into that day
anyway — the exact failure mode a "calendar-native" product cannot afford.

**The fix:**
1. In `fetchUserBusySlots`, include all-day events as busy for their **entire day** (00:00–23:59
   local), UNLESS the event's `transparency` field is `'transparent'` (Google's own "doesn't block
   my calendar" flag — used for things like birthdays that shouldn't count as busy).
2. Do the same in the device-calendar path in `calendarService.ts` — RN `expo-calendar` events expose
   `allDay: boolean`; treat `allDay === true` as full-day busy unless the event has an equivalent
   "free" marker (device calendars don't always expose transparency — if not available, default
   all-day events to busy; this is the safer failure direction for a scheduling product).
3. Do NOT change the *display* logic in `dayTimeline.ts`/Home's feed — this fix is scoped to the
   busy-slot computation used by `autoSchedule`/`reschedule`/`smartSchedule`, not to what's shown on
   the timeline.

**Edge cases to test:**
- An all-day event with `transparency: 'transparent'` (e.g. a birthday) should NOT block scheduling.
- An all-day event spanning multiple days (Google represents multi-day all-day events as one event
  with `start.date`/`end.date` spanning several days) — confirm every day in the span is blocked, not
  just the first.
- A day with both a timed event AND an all-day event — both should independently contribute to busy
  time.
- Empty/no all-day events — no regression to existing timed-event behavior.

**Files:** `mobile/src/services/googleCalendar/CalendarApiService.ts`, `mobile/src/lib/calendarService.ts`.

**Tests:** add cases to `CalendarApiService.test.ts` (already covers `findBestWorkoutSlot`) — an
all-day busy event should exclude that entire day from candidate slots; a transparent all-day event
should not.

**Done-when:** new tests pass; manually confirm via a test calendar event that a same-day workout no
longer gets suggested/auto-scheduled during an all-day "Vacation" block.

**Sonnet prompt:**
```
Read MASTER_FIX_PLAN.md section "F2 — All-day calendar events don't block scheduling" in full.
Implement exactly what it specifies in CalendarApiService.ts's fetchUserBusySlots and
calendarService.ts's device-calendar equivalent: treat all-day events as busy for their full local
day, respecting Google's transparency:'transparent' flag as an explicit exception, and defaulting
device all-day events to busy (RN expo-calendar events may not expose transparency). Do not change
dayTimeline.ts or any display/UI code — this is scoped to the busy-slot computation only. Add tests
to CalendarApiService.test.ts per the "Tests" subsection. Follow CLAUDE.md No-Regressions. Run
npx tsc --noEmit + tests, then show me a diff summary and manual verification steps before
committing.
```

---

### F3 — Unchecked-write sweep (silent data-loss surfaces) — ✅ DONE 2026-07-19

**The bug (five separate call sites, one shared root cause):** Supabase's client returns
`{data, error}` rather than throwing on a failed write. Several places destructure the result and
never check `error`, so a failed write (offline, RLS denial, constraint violation) looks identical
to success in the UI:

1. `reschedule.ts:274-278` — `rescheduleWorkout`'s core update. The UI shows the workout moved; the
   DB row is untouched.
2. `experienceProgression.ts:141` — `maybePromoteExperience` writes the new `experience` level, then
   unconditionally fires the "LEVEL UP" celebration and calls `restampFuturePlanForExperience`
   **even if the write failed**. The user sees a promotion that evaporates on next read, and future
   plan rows get restamped against a level the profile was never actually updated to.
3. `adaptation.ts:182-197` — `applyAdaptationMode`'s per-row restamp loop has no error check per
   iteration; a failure partway through leaves the plan half-restamped with no signal to the caller.
4. `quickWorkout.ts:523-532` — `persistQuickWorkout` moves the conflicting plan workout forward by
   moving `planned_date` directly (skipping `resyncMovedWorkout`, so the calendar event/reminder
   stay on the old day — a ghost event + a phantom reminder buzz) and doesn't check the write result,
   nor handle the case where the +2-day target already has a plan row (violates the same unique
   index F1 discusses).
5. `autoSchedule.ts:170-173` and `:267-270` — `autoScheduleUpcoming`/`resolveCalendarConflicts` write
   `planned_start_time` without checking the result. Best-effort by original design, but combined
   with a parallel calendar-event move this can leave the calendar and DB disagreeing silently.

**The fix (apply the same pattern everywhere):**
1. Every one of the five call sites above: destructure `{error}` from the Supabase call and, on a
   truthy `error`, do NOT proceed with the dependent side effect (celebration, restamp, cache
   invalidation) — surface it instead: call the existing `describeSaveError`/`saveErrors` helper
   pattern already used elsewhere in the app (see `session-detail.tsx`'s edit-save path for the
   existing convention) and `captureException`/`captureApiError` to Sentry.
2. For #2 specifically (`maybePromoteExperience`): only fire the celebration + restamp AFTER
   confirming the `experience` write succeeded.
3. For #4 specifically (`persistQuickWorkout`): route the conflicting-workout move through the
   existing `resyncMovedWorkout` helper (already used by `rescheduleWorkout`/`autoSchedule` — check
   its signature in `reschedule.ts`/`autoSchedule.ts`) instead of a raw `planned_date` update, so the
   calendar event and local reminder move with it. If the target date already holds a row, fall back
   to the next open date instead of failing silently — reuse whatever "find next open slot" utility
   already exists in `smartSchedule.ts`/`reschedule.ts` rather than writing a new one.
4. For #3 (`applyAdaptationMode`'s loop): check each row's write result; if any fail, log which rows
   didn't update (so a real reconciliation is possible later) rather than pretending it's all-or-
   nothing when it's actually per-row.
5. For #5 (`autoSchedule.ts` best-effort writes): at minimum log a Sentry breadcrumb/warning on
   failure so silent DB/calendar divergence is at least visible in monitoring, even if the UX
   deliberately stays best-effort (don't block the user on this one — just stop it from being
   invisible).

**Edge cases to test:**
- Simulate an offline/RLS-denied write at each of the 5 sites (use `fakeSupabase` to return an error)
  and confirm the dependent side effect (celebration, restamp, calendar move) does NOT fire, and the
  user sees a real error state, not silent success.
- `persistQuickWorkout`: the +2-day target is already occupied — confirm it now finds a different
  open date instead of failing invisibly.
- `maybePromoteExperience`: confirm a failed write means no celebration AND no restamp — not a
  partial one where the celebration shows but the restamp is skipped (or vice versa).

**Files:** `mobile/src/lib/reschedule.ts`, `mobile/src/lib/experienceProgression.ts`,
`mobile/src/lib/adaptation.ts`, `mobile/src/lib/quickWorkout.ts`, `mobile/src/lib/autoSchedule.ts`.

**Tests:** extend the existing `fakeSupabase`-based suites for `reschedule`, `adaptation`,
`experienceProgression` (create one if none exists — check `mobile/src/lib/__tests__/` first per
CLAUDE.md's "extend before creating") to cover the error-path assertions above.

**Done-when:** all five sites check their write result before any dependent action; new/extended
tests cover the error path at each site; `tsc` clean; full suite green.

**Sonnet prompt:**
```
Read MASTER_FIX_PLAN.md section "F3 — Unchecked-write sweep" in full before starting — it names
five specific call sites (reschedule.ts:274, experienceProgression.ts:141, adaptation.ts:182,
quickWorkout.ts:523, autoSchedule.ts:170+267) that all share one bug pattern: destructuring a
Supabase write result without checking `error`, then proceeding with a dependent side effect
(celebration, restamp, cache read) regardless of whether the write actually succeeded. Fix all
five per the exact behavior specified in that section — check the error, gate the dependent
action on success, and route persistQuickWorkout's plan-move through the existing
resyncMovedWorkout helper (find it in reschedule.ts/autoSchedule.ts — reuse, don't reimplement)
with a fallback to the next open date if the +2-day target is occupied. Add tests per the "Tests"
subsection using the existing fakeSupabase harness — check mobile/src/lib/__tests__/ first for an
existing suite to extend before creating a new one. Follow CLAUDE.md No-Regressions strictly:
touch only these five functions' error-handling, nothing else in these files. Run npx tsc --noEmit
+ full test suite, then show me a diff summary before committing.
```

---

### F4 — Cache-invalidation sweep — ✅ DONE 2026-07-19

**The bug:** After several mutations that change future scheduled workouts, the React Query cache is
not invalidated, so the UI keeps showing stale data until an unrelated refetch happens to occur:

1. `workout-complete.tsx` calls `maybePromoteExperience` (which can restamp future plan rows) and
   `refreshAdaptation` (same) but contains **zero** `queryClient.invalidateQueries` calls anywhere in
   the file. The "your plan grew with you" promotion is supposed to land visibly on tomorrow's
   session — instead it's invisible until the next app-open sweep happens to refetch.
2. `index.tsx`'s post-sweep invalidation (`:592-595`) only invalidates `['scheduled_workouts']` and
   `['missed_workouts']` — not the full set. `block_phase`, `next_workout`, `goal_projection`, and
   `plan_cal_workouts` can all stay stale after a rollover or adaptation restamp, even though
   `invalidateTrainingData` (in `queryInvalidation.ts`) already exists specifically to invalidate all
   of them together.

**The fix:**
1. In `workout-complete.tsx`, after `maybePromoteExperience`/`refreshAdaptation` complete (success
   path only, per F3's fix), call the existing `invalidateTrainingData(queryClient)` helper (check
   its exact import path/signature in `queryInvalidation.ts` and how `session-detail.tsx`/`plan.tsx`
   already call it — reuse that pattern verbatim).
2. In `index.tsx`, replace the two-key invalidation at `:592-595` with a call to
   `invalidateTrainingData(queryClient)`.
3. Audit callers of `rescheduleWorkout` (in `reschedule.ts`) — confirm each caller (Home, Plan,
   Weekly Report) invalidates the affected queries after a successful reschedule; add
   `invalidateTrainingData` calls wherever missing.

**Edge cases to test:**
- Complete a workout that triggers a level-up + restamp → confirm tomorrow's session shows the new
  level's exercise selection WITHOUT a force-quit/reopen.
- A background app-open sweep restamps rows due to an adaptation-mode change → confirm the Plan tab,
  if already open, reflects the change without manual refresh.

**Files:** `mobile/src/app/workout-complete.tsx`, `mobile/src/app/(tabs)/index.tsx`,
`mobile/src/lib/reschedule.ts` callers (`(tabs)/index.tsx`, `(tabs)/plan.tsx`, `weekly-report.tsx`).

**Tests:** this is primarily a caching/wiring fix that's hard to unit-test meaningfully (React Query
invalidation is integration-level) — the done-when is a manual on-device/simulator trace, documented
in the on-device checklist below. If a lightweight test can assert `invalidateTrainingData` was
called (e.g. mock the queryClient in a component test), add it — otherwise rely on `tsc` + manual QA.

**Done-when:** `tsc` clean; manual trace confirms no stale data on the two edge cases above; a
written on-device test note added to `EXECUTION_STATUS.md`'s checklist.

**Sonnet prompt:**
```
Read MASTER_FIX_PLAN.md section "F4 — Cache-invalidation sweep" in full. Find the existing
invalidateTrainingData helper in mobile/src/lib/queryInvalidation.ts and see how session-detail.tsx
and plan.tsx already call it. Then: (1) add a call to it in workout-complete.tsx after
maybePromoteExperience/refreshAdaptation succeed (only on their success path, consistent with F3's
fix if already applied); (2) replace index.tsx's two-key invalidation (around line 592-595) with a
call to invalidateTrainingData; (3) check every caller of rescheduleWorkout in reschedule.ts (Home,
Plan tab, weekly-report.tsx) and add invalidateTrainingData calls wherever a successful reschedule
doesn't already invalidate the training queries. Follow CLAUDE.md No-Regressions — reuse the
existing helper exactly as-is, don't modify its implementation. Run npx tsc --noEmit, then describe
the manual on-device trace I should run (completing a workout that triggers a level-up, confirming
tomorrow's session updates without a force-quit) before committing.
```

---

### F5 — App-open orchestration (concurrent sweep race) — ✅ DONE 2026-07-19

**The bug:** Two independent effects fire on app launch with no ordering guarantee between them:
- `stores/auth.ts:44-46` (auth state listener) runs `checkMissedWorkouts()` → `refreshAdaptation()`
  (which restamps future plan rows).
- `index.tsx:568-591` (Home's mount effect) runs its own sweep: `extendActivePlan` → `autoScheduleUpcoming`
  → `refreshActiveSplit` → `syncTravelSchedule` → `dedupeScheduledWorkouts` → `checkMissedWorkouts`
  → `resolveCalendarConflicts`.

`checkMissedWorkouts` runs in **both** paths. `refreshAdaptation` (which restamps rows, changing
`week_index`) can race `extendActivePlan` (which reads `max(week_index)`/`week_offset` and inserts
new rows) with no lock — this is the concrete mechanism behind F1's plan-cliff bug, and it can
produce other interleaved-write inconsistencies even after F1 lands.

**The fix:**
1. Pick ONE owner for the full app-open sweep sequence — recommend `index.tsx`'s effect, since it
   already orchestrates the most steps and runs once per Home mount (which happens once per cold
   launch in practice).
2. Remove `checkMissedWorkouts()` → `refreshAdaptation()` from the auth listener in `stores/auth.ts`
   entirely, OR gate it so it only runs when Home's effect is NOT about to run (e.g., only trigger it
   for auth-state changes that happen while Home is NOT mounted, like a background sign-in). Prefer
   the simpler option: **remove it from the auth listener, add `refreshAdaptation()` into `index.tsx`'s
   sweep sequence** at the correct position (after `checkMissedWorkouts`, before `extendActivePlan` —
   confirm this ordering doesn't break F1's fix; adaptation should settle before rollover reads
   `week_offset`).
3. Document the final, single sequence as a code comment at the top of `index.tsx`'s sweep effect:
   `dedupe → missed → adaptation → extend → autoschedule → conflicts` (per F1's requirement that
   dedupe precede extend).

**Edge cases to test:**
- Sign-in triggers the auth listener while Home is also mounting (cold launch) — confirm the sweep
  runs exactly once, not twice, and in the documented order.
- A background app resume (not a fresh sign-in) — confirm the sweep still runs appropriately (check
  whether `index.tsx`'s effect is mount-only or also fires on `AppState` foreground; if it's mount-only,
  confirm that's intentional and matches existing behavior — don't introduce a new resume-time sweep
  as a side effect of this fix).

**Files:** `mobile/src/stores/auth.ts`, `mobile/src/app/(tabs)/index.tsx`.

**Tests:** hard to unit-test a race condition directly; add a comment-level assertion (the ordering
documented in code) and rely on manual verification. If existing tests reference the auth listener's
sweep behavior, update them to match the new ownership.

**Done-when:** exactly one code path owns the full sweep sequence; the auth listener no longer
independently restamps plan rows; `tsc` clean; existing tests still pass.

**Sonnet prompt:**
```
Read MASTER_FIX_PLAN.md section "F5 — App-open orchestration" in full. This depends on F1 already
being applied (week_offset added) — confirm that before starting. Implement the fix: remove
checkMissedWorkouts()->refreshAdaptation() from the auth state listener in stores/auth.ts, and add
refreshAdaptation() into index.tsx's existing app-open sweep effect in the correct position (after
checkMissedWorkouts, before extendActivePlan, per F1's requirement that adaptation settle before
rollover reads week_offset). Add a code comment documenting the full sequence:
dedupe -> missed -> adaptation -> extend -> autoschedule -> conflicts. Follow CLAUDE.md
No-Regressions -- do not change what each individual function does, only the ordering/ownership.
Run npx tsc --noEmit and the full test suite, then describe the manual verification steps (cold
launch with sign-in, confirming the sweep runs once in the right order) before committing.
```

---

### F6 — Adaptation & recovery correctness — ✅ DONE 2026-07-19

**Two separate bugs, same category (the "smart" engine is wrong in specific, findable ways):**

**F6a — Adaptation ignores split-based misses.** `evaluateAdaptationMode` counts missed sessions with
`.eq('source', 'plan')` (`adaptation.ts:114`), but `checkMissedWorkouts` marks BOTH `'plan'` and
`'split'`-sourced rows as missed (`missedWorkouts.ts:23`). A user running their own custom split who
misses every session for weeks never triggers recovery/deload — the "the app adapts to you" claim
silently doesn't hold for split users, likely a large fraction of intermediate/advanced users (the
audit's stated sweet spot).

Fix: remove the `.eq('source', 'plan')` filter (or explicitly include both `'plan'` and `'split'`) in
`evaluateAdaptationMode`'s missed-session query, matching what `checkMissedWorkouts` already tracks.

**F6b — Muscle-to-region substring matcher misclassifies real muscles.** `trainingLoad.ts:11-30` maps
muscle names to recovery regions via substring checks: `'lateral_deltoids'.includes('lat')` is true,
so lateral delts get tagged **pull** (should be shoulders/push); `'abductor'`/`'adductor'` both
contain `'ab'`, so they get tagged **core** in addition to legs. This corrupts:
- `scoreDay`'s recovery-fatigue scoring (wrong muscle group shown as recovering).
- `suggestNextSlot`/`rescheduleWholeWeek`'s day-choice logic (recommends a day based on wrong
  recovery data).
- The volume-landmark MRV cap (`volumeLandmarks.ts` reuses the same mapping) — can apply the wrong
  muscle group's cap.

Fix: replace the substring-based classifier with an explicit lookup map (a plain object/Map keyed by
exact muscle-name strings — enumerate every value the `exercises` table's muscle fields actually
contain; check `mobile/supabase/schema.sql` or a live query for the full enum/set of muscle names
used) instead of `.includes()` checks. This removes the entire class of false-positive substring
matches, not just the two named here.

**Edge cases to test (F6a):** a split-only user (no plan-sourced sessions at all) with 3+ consecutive
misses — confirm `evaluateAdaptationMode` now returns `deload`/`recovery` appropriately.

**Edge cases to test (F6b):** every muscle name in the exercise library's muscle-group enum, run
through the new classifier, spot-check against the old substring result to confirm the previously
wrong ones (`lateral_deltoids`, `abductor`, `adductor`) now map correctly and nothing previously
correct regressed.

**Files:** `mobile/src/lib/adaptation.ts`, `mobile/src/lib/trainingLoad.ts`, `mobile/src/lib/volumeLandmarks.ts`
(shares the mapping — confirm it imports from `trainingLoad.ts` rather than duplicating; if it
duplicates, consolidate to one source of truth while fixing).

**Tests:** add a test to `adaptation`'s suite (create if none exists, check `__tests__` first) for
F6a's split-miss scenario. Add/extend a `trainingLoad` test enumerating the full muscle-name set
against the new explicit map for F6b — this is a pure function, easy to test exhaustively.

**Done-when:** both fixes land with tests; `volumeLandmarks.ts` confirmed to use the corrected
mapping (not a stale duplicate); `tsc` clean; full suite green.

**Sonnet prompt:**
```
Read MASTER_FIX_PLAN.md section "F6 — Adaptation & recovery correctness" in full. Two independent
fixes: (F6a) in adaptation.ts's evaluateAdaptationMode, remove the .eq('source','plan') filter on
the missed-session query (or explicitly include 'split' too) so split-based misses count toward
recovery/deload triggers, matching what missedWorkouts.ts's checkMissedWorkouts already tracks for
both sources. (F6b) in trainingLoad.ts, replace the substring-based muscle-to-region classifier
(the .includes() checks around lines 11-30) with an explicit exact-match lookup map covering every
muscle name the exercises table actually uses -- check mobile/supabase/schema.sql or query the live
table for the full muscle-name set. Confirm volumeLandmarks.ts uses this same corrected mapping
(consolidate to one source of truth if it currently duplicates the logic). Add tests: an
adaptation test for a split-only user with 3+ misses triggering deload/recovery; a trainingLoad
test enumerating the full muscle-name set against the new map, specifically confirming
lateral_deltoids no longer maps to 'pull' and abductor/adductor no longer map to 'core'. Follow
CLAUDE.md No-Regressions. Run npx tsc --noEmit + full suite, then show me a diff summary before
committing.
```

---

### F7 — UI failure-state sweep — ✅ DONE 2026-07-19

**The bugs (grouped — same category, several screens):**

1. **`weekly-report.tsx:44`** — the primary report-computation call has no `.catch`; on any error,
   `loading` never clears and the user is stuck on "Building your report…" forever. Fix: wrap in
   try/catch, set an error state, render a real error view with retry (match the existing
   `ErrorBanner` pattern already used on Home).
2. **`shared-workout.tsx:45-47`** — `.finally(setLoading(false))` with no `.catch`; any failure
   (including a transient network error) renders the same "Not found — may have been deleted" empty
   state as a genuinely deleted share, actively misinforming the user. Fix: distinguish
   network/fetch-error from a confirmed-absent record (a real 404/empty result) and show a
   "couldn't load — try again" state for the former.
3. **`social.tsx:96-106`** — 7 parallel fetches (`fetchFriends`, feed, events, board, groups,
   invites) with no error states anywhere; the primary friends fetch has no `.catch` at all. A failed
   feed/leaderboard/groups fetch is indistinguishable from "genuinely empty." Fix: track a per-section
   error flag (or one combined "some data failed to load" banner) and show a retry affordance rather
   than a false empty state.
4. **`my-workouts.tsx`, `group-detail.tsx`, `badges.tsx`** — same pattern (`.finally` with no
   `.catch`, or no error state at all) — failures collapse into empty UI. Apply the same fix:
   distinguish "confirmed empty" from "failed to load," with retry.
5. **Home's 10 secondary queries** (`index.tsx:343-479`: events, missed, checkin, socialNotifs,
   travel, blockPhase, recentAdaptation, nextWorkout, projection) have no error handling — all
   default to empty/null on failure and render nothing, with no way for the user (or Sentry) to know
   something failed. Fix: these are secondary/non-blocking by design (correctly so — Home shouldn't
   hard-fail because one context chip's query failed), so don't add blocking error UI for all of
   them. Instead: ensure each failed query still reports to Sentry via the existing global
   `QueryCache.onError` handler (confirm it's actually catching these — check `_layout.tsx:64`'s
   `onError` wiring covers all query keys, not just a subset) so failures are at least visible in
   monitoring even though the UI degrades gracefully by design.
6. **GO button acts on stale/undefined data** (`TempoTabBar.tsx:151`) — `todayRows` has a 60s
   staleTime and no loading guard; an early tap (before the first fetch resolves) falls through to
   the Quick Workout path even when a real scheduled session exists. Fix: while `todayRows` is
   loading (`isLoading` true and no cached data yet), disable the GO button or show a loading state
   instead of letting it fall through to the wrong branch.
7. **`FocusMode.tsx:205`** — `{done ? 'DONE' : 'DONE'}` — a dead ternary where both branches are
   identical, so the primary action button's label never changes. Read the surrounding logic to
   determine the intended two states (almost certainly "NEXT" while more sets remain, "DONE" on the
   last set) and fix the actual conditional.

**Edge cases to test:**
- Force each fetch to fail (via a test double or temporarily breaking the query) and confirm the
  correct failure UI (not a false-empty or infinite-spinner state) appears, with a working retry.
- GO button tapped within the first ~100ms of Home mounting, before `todayRows` resolves — confirm
  it does NOT start a Quick Workout when a real session is scheduled.
- Focus Mode: confirm the primary button now correctly reads "NEXT" mid-exercise and "DONE" on the
  final set (or whatever the correct intended states are — verify by reading the component's own
  state management for "is this the last set" logic).

**Files:** `mobile/src/app/weekly-report.tsx`, `mobile/src/app/shared-workout.tsx`,
`mobile/src/app/social.tsx`, `mobile/src/app/my-workouts.tsx`, `mobile/src/app/group-detail.tsx`,
`mobile/src/app/badges.tsx`, `mobile/src/app/(tabs)/index.tsx`, `mobile/src/components/TempoTabBar.tsx`,
`mobile/src/components/FocusMode.tsx`, `mobile/src/app/_layout.tsx` (confirm QueryCache.onError
coverage).

**Tests:** where these screens have existing component tests, extend them for the error path. Where
none exist, a manual on-device/simulator QA pass is the primary verification (document in the
checklist) — these are largely UI-state fixes, not pure-function logic.

**Done-when:** every named screen shows a real error/retry state instead of a false-empty or
infinite-spinner state on failure; GO button never mis-fires on stale data; Focus Mode's button
label is correct; `tsc` clean.

**Sonnet prompt:**
```
Read MASTER_FIX_PLAN.md section "F7 — UI failure-state sweep" in full — it lists 7 distinct fixes
across weekly-report.tsx, shared-workout.tsx, social.tsx, my-workouts.tsx/group-detail.tsx/badges.tsx,
index.tsx (Home), TempoTabBar.tsx's GO button, and FocusMode.tsx's dead ternary at line 205. Fix each
exactly as specified: add proper try/catch + error states (matching the existing ErrorBanner pattern
already used on Home) to weekly-report/shared-workout/social/my-workouts/group-detail/badges so
failures are never indistinguishable from "genuinely empty" and weekly-report never hangs on an
infinite spinner; confirm _layout.tsx's QueryCache.onError actually covers Home's 10 secondary
queries (don't add new blocking error UI to Home's chips -- they're correctly non-blocking by
design, just confirm Sentry visibility); fix TempoTabBar's GO button to not act on todayRows before
it has loaded; fix FocusMode.tsx line 205's dead ternary (done ? 'DONE' : 'DONE') by reading the
surrounding set/exercise-progress state to determine the correct two button states it should show.
Follow CLAUDE.md No-Regressions -- each screen's fix should be isolated to its own file. Run
npx tsc --noEmit, then show me a diff summary and a manual QA checklist (which screens to force-fail
and what I should see) before committing.
```

---

### F8 — Global ErrorBoundary (crash fallback UI) — ✅ DONE 2026-07-19

**The bug:** There is no React ErrorBoundary anywhere in the app (`componentDidCatch`/
`getDerivedStateFromError` — zero hits). The only wrapper is `Sentry.wrap` (`crashReporting.ts:48`,
`_layout.tsx:285`), which reports the error but provides no fallback UI. Any render-phase error in
any screen currently produces a blank/white screen in production with no way to recover short of
force-quitting the app.

**The fix:**
1. Build a `TempoErrorBoundary` component (class component, required for
   `getDerivedStateFromError`/`componentDidCatch`) that renders a branded "Something went wrong"
   screen with: a short honest message, a "Try Again" button that resets the boundary's state (and
   ideally can also navigate Home), and calls `captureException` on catch.
2. Wrap the root `Stack` (or the outermost content inside `Sentry.wrap` in `_layout.tsx`) with it, so
   a crash anywhere at minimum shows this screen instead of blank white.
3. Optionally (if low-risk/small effort), also wrap each of the 4 tab screens individually so a crash
   in one tab doesn't take down the whole app shell (nice-to-have, not required for done-when).
4. Style it using the existing theme system (`C.*` tokens) — this is exactly the kind of screen that
   must work even if something else broke, so keep its own dependencies minimal (don't have it depend
   on any query/data that could itself be the thing that's broken).

**Edge cases to test:**
- Temporarily throw an error inside a test screen's render to confirm the boundary catches it and
  shows the fallback (don't ship the test-throw — just use it locally to verify, then revert).
- Confirm "Try Again" actually recovers (re-renders the children) rather than re-entering the same
  crash loop with no escape — if the same crash would just re-fire, ensure there's also a way to
  navigate Home/reload as an escape hatch.

**Files:** new `mobile/src/components/TempoErrorBoundary.tsx`, `mobile/src/app/_layout.tsx`.

**Tests:** a component test that renders a child which throws, wrapped in the boundary, and asserts
the fallback UI renders instead of propagating the crash.

**Done-when:** the boundary is wired at the root; a forced test-throw confirms the fallback renders
instead of a blank screen; `tsc` clean; new test passes.

**Sonnet prompt:**
```
Read MASTER_FIX_PLAN.md section "F8 — Global ErrorBoundary" in full. Build a new
mobile/src/components/TempoErrorBoundary.tsx class component using getDerivedStateFromError and
componentDidCatch, rendering a branded "Something went wrong" fallback (using the app's existing
theme tokens, not hardcoded colors) with a "Try Again" button that resets the boundary and a way to
navigate Home as an escape hatch, and calling captureException from crashReporting.ts on catch. Wire
it around the root Stack in _layout.tsx (inside the existing Sentry.wrap). Add a test that renders a
throwing child inside the boundary and asserts the fallback renders. Follow CLAUDE.md
No-Regressions -- this is a new, additive component; don't modify any existing screen. Run
npx tsc --noEmit + the new test, then show me a diff summary and how to manually verify (temporarily
throw in a screen, confirm the fallback, then revert the test-throw) before committing.
```

---

### F9 — Secrets/config hardening — ✅ F9a done, F9b investigated (not removed)

**F9a — Entitlement ID likely misconfigured (founder-verification, code-assist).** `eas.json` sets
`EXPO_PUBLIC_PRO_ENTITLEMENT="Tempo: Fitness Planner Pro"` (`eas.json:20,37`) but `purchases.ts:25`'s
code default is `'pro'`, and Pro status is checked as
`info.entitlements.active[PRO_ENTITLEMENT]` (`purchases.ts:96`). RevenueCat entitlement identifiers
are conventionally short slugs, not display strings with colons/spaces — if the actual RevenueCat
dashboard entitlement ID doesn't exactly match the `eas.json` string, **every paying user will
resolve to not-Pro after a successful purchase.** This is a revenue-critical, silent bug.

Sonnet's part: add a loud startup check — on app launch (in the entitlement bootstrap in
`_layout.tsx`), after fetching `CustomerInfo`, log (to Sentry as a breadcrumb, non-fatal) the actual
entitlement keys present in `info.entitlements.all` if `PRO_ENTITLEMENT` is not among them for a
known-purchasing test user, OR simpler: add a one-time debug log (dev-only, or a Tester Tools panel
entry) showing `Object.keys(info.entitlements.all)` so a mismatch is immediately visible rather than
silently resolving `isPro: false` forever. Founder's part (cannot be done by Sonnet): open the
RevenueCat dashboard and confirm the exact entitlement identifier string, then correct `eas.json` if
it's wrong.

**F9b — Leaked RapidAPI key.** `EXPO_PUBLIC_RAPIDAPI_KEY` is committed in `eas.json` (`:16,33`) and,
being `EXPO_PUBLIC_*`, is bundled into every shipped JS bundle — extractable by anyone who
decompiles the app. Per `ARCHITECTURE.md`, exercise GIFs are already served from Tempo's own
Supabase Storage bucket (`exercise-gifs`) once cached — the app's `getExerciseGifSource` reads only
from that bucket in production. The RapidAPI key is only actually needed by the founder-run backfill
script (`scripts/backfill-exercise-media.mjs`), not by the shipped app at runtime.

Sonnet's part: confirm (grep the app source, not just the backfill script) that no runtime app code
path calls RapidAPI directly — if confirmed, remove `EXPO_PUBLIC_RAPIDAPI_KEY` from both `eas.json`
build profiles entirely (it should only need to exist as a local/CI env var for the backfill script,
not in the shipped app). If some runtime path DOES call RapidAPI directly as a fallback, flag this
explicitly instead of removing the var blind — that would be a regression per CLAUDE.md's rules.
Founder's part: rotate the RapidAPI key (the current one is compromised, having been in git history)
once Sonnet confirms it's safe to remove from the client bundle.

**Edge cases to test (F9a):** none code-testable without a real RevenueCat sandbox purchase — this
is why the founder verification step exists; Sonnet's job is only to make a mismatch visible, not to
guess the correct ID.

**Edge cases to test (F9b):** confirm exercise GIFs still load correctly after removing the env var
from `eas.json` (they should, since they're served from Supabase Storage) — do NOT remove it if any
runtime code path still depends on it.

**Files:** `mobile/eas.json`, `mobile/src/app/_layout.tsx` (or wherever entitlement bootstrap lives —
check `purchases.ts`/`entitlements.ts`), grep target: any runtime (non-script) use of
`RAPIDAPI_KEY`/`rapidapi`.

**Tests:** none required beyond the grep-confirmation for F9b; F9a is a founder manual-verification
item, not something to unit test.

**Done-when:** F9a's visibility log/breadcrumb is added and documented as a founder action item in
`EXECUTION_STATUS.md`; F9b's key is removed from `eas.json` ONLY after confirming (and documenting)
that no runtime path needs it, with the founder informed to rotate it.

**Sonnet prompt:**
```
Read MASTER_FIX_PLAN.md section "F9 — Secrets/config hardening" in full. Two tasks: (F9a) find the
Pro entitlement bootstrap code (check _layout.tsx, purchases.ts, entitlements.ts) and add a
non-fatal Sentry breadcrumb or dev-only log that surfaces the actual entitlement keys from
info.entitlements.all whenever PRO_ENTITLEMENT isn't found among them -- this makes a
dashboard/config mismatch loudly visible instead of silently resolving isPro:false forever. Do NOT
guess or change the EXPO_PUBLIC_PRO_ENTITLEMENT value yourself -- that requires the founder to check
the actual RevenueCat dashboard, which you cannot do. (F9b) grep the entire mobile/src runtime code
(not scripts/) for any direct RapidAPI usage. If none exists (exercise GIFs should be served
exclusively from the app's own Supabase Storage bucket per ARCHITECTURE.md), remove
EXPO_PUBLIC_RAPIDAPI_KEY from both build profiles in eas.json. If you find any runtime path that
still calls RapidAPI directly, STOP and report it instead of removing the var -- that would be a
regression. Follow CLAUDE.md No-Regressions. Run npx tsc --noEmit, then report exactly what you
found for the RapidAPI grep and what you changed, plus the founder action items (verify entitlement
ID against RevenueCat dashboard; rotate the RapidAPI key) for me to relay.
```

---

### F10 — Backend hardening migration — ✅ DONE 2026-07-19

**Four independent fixes, bundled into one migration + doc pass since they're all "apply once,
verify, done":**

1. **Missing indexes on hot query paths.** `schema.sql` defines zero indexes; the one index that
   exists on `scheduled_workouts(user_id, planned_date, status)` arrived as a side effect of a social
   feature migration (`add_social_leaderboards.sql:9`), not deliberately. Add:
   - `workout_logs(user_id, completed_at)` — scanned by `retention-push`'s per-user queries
     (`retention-push/index.ts:117-121`) and by history screens; currently a full scan that grows
     with the table.
   - `set_logs(workout_log_id)` — scanned by the RLS EXISTS check and per-workout set fetches.
2. **`workout_shares` RLS is too permissive.** Currently readable by any authenticated user
   (`add_social.sql:190-191`, `using (auth.uid() is not null)`) — any signed-in user can enumerate
   every share row and see `owner_name`. Fix: restrict to rows the requester actually has the share
   code for (if the table has a `share_code` column that's the access mechanism, the RLS should
   require it be looked up by code, not freely SELECT-able by any authenticated user — check how
   `shared-workout.tsx` actually queries this table and design the RLS to match that access pattern
   exactly, likely via a security-definer function keyed on the code rather than a blanket
   authenticated-read policy).
3. **Legacy `calendar_connections` token columns stored plaintext.** `schema.sql:44-45` has a comment
   acknowledging this ("store encrypted in production") but no actual encryption. Real Google tokens
   are already correctly isolated in `google_calendar_tokens` (deny-all RLS, service-role only) per
   the platform audit — confirm `calendar_connections`'s `access_token`/`refresh_token` columns are
   genuinely unused dead columns (not read by any live code path) and, if so, drop them in a
   migration rather than leaving a plaintext-secret liability sitting in the schema. If anything still
   reads them, flag it instead of dropping blind.
4. **Retention-push quiet hours use a hardcoded UTC hour with no per-user timezone.**
   `retention-push/index.ts:35` has `EVENING_HOUR_UTC_FALLBACK = 18` — a "6pm" push fires at wildly
   different local times worldwide (10am California, 3am Tokyo). Add a `user_profiles.timezone`
   column (IANA string, e.g. `'America/Los_Angeles'`), populate it from the device at signup/onboarding
   (React Native's `Intl.DateTimeFormat().resolvedOptions().timeZone` is available without any native
   module), and have `retention-push` compute each user's actual local hour from this instead of the
   hardcoded UTC fallback (keep the UTC fallback only for users with no timezone set yet, e.g.
   pre-migration accounts).

**Also document (not code — a founder apply-step):** the retention-push cron scheduling SQL in
`add_push_notifications.sql:78` is commented out — the entire server-driven push engine is inert
until someone manually applies it with a real project ref and Vault secret. Add this explicitly to
the "Publishing today" shortlist (§0) and `EXECUTION_STATUS.md` as a founder action item — Sonnet
cannot safely apply cron/Vault secrets without the founder's project-specific values.

**Edge cases to test:**
- Confirm new indexes don't change query results, only performance (a migration-only change, verify
  via `EXPLAIN` if convenient, otherwise trust the index is additive/safe).
- `workout_shares` RLS change: confirm `shared-workout.tsx`'s existing flow (viewing a share via its
  code) still works exactly as before — this is the single highest-regression-risk item in this
  batch since it changes access control on a live feature. Test the full deep-link share flow
  end-to-end (or as close as this environment allows) before considering this done.
- Timezone column: confirm a user with no timezone set (existing accounts pre-migration) falls back
  to the old UTC behavior rather than crashing.

**Files:** new migration `mobile/supabase/add_hot_path_indexes.sql`, new migration
`mobile/supabase/fix_workout_shares_rls.sql`, new migration
`mobile/supabase/drop_legacy_calendar_tokens.sql` (only if confirmed unused), new migration
`mobile/supabase/add_user_timezone.sql`, `mobile/supabase/functions/retention-push/index.ts`,
onboarding/profile code that should populate the new timezone column (check `profile-setup.tsx` or
wherever the profile row is first created).

**Tests:** none of these are unit-testable in the mobile test suite (they're SQL/migration + one edge
function change) — verify via Supabase's `execute_sql`/`apply_migration` tooling and a manual
`shared-workout` flow test.

**Done-when:** all four migrations applied and confirmed live (via `list_migrations`/`list_tables`);
`shared-workout.tsx`'s existing flow manually confirmed unbroken; retention-push edge function
redeployed with the timezone-aware quiet-hours logic; the cron-apply step documented as a founder
action item.

**Sonnet prompt:**
```
Read MASTER_FIX_PLAN.md section "F10 — Backend hardening migration" in full — it has four parts.
(1) Add indexes on workout_logs(user_id, completed_at) and set_logs(workout_log_id) via a new
migration. (2) Fix workout_shares' RLS: read exactly how shared-workout.tsx queries this table today
(by share code), then write RLS that matches that access pattern instead of the current blanket
"any authenticated user can read everything" policy -- do not break the existing share-by-code flow.
(3) Check whether calendar_connections' access_token/refresh_token columns (schema.sql:44-45) are
read by ANY live code path (grep thoroughly) -- if genuinely unused (real tokens live in
google_calendar_tokens per ARCHITECTURE.md), drop them in a migration; if anything reads them, stop
and report instead of dropping. (4) Add a user_profiles.timezone column (IANA string), populate it
using Intl.DateTimeFormat().resolvedOptions().timeZone wherever the profile row is first created
(check profile-setup.tsx/onboarding), and update the retention-push edge function
(mobile/supabase/functions/retention-push/index.ts) to use each user's real timezone for quiet-hours
instead of the hardcoded EVENING_HOUR_UTC_FALLBACK=18, falling back to the old UTC behavior for users
with no timezone set. Apply all migrations via the Supabase MCP tools and redeploy the edge function.
Follow CLAUDE.md No-Regressions -- part (2) is the highest-risk change here; test the share-by-code
flow manually before considering it done. Also add a note to EXECUTION_STATUS.md flagging that the
retention-push cron SQL in add_push_notifications.sql is still commented out and needs the founder
to apply it manually with their real project ref + Vault secret -- you cannot do this part. Report
back what you found for the calendar_connections grep, confirm the migrations are live, and describe
how you verified the workout_shares flow still works before I consider this done.
```

---

## P1 — Craft & coherence (what makes it feel like the #1 app)

These don't lose data or money, but they're the difference between "an impressively engineered
solo project" and something that reads as obsessively polished — the thing that makes someone say
"this is clearly better made than Fitbod." Work these after all P0 items are done and verified.

### C1 — Shared date utilities (`lib/dates.ts`) — ✅ DONE 2026-07-19

**The problem:** ~15 modules (`generatePlan.ts`, `planRollover.ts`, `splitSchedule.ts`,
`autoSchedule.ts`, `reschedule.ts`, `weekReschedule.ts`, `smartSchedule.ts`, `trainingLoad.ts`,
`adaptation.ts`, `missedWorkouts.ts`, `dedupeSchedule.ts`, `quickSuggestion.ts`, `quickWorkout.ts`,
`recovery.ts`, `streak.ts`) each re-implement their own "today as a local date string" / date-diff
logic. This is the structural root cause of the streak/missed-workout timezone fragility noted
elsewhere in this document — any future correctness fix has to be applied in 15 places instead of
one, and it already caused the UTC-vs-local mismatch in `adaptation.weeksBetween` (parses with
`T00:00:00Z` while everything else builds local dates).

**The fix:**
1. Create `mobile/src/lib/dates.ts` exporting: `todayStr()` (local YYYY-MM-DD, single source of
   truth — model it on `planRollover.ts`'s existing `formatLocalDate`, which is already correct;
   don't reinvent), `toDateStr(date: Date)`, `addDays(dateStr, n)`, `daysBetween(a, b)` (local, DST-
   safe — use date-only arithmetic, not millisecond division, to avoid DST shift errors), and
   `atMinute(dateStr, minutes)` (DST-safe time-of-day construction — this is what fixes the
   `smartSchedule.ts:73-74` DST bug named below).
2. Migrate all 15 modules to import from this file instead of their local re-implementation, one
   module at a time (this is mechanical but must be done carefully — verify each module's existing
   tests still pass after each migration, since subtly different date logic is exactly how
   regressions happen). Do NOT change any module's business logic while migrating — this batch is
   pure refactor, verified by the existing test suite staying green throughout.
3. Fix `adaptation.weeksBetween`'s UTC-vs-local mismatch as part of this migration (it should use the
   same local-date arithmetic as everything else — this was flagged as a real bug, not just
   inconsistency).
4. This migration also directly fixes: `smartSchedule.ts`'s DST minute-of-day bug (once `atMinute` is
   DST-safe and used consistently), and reduces the surface area for the streak timezone fragility
   named in the logic-review findings (though `streak.ts`'s "today judged tomorrow" logic itself is
   already correct — this fix just makes sure every caller agrees on what "today" means).

**Edge cases to test:** run the full existing test suite after each module migration (not just at
the end) — this is a wide-blast-radius refactor across the app's most load-bearing date logic, so
regressions must be caught module-by-module, not discovered at the end. Specifically test a date
computation across a DST transition boundary (e.g. "second Sunday in March" for US DST) for
`atMinute`/`daysBetween`.

**Files:** new `mobile/src/lib/dates.ts`, then edits to all 15 modules listed above (mechanical import
swaps + removing their local date helpers).

**Tests:** a new `dates.test.ts` covering `todayStr`, `addDays`, `daysBetween`, `atMinute` including a
DST-transition-date case. All existing suites for the 15 migrated modules must stay green.

**Done-when:** one canonical date-utility module exists; all 15 callers use it; zero duplicate
date-formatting logic remains in those files; full test suite green; DST edge case explicitly tested.

**Sonnet prompt:**
```
Read MASTER_FIX_PLAN.md section "C1 — Shared date utilities" in full. This is a wide-blast-radius
refactor -- go slowly. Create mobile/src/lib/dates.ts exporting todayStr(), toDateStr(date),
addDays(dateStr, n), daysBetween(a, b), and atMinute(dateStr, minutes), all local-timezone and
DST-safe (model todayStr on planRollover.ts's existing formatLocalDate, which is already correct --
don't reinvent the logic, just centralize it). Then migrate the 15 modules named in the section
(generatePlan.ts, planRollover.ts, splitSchedule.ts, autoSchedule.ts, reschedule.ts,
weekReschedule.ts, smartSchedule.ts, trainingLoad.ts, adaptation.ts, missedWorkouts.ts,
dedupeSchedule.ts, quickSuggestion.ts, quickWorkout.ts, recovery.ts, streak.ts) ONE AT A TIME to
import from dates.ts instead of their own local re-implementation, running that module's existing
tests after each single migration before moving to the next -- do not batch all 15 migrations before
testing. As part of this, fix adaptation.ts's weeksBetween, which currently parses dates with
T00:00:00Z (UTC) while every other module builds local dates -- align it to the new shared local-date
arithmetic. Do not change any module's business logic beyond the date-utility swap -- this is a pure
refactor. Add dates.test.ts with explicit coverage of a DST-transition date. Follow CLAUDE.md
No-Regressions strictly given the blast radius. Run npx tsc --noEmit + full suite after the full
migration, then show me a diff summary before committing -- consider splitting this into 2-3 commits
if the diff is large (e.g. scheduling modules in one commit, adaptation/streak/recovery in another).
```

---

### C2 — Theme sweep (kill hardcoded colors + dead imports/styles) — ✅ DONE 2026-07-19

**The problem:**
- A PR-celebration gold card is duplicated verbatim between `workout-complete.tsx:495` and
  `session-detail.tsx:381`, both hardcoding `#B8860B` — which doesn't adapt to light mode (renders as
  a muddy dark-gold that clashes with the "Paper" light theme).
- `workout-complete.tsx` has 15 hardcoded hex/rgba colors total, including `#4E8BFF` shadow colors
  that should reference `C.primary`, and imports `Colors`/`CardShadow` that are never used.
- ~14 files import the legacy `Colors` export unused (`index.tsx:15`, `plan.tsx:21`, `profile.tsx:8`,
  `progress.tsx:7`, `availability.tsx:16`, `legal.tsx:14`, `plan-explainer.tsx:15`,
  `quick-workout.tsx:7`, `workout-complete.tsx:6`, `weekly-report.tsx:15`, `travel-mode.tsx:22`,
  `sign-in.tsx:12`, `onboarding/profile-setup.tsx:11`, `onboarding/plan-preview.tsx:6`).
- ~20 modal/stack screens carry dead `header`/`headerTitle` StyleSheet entries left over from
  migrating to the shared `ScreenHeader` component (`session-detail`, `quick-workout`, `my-workouts`,
  `my-splits`, `social`, `split-editor`, `workout-builder`, `weekly-report`, `workout-history`,
  `shared-workout`, `friend-profile`, `plan-explainer`, `pr-browser`, `exercise-library`,
  `exercise-progress`, `edit-session`, `calendar-setup`, `travel-mode`, `availability`, `legal`).

**The fix:**
1. Build one shared `PRCard` component (in `mobile/src/components/`) that themes correctly in both
   light/dark using `C.*` tokens (pick a gold/accent token that actually exists in the theme, or add
   one if none does — check `theme.ts`/`tokens.ts` for the existing palette before inventing a new
   color). Replace both duplicated inline blocks in `workout-complete.tsx` and `session-detail.tsx`
   with this component.
2. In `workout-complete.tsx`, replace all 15 hardcoded colors with the corresponding theme tokens
   (`#4E8BFF` → `C.primary`, etc. — map each one individually by what it's visually doing, not a
   blind find-replace) and remove the unused `Colors`/`CardShadow` imports.
3. Remove the unused `Colors` import from all ~14 files listed above (mechanical — confirm each is
   genuinely unused before removing, per CLAUDE.md's "never delete without understanding why it's
   there").
4. Remove the dead `header`/`headerTitle` (and `quick-workout.tsx`'s unused `iconBtn`) StyleSheet
   entries from the ~20 files listed, confirming each screen genuinely uses `ScreenHeader` now and
   isn't secretly still referencing the old style object anywhere.

**Edge cases to test:** toggle light/dark mode and confirm the new `PRCard` looks correct in both;
confirm `workout-complete.tsx` renders identically to before in dark mode (its current default) after
the token swap — this should be a visual no-op in dark mode and a fix in light mode.

**Files:** new `mobile/src/components/PRCard.tsx`, `workout-complete.tsx`, `session-detail.tsx`, plus
the ~14 files (unused `Colors` import removal) and ~20 files (dead style removal) listed above.

**Tests:** no new logic to test (pure UI/style refactor); rely on `tsc` catching any accidental
breakage from removing imports/styles that turn out to still be referenced somewhere.

**Done-when:** zero hardcoded `#B8860B`/`#4E8BFF` etc. remain in `workout-complete.tsx`/
`session-detail.tsx`; `PRCard` used in both places; zero unused `Colors` imports remain; zero dead
`header`/`headerTitle` styles remain; `tsc` clean (this is the safety net for "did I remove something
still in use").

**Sonnet prompt:**
```
Read MASTER_FIX_PLAN.md section "C2 — Theme sweep" in full. Three tasks: (1) build a new
mobile/src/components/PRCard.tsx themed component using existing C.* tokens from the app's theme
system (check theme.ts/tokens.ts for the actual token names before inventing new ones -- add a token
if genuinely none fits, don't hack a hex value into the component), and replace the duplicated
hardcoded #B8860B gold-card blocks in workout-complete.tsx:495 and session-detail.tsx:381 with it.
(2) In workout-complete.tsx, replace all remaining hardcoded hex/rgba colors (15 total, e.g. #4E8BFF
shadow -> C.primary) with the matching theme token for what each color is visually doing, and remove
the unused Colors/CardShadow imports. (3) Remove the unused legacy Colors import from these 14 files
(confirm each is truly unused first): index.tsx, plan.tsx, profile.tsx, progress.tsx,
availability.tsx, legal.tsx, plan-explainer.tsx, quick-workout.tsx, workout-complete.tsx,
weekly-report.tsx, travel-mode.tsx, sign-in.tsx, onboarding/profile-setup.tsx,
onboarding/plan-preview.tsx -- and remove dead header/headerTitle (and quick-workout.tsx's iconBtn)
StyleSheet entries from these 20 files, confirming each already uses the shared ScreenHeader:
session-detail, quick-workout, my-workouts, my-splits, social, split-editor, workout-builder,
weekly-report, workout-history, shared-workout, friend-profile, plan-explainer, pr-browser,
exercise-library, exercise-progress, edit-session, calendar-setup, travel-mode, availability, legal.
Follow CLAUDE.md No-Regressions -- verify each removal against actual usage, don't blind
find-replace. Run npx tsc --noEmit as the primary safety check (it will catch any style/import still
referenced), then manually confirm workout-complete.tsx looks visually unchanged in dark mode and
correctly themed in light mode. Show me a diff summary before committing -- split into a couple of
commits if the diff is large.
```

---

### C3 — Shared ProPill + unified loading component — ✅ DONE 2026-07-20

**2026-07-20/21 addendum:** after C3, work was redirected to a real founder device-testing/
bug-report queue rather than continuing straight into C4 — 12 fixes (RevenueCat web crash, 4
Focus Mode fixes, the GO chooser always showing, a form-guide-instructions lazy-backfill RPC, two
multi-workout-per-day visibility gaps [Home + Plan tab], permanent exercise deletion
[`excluded_exercise_ids`], a new Pro plate calculator, plus confirming weekly-report push and
multi-calendar are already fully live with no code work remaining). Full detail in
`EXECUTION_STATUS.md`'s Current Focus and `PRODUCT_AUDIT.html`'s Update Log (2026-07-20/21 entry).
**C4–C10 are still open** — resume there next.

**Note on scope vs. the original audit:** `paywall.tsx:485`'s `planBadge` was named as a 4th "PRO
pill," but it actually renders `{badge}` (dynamic text: "SAVE X%" / "BEST VALUE"), never literally
"PRO" — a stale/mistaken reference from the original audit, not a real duplicate. Left untouched.
`quick-workout.tsx` turned out to have *two* gold pills: `proTag` (a plain duplicate of `ProBadge`,
next to the "EQUIPMENT" label — consolidated) and `proBadgeRow` (a tinted, lock-icon variant on the
workout-preview teaser card — genuinely different visual treatment for a different context, left
as-is). `ProGate.tsx`'s existing `ProBadge` was extended with an optional `icon` prop (needed for
`profile.tsx`'s flash-icon variant) rather than duplicated.

**The problem:** Four separate "PRO" pill implementations exist (`ProGate.tsx:86`, `paywall.tsx:485`,
`quick-workout.tsx:444`, `profile.tsx:625`), each hardcoding its own gold/dark text styling instead of
sharing one component. Separately, loading states use five different visual conventions across the
app (`PulseLoader`, `TempoPulse`, `ActivityIndicator`, `Shimmer`, `LoadingCard`, and a plain muted
`<Text>` in `muscle-map.tsx:118`) with no single rule for when to use which.

**The fix:**
1. Extract one `ProPill` component (check `ProGate.tsx`'s existing implementation as the best
   starting point since it's presumably the most battle-tested) and use it in all four locations.
2. Pick ONE loading convention as the app's standard (recommend `PulseLoader`, since it's already the
   most-used branded pattern) and replace `muscle-map.tsx:118`'s plain-text loading state with it.
   Don't force-migrate every `ActivityIndicator`/`Shimmer` usage in one pass if they're serving a
   genuinely different purpose (e.g. a shimmer skeleton vs a full-screen loader) — just fix the one
   named inconsistency (muscle-map) and document the intended convention (a short comment or a note
   in `ARCHITECTURE.md`) so future screens don't add a sixth pattern.

**Edge cases to test:** confirm `ProPill` renders identically (or intentionally improved, not
regressed) in all four original locations, in both light/dark themes.

**Files:** new/consolidated `mobile/src/components/ProPill.tsx` (or promote `ProGate.tsx`'s existing
implementation), `paywall.tsx`, `quick-workout.tsx`, `profile.tsx`, `muscle-map.tsx`.

**Tests:** none beyond `tsc` + visual confirmation (pure UI consolidation).

**Done-when:** one `ProPill` used in all four places; `muscle-map.tsx` uses `PulseLoader`; a one-line
convention note added to `ARCHITECTURE.md`'s component section.

**Sonnet prompt:**
```
Read MASTER_FIX_PLAN.md section "C3 — Shared ProPill + unified loading component" in full. Extract
one ProPill component from the best existing implementation (check ProGate.tsx:86 first) and use it
in place of the three other duplicated PRO-pill implementations in paywall.tsx:485,
quick-workout.tsx:444, and profile.tsx:625. Separately, replace muscle-map.tsx's plain-text loading
state (line 118) with the app's PulseLoader component, matching the convention used elsewhere. Add a
short note to ARCHITECTURE.md documenting PulseLoader as the standard loading convention so future
screens don't introduce a sixth pattern. Follow CLAUDE.md No-Regressions -- confirm the consolidated
ProPill renders correctly in both light/dark themes in all four locations before committing. Run
npx tsc --noEmit, then show me a diff summary.
```

---

### C4 — Accessibility batch

**The problem:** 808 touchables vs 110 accessibility annotations app-wide. Worst screens: `plan.tsx`
(100 touchables / 27 annotations), `index.tsx` (69/7), `profile.tsx` (47/9), `social.tsx` (42/6).
Selection chips (quick-workout duration/purpose/preset chips, muscle-map toggles) never set
`accessibilityState={{selected: true/false}}`, so a screen-reader user can't tell what's currently
selected. Paywall footer links (Restore/Terms/Privacy) are bare `<Text onPress>` with no
`accessibilityRole="button"` and no `hitSlop`.

**The fix (scoped — this is a large surface; do the highest-impact fixes, not an exhaustive pass):**
1. Add `accessibilityState={{selected}}` to every selection-chip component identified in the UI
   review (quick-workout's duration/purpose/preset chips, muscle-map's toggles, onboarding's
   experience-level chips if applicable).
2. Add `accessibilityRole="button"` + `accessibilityLabel` (a short description of what each button
   does — infer from the icon/adjacent text) + `hitSlop` to paywall's footer links.
3. On the four worst screens (`plan.tsx`, `index.tsx`, `profile.tsx`, `social.tsx`), add
   `accessibilityLabel` to icon-only touchables that currently have none — prioritize primary actions
   (start workout, log set, navigate to a key screen) over decorative/secondary ones given the size of
   this surface. Don't attempt all 100+ touchables in `plan.tsx` in one batch — this should likely be
   its own sub-batch per screen if the diff gets large (split into `C4a` plan.tsx, `C4b` index.tsx,
   `C4c` profile.tsx+social.tsx if needed).

**Edge cases to test:** turn on VoiceOver (or the RN accessibility inspector) and confirm selected
chips announce their state, and the paywall footer links announce as buttons with meaningful labels.

**Files:** `mobile/src/app/quick-workout.tsx`, `mobile/src/app/muscle-map.tsx`, `mobile/src/app/paywall.tsx`,
`mobile/src/app/(tabs)/plan.tsx`, `mobile/src/app/(tabs)/index.tsx`, `mobile/src/app/(tabs)/profile.tsx`,
`mobile/src/app/social.tsx`.

**Tests:** accessibility props aren't typically unit-tested in this codebase's existing suite; rely
on manual VoiceOver/inspector verification, documented in the on-device checklist.

**Done-when:** all selection chips expose `accessibilityState`; paywall footer links are real
accessible buttons; the four worst screens' primary-action touchables have labels; `tsc` clean.

**Sonnet prompt:**
```
Read MASTER_FIX_PLAN.md section "C4 — Accessibility batch" in full. This is a large surface -- do it
in this order and stop to show a diff after each part if it's getting large. (1) Add
accessibilityState={{selected}} to quick-workout.tsx's duration/purpose/preset selection chips and
muscle-map.tsx's toggle chips. (2) Add accessibilityRole="button", a meaningful accessibilityLabel,
and hitSlop to paywall.tsx's footer links (Restore/Terms/Privacy). (3) Add accessibilityLabel to
icon-only touchables in plan.tsx, index.tsx, profile.tsx, and social.tsx -- prioritize primary
actions (start workout, log a set, navigate to a key screen) over decorative/secondary touchables
given there are 100+ in plan.tsx alone; don't try to label every single one in this pass, focus on
what a screen-reader user actually needs to operate the app's core flows. Follow CLAUDE.md
No-Regressions -- these are additive prop changes, no behavior changes. Run npx tsc --noEmit, then
describe how I can manually verify with VoiceOver or the RN accessibility inspector before
committing.
```

---

### C5 — Split `plan.tsx` into Plan hub + Workout Runner

**The problem:** `plan.tsx` is 3,315 lines — the largest file in the app — because it fuses two
genuinely distinct screens: the pre-session Plan hub (calendar/split/library browsing, roughly the
first ~1,800 lines) and the live workout-logging Runner (timer, set actions, rest, Focus Mode wiring,
complete-workout, roughly lines ~2,186 onward). This is the single biggest structural/maintainability
risk named in the UI review — every future Plan-related change has to navigate a 3,000+ line file
with two unrelated concerns tangled together.

**The fix:** This is a **pure extraction, not a rewrite** — the goal is zero behavior change, just
moving code into two files that already-passing tests and `tsc` can verify didn't break anything.
1. Read the full file first to precisely map where the hub ends and the runner begins (the line
   numbers above are estimates from the review, not verified boundaries — confirm exactly by reading
   the file's own state/navigation logic, e.g. what triggers the transition from hub view to runner
   view).
2. Extract the Runner portion into a new file (e.g. `mobile/src/app/(tabs)/plan-runner.tsx` if it
   needs to stay a route, or `mobile/src/components/WorkoutRunner.tsx` if it's rendered conditionally
   within the same route rather than being a separate navigable screen — determine which based on how
   navigation currently works; do NOT change the navigation structure/URL scheme as a side effect of
   this refactor unless it's already effectively a conditional render within one route, in which case
   extracting to a component preserves that).
3. Extract shared types/helpers used by both halves into a small shared module if needed, rather than
   duplicating them.
4. Verify obsessively: every prop, handler, conditional render, and edge-case branch identified in the
   original file must still exist and behave identically post-split — this is exactly the kind of
   change CLAUDE.md's "No Regressions" section warns about most specifically ("when moving or
   refactoring UI, preserve every existing prop, handler, conditional render... even ones that look
   redundant").

**Edge cases to test:** every interaction the UI review's on-device checklist already names for Plan
(delete a split day → reschedule-week restores it; start a live session → GO tab hides, Focus Mode
opens on rest, every existing runner control still reachable) must still work identically after the
split — re-run the FULL existing on-device checklist for Plan/Runner from `EXECUTION_STATUS.md`
after this change, not just a spot-check.

**Files:** `mobile/src/app/(tabs)/plan.tsx` (split into two), new file(s) as determined by the
navigation analysis above.

**Tests:** run the FULL existing test suite (not a subset) after the split — any test that imports
from `plan.tsx` directly may need its import path updated; this is the primary safety net for a
pure-extraction refactor. If Plan/Runner currently have any component-level tests, confirm they all
still pass unmodified in behavior.

**Done-when:** `plan.tsx` (or its hub half) is meaningfully smaller; the Runner logic lives in its own
file; `tsc` clean; full test suite green with zero test-behavior changes (only import-path updates if
needed); the full existing Plan/Runner on-device checklist re-confirmed.

**Sonnet prompt:**
```
Read MASTER_FIX_PLAN.md section "C5 — Split plan.tsx into Plan hub + Workout Runner" in full. This
is a pure extraction refactor, not a rewrite -- zero behavior change is the goal. First, read the
ENTIRE current plan.tsx (3,315 lines) to precisely find where the pre-session Plan hub ends and the
live Workout Runner begins (the ~1,800/~2,186 line estimates in the plan are approximate -- verify
the real boundary by understanding what state/navigation transitions the view from hub to runner).
Then extract the Runner into its own file -- determine whether it should be a new route or a
component rendered conditionally within the same route based on how navigation currently works; do
not change the app's navigation/URL structure as a side effect of this refactor. Preserve every
single prop, handler, conditional render, and edge-case branch exactly as CLAUDE.md's No-Regressions
section requires -- if you don't understand why a check exists, keep it, don't delete it as
"redundant." After the split, run the FULL test suite (not a subset) and npx tsc --noEmit. Then list
out the complete on-device checklist for Plan/Runner from EXECUTION_STATUS.md and confirm each item
is still true by tracing the code (delete a split day -> reschedule-week restores it; start a live
session -> GO tab hides, Focus Mode opens on rest, every existing runner control still reachable;
edit a logged set in the runner -> volume/PR numbers update; etc). Show me a diff summary and the
full checklist trace before committing -- if the diff is large, propose splitting into 2 commits
(the extraction itself, then any cleanup).
```

---

### C6 — Typed routes + push-notification routing completeness

**The problem:** ~40 `router.push(...)` call sites are cast `as any`/`as never` because Expo Router's
typed-routes feature isn't actually enabled/working (one comment even says "typed-routes regen on
next run" — shipped with the workaround still in place). This means a typo'd route path is a silent
runtime dead-end instead of a compile error. Separately, push-notification tap routing
(`_layout.tsx:206-212`) only maps 5 specific `data.screen` values; any other value the server might
someday send silently does nothing when tapped.

**The fix:**
1. Investigate why typed routes aren't active (check `app.json`'s `experiments.typedRoutes` setting
   and whether a `.expo/types/router.d.ts` file is being generated — per the comment, this may just
   require running the dev server once locally to regenerate types, or there may be a real config
   issue). If it's a config issue, fix it and remove the `as any`/`as never` casts across the ~40 call
   sites (mechanical once types are actually generating correctly — `tsc` will tell you exactly which
   casts are now safe to remove and which still need a real fix). If enabling it reveals genuinely
   invalid routes among those 40, fix each one rather than re-casting it away.
2. In `_layout.tsx`'s push-notification routing, add a `default` case that navigates Home instead of
   silently no-op'ing on an unrecognized `data.screen` value — this ensures a future server-side
   notification-type addition doesn't quietly become a dead tap even before the corresponding client
   case is added.

**Edge cases to test:** confirm every one of the ~40 previously-cast routes still navigates correctly
after removing the cast (this is where `tsc` earns its keep — if a route path was actually wrong, it
will now fail to compile, which is the whole point of this fix). Confirm an unrecognized push
`data.screen` value now falls back to Home instead of doing nothing.

**Files:** `mobile/app.json` (if config fix needed), the ~40 call sites across the app (mechanical
cast removal), `mobile/src/app/_layout.tsx` (push routing default case).

**Tests:** `tsc` is the primary safety net here (that's the entire point of enabling typed routes).
No new runtime tests needed beyond confirming the app still builds and key navigations work.

**Done-when:** typed routes are genuinely active (verify by intentionally introducing a typo'd route
in a scratch test and confirming `tsc` now catches it, then reverting the scratch test); zero
remaining `as any`/`as never` on `router.push` calls; push routing has a sane default.

**Sonnet prompt:**
```
Read MASTER_FIX_PLAN.md section "C6 — Typed routes + push-notification routing completeness" in
full. First investigate why Expo Router's typed routes aren't actually active despite ~40 router.push
calls being cast as any/as never (one comment says "typed-routes regen on next run") -- check
app.json's experiments.typedRoutes setting and whether route types are actually being generated.
Fix the underlying config/generation issue if there is one. Once typed routes genuinely work, remove
the as any/as never casts across the app -- npx tsc --noEmit will tell you exactly which ones are now
safe to remove and which reveal a genuinely wrong route path that needs a real fix (fix those, don't
re-cast them away). Separately, in _layout.tsx's push-notification tap routing (around lines
206-212), add a default case that navigates Home instead of silently doing nothing for an
unrecognized data.screen value. Follow CLAUDE.md No-Regressions -- verify each route still navigates
to the correct destination after cast removal, don't just make it compile. Run npx tsc --noEmit as
your primary verification (that's the whole point of this fix), then show me a diff summary,
including how many call sites you were able to de-cast versus how many revealed a real routing bug
you had to fix.
```

---

### C7 — Virtualize long lists

**The problem:** Only 4 files use `FlatList` (`exercise-library.tsx`, `pr-browser.tsx`,
`ExercisePickerSheet.tsx`, `TempoSheet.tsx`). Everything else — including `workout-history.tsx`,
`social.tsx`'s feed, and parts of `plan.tsx` (49 `.map`/`ScrollView` hits) — renders lists via `.map`
inside a `ScrollView`, which renders every item at once regardless of list length. For a user with
months of workout history or an active social feed, this is unbounded memory/render cost that gets
worse over time, not a fixed cost.

**The fix:** Convert the genuinely long, unbounded lists to `FlatList` — prioritize
`workout-history.tsx` (grows monotonically with app usage — the clearest case) and `social.tsx`'s
feed (grows with social activity) first. Leave short, bounded lists (e.g. a fixed 3-5 item context
strip) as `.map`/`ScrollView` — virtualization has its own overhead and isn't worth it for lists that
never grow large. Use the existing `FlatList` usages in this codebase as the pattern to follow for
styling/separators/empty-state consistency rather than introducing a new convention.

**Edge cases to test:** confirm pull-to-refresh (if present), pagination/infinite-scroll (if any), and
empty states all still work identically after the `FlatList` conversion — these are exactly the
behaviors most likely to subtly break during a ScrollView→FlatList migration (different scroll-event
semantics, `ListEmptyComponent` vs a manual empty check, etc).

**Files:** `mobile/src/app/workout-history.tsx`, `mobile/src/app/social.tsx` (feed section only, not
the whole screen if it mixes list + non-list content).

**Tests:** no new logic to test; rely on `tsc` + manual scroll/empty-state verification.

**Done-when:** `workout-history` and social feed use `FlatList`; existing empty-state/pull-to-refresh
behavior confirmed unchanged; `tsc` clean.

**Sonnet prompt:**
```
Read MASTER_FIX_PLAN.md section "C7 — Virtualize long lists" in full. Convert workout-history.tsx's
list rendering and social.tsx's feed section (not the whole screen, just the feed list part) from
.map-inside-ScrollView to FlatList, using the styling/separator/empty-state conventions already
established in this codebase's existing FlatList usages (check exercise-library.tsx or pr-browser.tsx
as the pattern). Preserve any existing pull-to-refresh or empty-state behavior exactly -- this is
where ScrollView-to-FlatList migrations most often subtly break something (different scroll-event
semantics, ListEmptyComponent vs an inline empty check). Follow CLAUDE.md No-Regressions. Run
npx tsc --noEmit, then describe how to manually verify pull-to-refresh and the empty state still work
on both screens before committing.
```

---

### C8 — Differentiate Terms vs Privacy links

**The problem:** In `paywall.tsx:352/354`, `sign-in.tsx:200/202`, and `settings.tsx:564`, both
"Terms" and "Privacy" links navigate to the exact same `/legal` screen with no way to distinguish
which section the user meant to read — a minor but real App Store review sensitivity (reviewers
sometimes specifically click both links to confirm they're distinct/correct).

**The fix:** Add a `section` param to the `/legal` route (`?section=terms` or `?section=privacy`),
have `legal.tsx` read it and either scroll to the corresponding section (if both are on one page) or
show only that section — check `legal.tsx`'s current structure first to determine which approach fits
its existing content layout (a combined single-page doc vs. two distinct blocks) rather than assuming.

**Edge cases to test:** confirm both links (in all 3 locations) now land on visually distinguishable
content; confirm navigating to `/legal` with no param at all (if that path is reachable from anywhere
else) still shows something sensible (e.g. defaults to showing both/Terms first).

**Files:** `mobile/src/app/legal.tsx`, `mobile/src/app/paywall.tsx`, `mobile/src/app/sign-in.tsx`,
`mobile/src/app/settings.tsx`.

**Tests:** none beyond `tsc` + manual navigation check.

**Done-when:** Terms and Privacy links in all three source screens visibly land on different content;
`tsc` clean.

**Sonnet prompt:**
```
Read MASTER_FIX_PLAN.md section "C8 — Differentiate Terms vs Privacy links" in full. Read legal.tsx
first to see its current structure (a single combined doc, or already two distinct sections) and add
a section query param (?section=terms or ?section=privacy) that either scrolls to or shows the
correct part, matching whatever structure the file already has rather than restructuring it. Update
the three call sites -- paywall.tsx (lines ~352/354), sign-in.tsx (~200/202), and settings.tsx
(~564) -- to pass the correct param for their respective Terms/Privacy links. Follow CLAUDE.md
No-Regressions. Run npx tsc --noEmit, then confirm all three screens' links now land on visibly
distinct content before committing.
```

---

### C9 — Analytics completeness

**The problem:**
1. `session_start` only fires for Quick Workouts (`quick-workout.tsx:181`) — the actual core loop
   (starting a *planned* session from `plan.tsx`) never emits `session_start`, only a one-time
   `first_workout_started` event. Since `session_end` fires for both paths (`workout-complete.tsx:82`),
   the planned-session start→end funnel is structurally uncomputable — a serious gap for a product
   whose entire wedge is planned, calendar-scheduled training.
2. Home (`(tabs)/index.tsx`) and Progress (`(tabs)/progress.tsx`) — the two most-used screens — have
   zero `track()` calls.
3. `trial_converted` is mislabeled: it fires on any direct no-trial purchase (`_layout.tsx:137`), not
   on an actual trial-to-paid conversion (which never fires it since the user is already `isPro` by
   then).
4. `app_open` double-fires: once on mount (`_layout.tsx:185`), again on any notification tap
   (`_layout.tsx:205`).

**The fix:**
1. Add a `session_start` event fired when a planned session actually begins in `plan.tsx`'s runner
   (find the exact point where a session transitions from "not started" to "in progress" — likely the
   same point `first_workout_started` already fires from, but that event should stay as a distinct
   one-time celebration marker; add `session_start` alongside it for every session, not just the
   first).
2. Add a `screen_view` (or equivalent, matching whatever the existing `EventProperties` taxonomy
   calls screen-view events, if anything — check `analytics.ts`) call to Home and Progress on mount.
3. Rename/refactor the mislabeled event: distinguish a true trial-to-paid conversion (fires when a
   user who WAS in trial status becomes a paying non-trial subscriber) from a direct purchase with no
   trial — these need to be two different events, not one overloaded one.
4. Fix `app_open`'s double-fire: the notification-tap handler should not re-fire `app_open` if the
   mount-time one already fired for this launch — add a simple guard (e.g. a module-level flag reset
   per cold launch) so a notification tap that also happens to be the app's first open doesn't count
   twice.

**Edge cases to test:** manually trigger a planned-session start and confirm `session_start` now fires
with the same properties shape used for quick-workout's version (for funnel consistency); confirm
Home/Progress screen-view events fire once per navigation, not on every re-render; confirm opening the
app via a notification tap fires `app_open` exactly once total, not twice.

**Files:** `mobile/src/app/(tabs)/plan.tsx` (or wherever the runner start logic lives post-C5's
split), `mobile/src/app/(tabs)/index.tsx`, `mobile/src/app/(tabs)/progress.tsx`,
`mobile/src/app/_layout.tsx`, `mobile/src/lib/analytics.ts` (if `EventProperties` needs a new event
key added).

**Tests:** if `analytics.ts` has any existing test coverage for event shape/typing, extend it;
otherwise this is primarily manually-verified (check the PostHog dashboard/live events after a test
build, or at minimum confirm the `track()` calls fire with correct arguments via a console log during
local dev).

**Done-when:** `session_start` fires for planned sessions; Home/Progress have basic screen-view
tracking; `trial_converted` semantics are correct; `app_open` fires exactly once per cold launch even
when combined with a notification tap; `tsc` clean.

**Sonnet prompt:**
```
Read MASTER_FIX_PLAN.md section "C9 — Analytics completeness" in full. Four fixes: (1) add a
session_start track() call when a planned session actually begins in the workout runner (find the
exact transition point -- it's likely near where first_workout_started already fires, but
session_start should fire for every session start, not just the first one; keep
first_workout_started as its own distinct one-time celebration event). (2) Add basic screen-view
tracking to Home (index.tsx) and Progress (progress.tsx) on mount, using whatever the existing
EventProperties taxonomy in analytics.ts already establishes as the convention for this kind of
event -- check if one exists before inventing a new event shape. (3) Fix trial_converted in
_layout.tsx (line ~137) so it only fires for an actual trial-to-paid conversion, not any direct
no-trial purchase -- these need to be distinguishable as two different events. (4) Fix app_open's
double-fire (mount at line ~185, notification tap at ~205) with a simple per-cold-launch guard so a
notification-tap-triggered open doesn't double-count. Follow CLAUDE.md No-Regressions -- these are
additive tracking calls plus one guard condition, no behavior changes to the app itself. Run
npx tsc --noEmit, then describe how to manually verify each event fires correctly (e.g. via a local
console log or checking the PostHog live event stream) before committing.
```

---

### C10 — Dependency hygiene

**The problem:** `package.json` has both `lottie-react-native` (the real RN library, used for
`TempoLottie`) AND `@lottiefiles/dotlottie-react` — a web/DOM-targeting React package that has no
place in a React Native bundle. This is either dead weight bloating the bundle or a wrong-platform
import waiting to break a build. Separately, `lottie-react-native` has no corresponding config-plugin
entry in `app.json`, which historically has been required for it to work correctly on iOS.

**The fix:**
1. Grep the entire codebase for any import of `@lottiefiles/dotlottie-react` — if genuinely unused
   (likely, since `TempoLottie` was built against `lottie-react-native`), remove it from
   `package.json` entirely. If something does import it, investigate why (possibly an accidental
   install) before removing.
2. Check Expo/`lottie-react-native`'s current documentation (via `WebFetch`/`WebSearch` if needed,
   or the package's own README in `node_modules`) for whether a config-plugin entry is required for
   the currently-installed version on the currently-targeted Expo SDK (56) — add it to `app.json` if
   so.
3. Note (don't fix, just document in `EXECUTION_STATUS.md`) that the `development` EAS profile has no
   `env` block, meaning teammate dev builds silently run without backend keys unless they have a
   `.env.local` — this is a minor DX issue, not a shipped-app risk, so it's fine to just flag it for
   the founder rather than treat as a required fix.

**Edge cases to test:** after removing the unused Lottie package, confirm existing `TempoLottie`
usages (sign-in wave, Focus Mode sprint, onboarding pointing, workout-complete high-five) still import
correctly and `tsc`/the bundler don't complain about a missing dependency.

**Files:** `mobile/package.json`, `mobile/app.json` (if a config-plugin entry is needed),
`mobile/EXECUTION_STATUS.md` (doc note only).

**Tests:** none beyond `tsc` + confirming the app still bundles (this can't be fully verified without
a real build, so note this explicitly in the on-device checklist for the founder).

**Done-when:** the unused Lottie dependency is removed (or its real usage is found and documented);
a config-plugin entry is added if the current library version genuinely needs one; the dev-profile env
gap is documented as a minor founder-facing note.

**Sonnet prompt:**
```
Read MASTER_FIX_PLAN.md section "C10 — Dependency hygiene" in full. Grep the entire mobile/src
codebase for any import of @lottiefiles/dotlottie-react. If nothing imports it (the app's TempoLottie
wrapper should be built against lottie-react-native only), remove it from package.json entirely. If
you find a real usage, investigate and report it instead of removing blind. Then check whether the
currently-installed lottie-react-native version needs a config-plugin entry in app.json for Expo SDK
56 (check its README/docs via WebFetch if needed) and add one if so. Finally, add a short note to
EXECUTION_STATUS.md flagging that the 'development' EAS profile has no env block, so teammate dev
builds silently run without backend keys unless they have a local .env.local -- this is a doc note
for the founder, not something to fix in this batch. Follow CLAUDE.md No-Regressions. Run
npx tsc --noEmit, confirm the four existing TempoLottie usages (sign-in, FocusMode, onboarding,
workout-complete) still reference lottie-react-native correctly, then show me what you found for the
dotlottie grep before committing.
```

---

## P2 — Wedge amplifiers (deepen what makes Tempo #1 in its lane)

Per `EXECUTION.md`'s M4 freeze, **do not start these until the founder has completed on-device
verification of the existing 🔍 backlog and P0 of this document is done and shipped.** These are
listed here so a future session picks up in the right order, not as a green light to start now.

- **W1 — Offline write queue.** Set logging and workout completion currently have no retry/queue —
  a failed write in a gym dead zone can lose the session (per-action `Alert` only). Build a persisted
  mutation queue (survives app close) that replays on reconnect, specifically for: logging a set,
  completing a workout, saving a custom exercise/template. This directly serves the audit's own
  finding that reliability is Tempo's actual differentiator opportunity, not just its cost of entry.
- **W2 — Readiness → scheduling feedback** (already B5.3 in `EXECUTION.md`'s roadmap). Low readiness
  on a given day suggests moving today's heavy session rather than just showing a chip — the loop
  only a calendar-native product can close.
- **W3 — Smart notification timing.** Use the calendar Tempo already reads to avoid nudging a user
  mid-meeting — a small, high-credibility "the app actually knows my day" touch.
- **W4 — Weekly "plan your week" ritual.** A Sunday-anchored moment built around the wedge — flagged
  explicitly as a **new surface**, so it needs the M4 gate + founder sign-off before starting, not a
  unilateral build.
- **W5 — HealthKit import** (B5.2). Native rebuild batch — real readiness signal, batch together with
  any other pending native-module work to minimize `eas build` cycles.
- **W6 — Streak counted by days, not sessions.** `sessionStreak` currently increments per completed
  session (`streak.ts:69,83`), so two workouts in one day add 2 to what's presented as a "day streak."
  Fix to count distinct days, and consider (small, optional) a documented streak-repair grace mechanic
  if product wants one — but the minimum fix is just correctness: a day streak should mean days.

---

## P3 — Table stakes worth having (post-verification, data-gated)

Only pull these in once P0/P1 are shipped and the founder's on-device verification pass is complete,
per `EXECUTION.md`'s own discipline that "every batch names a metric" and undated feature work
shouldn't jump the queue:

- Plate calculator + bar-load helper in the runner (cheap, real logging-parity item, audit item #22).
- Superset/circuit support in the runner (audit item #21).
- Exercise preferences ("love this" / "never show again") — audit item #14, real personalization the
  user can feel.
- Deload/illness "pause my plan" mode (audit item #31) — graceful pause instead of a guilt-inducing
  broken streak.
- Home/no-equipment first-class workout mode (audit item #24) — a large reachable segment given
  Tempo already models equipment.

---

## P4 — Deferred, M4-gated (do not build without explicit founder go-ahead)

Listed here only so a future Sonnet session doesn't invent scope that's explicitly rejected/postponed
in `EXECUTION.md` §2: **Tempo Coach** (LLM tentpole), **referral program**, **"Year in Training"
Wrapped**, **Apple Watch companion**, **home-screen widget**. All correctly blocked until the
retention data from `EXECUTION_STATUS.md`'s M4 milestone says the core loop actually holds a cohort.
If asked to build any of these, point back to this line and `EXECUTION.md` §2/§8 (guardrail-check
prompt) instead.

---

## 2026-07-19 addendum — founder device-testing batch (Focus Mode + runner)

Real on-device feedback arrived the same day this plan was written, concentrated on Focus Mode and
the workout runner. Worked through it directly rather than re-filing it as new P0/P1 rows, since it
was mostly concrete bugs the founder had already diagnosed by using the app. **Fixed and shipped
this session** (each its own commit, `tsc` + full suite green throughout):

- **Focus Mode's bottom SKIP/DONE buttons could render below the screen**, unreachable, once the
  "how much did you do?" card appeared — no ScrollView existed, just a fixed `View` that silently
  overflowed. Wrapped the scrollable content in a `ScrollView` + `KeyboardAvoidingView`; SKIP/DONE
  now live in a fixed footer outside the scroll area, always reachable.
- **The numeric keyboard had no way to dismiss** — same root cause (no ScrollView means no natural
  tap-to-dismiss); fixed by the same change.
- **The "×2 per side" unilateral toggle could clip off-screen** on narrower phones — the exercise-
  actions row (Focus/Form guide/Swap/Per side?) had no `flexWrap`; added it.
- **Focus Mode never asked for RPE at all** — the RPE follow-up bar existed in the runner's list view
  but was never rendered inside Focus Mode. Added it, wired to the same `attachRpe` path.
- **"Last set should be able to put in RPE"** — root-caused to a real bug, not a missing feature:
  Focus Mode's auto-close effect closed the instant an exercise's last set logged, before rest (or
  the RPE/weight editor) ever got a chance to render for that final set. Fixed the effect to wait for
  rest to end, matching every other set — this is also what fixes the "abrupt switching" complaint.
- **The rest-timer ring was a dead tap target** — made it tappable (skips rest, same as the SKIP
  button) with a "TAP RING TO SKIP REST" hint underneath so the interaction is discoverable.
- **"View form video" renamed to "View form guide"** — the preview isn't always a video.
- **The "checking twice" confusion** — a completed set's edit-entry icon was a checkmark (tap to
  edit), and confirming that edit was a *different* checkmark (`checkmark-done`) — reads as
  "check it again." Changed the edit-entry icon to a pencil and the confirm icon to a single plain
  checkmark, so there's exactly one checkmark in the whole flow and it always means "confirm."
  Also fixed `FocusMode.tsx`'s dead `done ? 'DONE' : 'DONE'` ternary (found independently, same file)
  to `'ALL DONE'` / `'DONE'`, and disabled the button in the done state since pressing it was already
  a no-op.
- **Focus Mode made optional** — new Settings toggle ("Workout Focus Mode"); off means the classic
  scrolling list only, for anyone who prefers it.
- **Home said "Start Session" even for a workout already paused mid-session** — added a query for
  today's in-progress `workout_logs` rows (created only on explicit start, never completed) and
  threaded a `started` flag through `workoutState()`; both the hero CTA and the second-session ghost
  button now say "Continue" when applicable.
- **The GO-button-gone dock looked broken** — the center gap stayed reserved at full width with
  nothing raised above it during a live session, reading as an empty notch. Animated it closed
  instead (respecting Reduced Motion).
- **"Core should be an option" in Quick Workout** — added a "Target Area" chip row (Core, Legs, Push,
  Pull, Cardio) on top of the existing training-goal purposes, using `generateQuickWorkout`'s
  existing (previously route-param-only, never user-facing) `targetPattern` override.
- **Exercise search couldn't find "hip adductor" for "inner thigh"** — added colloquial-name aliases
  to the existing `ALIASES` table (`inner thigh(s)` → `adductors`, `outer thigh(s)` → `abductors`).
- **"Autofill reps should be more accurate (e.g. ~20 for standing calf raises)"** — the exercise
  classifier already tags calf raises with a dedicated `'calf'` slot; added a further rep-range bump
  specifically for that slot on top of the existing isolation-role bump (10-16 → 15-24 for
  muscle_gain), threaded through `buildPrescription`'s three call sites.
- **Verified already correct, no change needed:** "suggest more to increase previous weight" (already
  autofills `topWeight + increment` when the top rep range clears at good RPE); "blank workouts
  shouldn't count toward streak/stats" (already blocked — `handleCompleteWorkout` refuses to finish
  with zero working sets logged, and streaks only read `status:'completed'`, which that guard makes
  unreachable at zero); "PREV should show the last time actually done, not a skipped session" (already
  true by construction — `set_logs` rows only exist for genuinely completed sets, so a skipped
  session has none and is naturally skipped over); "exercises tracked individually across different
  workouts" (already true — the PREV/prescription history query filters by `exercise_id` alone, never
  by workout template).

**Not fixed this session — needs either more scope or a product decision, flagged so it isn't lost:**

- **Drag-to-reorder exercises within a session.** The founder: "don't reorder people's workouts, make
  it easier to reorder, maybe if exercise is held down and dragged." Investigated first: nothing in
  the app currently auto-reorders exercises within an active session (the load path explicitly
  "restores the plan's original order"), so this is a pure feature request, not a bug — drag-to-
  reorder doesn't exist yet. Scoped out of this session because it needs real gesture-handling work
  (long-press-and-drag with autoscroll) that deserves its own dedicated pass with on-device testing,
  not a rushed addition at the end of a long session. **Next step:** a small `P1` batch — likely
  reordering `ExerciseFormSheet`/the runner's exercise list via `react-native-draggable-flatlist` or
  a Reanimated-based long-press handler, persisted through the existing `persistOrder()` function
  (already session-scoped by design, so no split-sync question here).
- **A first-workout rest-time preference prompt.** The founder: "in first workout, allow people to
  set their optimal rest time, recommended 2 min." Investigated: the capability already exists in
  full (the runner's rest-length `OptionSheet` already suggests "2 minutes" and lets the user pick
  60/90/120/180/custom, and every new exercise silently defaults to that same suggested value) — the
  gap is that it's never *proactively surfaced*, only reachable by tapping the timer-outline floating
  tool. Didn't build an automatic first-time prompt this session because the app already has a
  dedicated tutorial/spotlight system (`useTutorialStore`, `T.firstWorkout`) that owns first-workout
  UX moments, and bolting on a second, independent auto-opening modal risked colliding with it in ways
  that need an on-device check, not a guess. **Next step:** either add a step to the existing
  `T.firstWorkout` tour pointing at the rest-timer tool, or gate a one-time auto-open of the rest
  `OptionSheet` on `!firstWorkoutCompleted` inside `beginSession` — either is a small, contained batch,
  but should be built and reviewed on its own, with the founder confirming it doesn't fight the
  existing tutorial.
- **Whether swapping/removing an exercise should also update the underlying split template.** The
  founder: "if workout is updated, it should update... the auto split." Investigated: *adding* an
  exercise "permanently" already does correctly sync into the split (`addExerciseToSession`, when
  `workout.source === 'split'`) — but *swapping* an exercise (`replaceExercise`) and *removing* one
  (via `persistOrder`) are both explicitly, deliberately session-only by existing design (their own
  code comments say so: "Persist the swap into the plan so it sticks for this workout" / "Never
  touches the split template — that's a session-level tweak"). This looks like a real asymmetry, but
  changing it unilaterally risks reversing an intentional decision (should a same-day equipment-taken
  swap really rewrite every future week of your split? reasonable people could land either way) — this
  needs the founder's call, not a guess, exactly like Add already offers an explicit "just today, or
  permanently?" choice rather than assuming. **Next step:** ask the founder whether swap/remove should
  get the same explicit choice Add already has, then extend `replaceExercise`/`persistOrder` to match.
- **A checkmark + swipe animation when an exercise completes**, instead of the current instant
  transition. The root *bug* behind "abrupt switching" is fixed (the auto-close-during-rest fix
  above) — what's left is pure animation polish, not a defect. Deferred as a P1 nice-to-have; would
  need a Reanimated-based transition on the exercise-name/ring swap in `FocusMode.tsx`.

---

## How this document relates to the others

- **`EXECUTION.md`/`EXECUTION_STATUS.md`** sequence *product-market-fit strategy* (what to build to
  prove retention). This document sequences *correctness and craft* found by a full-codebase review —
  orthogonal but complementary. Do the P0 items here regardless of where the EXECUTION.md milestone
  ledger currently points, since they're bugs, not strategy bets.
- **`PRODUCT_AUDIT.html`** is the scored diagnosis (updated alongside this document — see its Update
  Log entry dated the same day this file was created for the reasoning behind the re-scored rows).
- When a batch here is completed and verified, update this file's own status inline (add a ✅ or a
  short note after the batch heading) so re-runs of this plan don't redo finished work — this file
  should stay accurate the same way `EXECUTION_STATUS.md` does.
