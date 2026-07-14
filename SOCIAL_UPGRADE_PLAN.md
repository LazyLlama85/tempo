# Social Upgrade — Accountability, Consistency, Competition, Coordination

Design for extending Tempo's existing social system. **Additive only — nothing that
works today is removed.** Follows the CLAUDE.md Working Method (understand → architecture
→ edge cases → self-critique → recommendation), then a staged roadmap.

---

## Phase 1 — Understand

**Goal:** make Tempo the easiest app for busy friends to *stay consistent, compete, and
coordinate workouts around real life*. NOT a fitness social network — no posting, likes,
comments, followers. Competition is **consistency-first**: a beginner who completes every
session must be able to out-rank an advanced lifter who skips. No strength/bodyweight/
genetics ever feeds a rank.

**What already exists (reuse, don't rebuild):**
| Requested | Status today | Source |
|---|---|---|
| Friend search / request / accept / decline / remove | ✅ Done | `friendships` table, `lib/social.ts`, `social.tsx` |
| View friend profile / achievements / streak / activity | ✅ Done | `friend_overview` RPC, `friend-profile.tsx` |
| Weekly leaderboard | ⚠️ Basic (raw completed count) | `friends_leaderboard()` |
| Activity feed | ⚠️ Completions only | `friend_feed()` |
| Streaks | ✅ Engine done | `lib/streak.ts` (consecutive completed *sessions*) |
| Badges | ⚠️ Derived stat badges (strength-flavored) | `lib/achievements.ts` |
| Availability / smart scheduling / reschedule | ✅ Engine done (solo) | availability cols, `autoSchedule.ts`, `reschedule.ts` |

**Net-new:** Streak leaderboard · Tempo Score + leaderboard · Private groups · richer
activity feed events · shared-availability detection · workout-together suggestions ·
workout invites · social smart-reschedule · consistency badges.

---

## Phase 2 — Architecture Review

**Reuse map (extend before create):**
- Leaderboards ride the existing `friends_leaderboard` members CTE (friends + self, privacy-gated). We upgrade its SELECT, not its shape philosophy.
- Streak everywhere = `lib/streak.ts` semantics (consecutive completed sessions). A SQL mirror `current_session_streak(uid)` powers server-side ranks so client + server never disagree.
- Tempo Score inputs already exist: `scheduled_workouts` (scheduled/completed/missed), `days_per_week` goal, streak. **The score formula lives in JS (`lib/tempoScore.ts`)** so it's tunable via OTA without a migration; the RPC returns raw *components* only.
- Social scheduling reuses the solo availability model: `wake_time`/`bedtime`, `work_*`, `school_*`, `training_days`, `unavailable_blocks`, plus already-scheduled `scheduled_workouts` → a user's free windows. Overlap = intersect two friends' windows.
- Invites, once accepted, call the **existing** scheduling path (`scheduled_workouts` insert, calendar auto-sync) — no parallel scheduler.
- Reschedule reuses `lib/reschedule.ts`.

**New tables (all additive, RLS owner/member-scoped):**
- `groups` (id, name, owner_id, created_at) + `group_members` (group_id, user_id, role, joined_at). Group leaderboards = the leaderboard RPCs with an optional `group_id` filter.
- `workout_invites` (id, from_user, to_user, focus, proposed_date, proposed_start, duration_min, status pending/accepted/declined/countered, counter_date/start, created_at). Accept → schedule for both.
- `activity_events` (id, user_id, kind, payload jsonb, created_at) — for feed events that aren't derivable from a completed session (streak milestone, perfect week, badge earned). Completions stay derived (existing `friend_feed`); we UNION derived completions with stored events. Written best-effort from the client on the triggering moment (streak crossing, week close, badge unlock), never blocking.
- `user_badges` (user_id, badge_key, earned_at) — only for *competitive* badges that can't be re-derived from stats (Weekly Winner, Top-3 Monthly). Stat badges (streak, perfect week) stay derived.

**Cross-cutting:**
- *Navigation:* `social.tsx` grows tabbed sections (Friends · Leaderboards · Feed · Groups); friend-profile gains badges + a "Schedule together" CTA. Groups get a `group-detail` modal screen. All new screens are `presentation:'modal'` (RN `<Modal>` sheets already work post-fix).
- *State/offline:* leaderboards/score via React Query (cached, `friends_*` roots already persisted pattern). Offline shows last-cached rank. Invites/group writes are online-only with optimistic UI + rollback (mirrors existing friend-request pattern).
- *Notifications:* extend the existing server `retention-push` rules with social nudges ("you're 1 workout from passing Alex", "workout with Josh tomorrow") — new rule keys, same infra, respect existing per-rule opt-outs.
- *Privacy:* every leaderboard/feed row already gated by `privacy_stats`/`privacy_activity`. Availability sharing needs a NEW knob `privacy_availability` (default `friends`) — a friend never sees *what* you're doing, only coarse free/busy windows, and only if enabled.
- *Migration/upgrade:* older clients keep working — new RPCs are new functions; new columns/tables default-empty. `friends_leaderboard` gets a **v2 companion** rather than a breaking signature change.

---

## Phase 3 — Edge Cases

- **Guest/anonymous users:** no friends/social — hide social scheduling & groups behind a "save your account" prompt (reuse `SaveProgressSheet`). Guests can still see solo leaderboard = just themselves.
- **Week boundary:** all "this week" = `date_trunc('week')` (Monday), one definition, server-side, TZ-aware caveat below.
- **Timezones:** friends in different TZs — leaderboard weeks use the server's week; document that "week" is UTC-Monday for fairness (everyone same clock). Streaks are date-based already.
- **No scheduled workouts this week** → completion % is undefined; show "—"/"0 planned", rank such users last on %, not as 100%.
- **Empty/1-person groups & leaderboards:** show friendly empty states; a group of one still renders (you, 100%).
- **Friend removes you / privacy flips to private mid-week:** they drop off your boards on next fetch; no crash.
- **Availability with no calendar + no prefs:** fall back to `training_days` + sleep window; if nothing, show "add your availability to find shared times" (link to `availability.tsx`).
- **Two people accept overlapping invites / double-schedule:** invite accept is idempotent (unique on invite id + status guard); scheduling checks for an existing session that slot.
- **Invite to someone who unfriends before accept:** RLS + a friendship check at accept time → invite auto-voids.
- **Stale cached leaderboard after workout:** invalidate `friends_*` queries on session-complete (already a hook point in `plan.tsx`/`workout-complete.tsx`).
- **Score gaming:** scheduling 20 easy workouts to inflate frequency — cap frequency component at the user's `days_per_week` goal, so over-scheduling can't beat honest goal-hitting.
- **Denied calendar permission:** social scheduling degrades to prefs-only overlap; never blocks.

---

## Phase 4 — Potential Problems With My Design (skeptical pass) → revisions

1. **"Tempo Score is opaque/arbitrary."** Risk: users distrust a black-box number. → *Revision:* score is 0–1000, computed from 5 named, visible sub-bars (Completion, Goal adherence, Consistency, Streak, Frequency); tapping the score shows the breakdown. Formula in JS + unit-tested against the core promise (consistent-beginner > flaky-advanced).
2. **Availability sharing = privacy landmine.** Exposing free/busy is sensitive. → *Revision:* opt-in `privacy_availability` (default friends but with a first-run explainer), coarse hour-blocks only, never event titles, revocable, and only computed on-demand between two mutual friends.
3. **Server-side streak vs client-side drift.** Two implementations = bugs. → *Revision:* one SQL function mirrors `streak.ts` with a shared test vector; friend-profile keeps client calc, leaderboard uses SQL, both asserted equal in a test.
4. **Feed events table invites spam/write-amplification.** → *Revision:* only 3 event kinds, deduped (one streak-milestone per threshold, one perfect-week per week), best-effort client writes, 14-day feed window, no fan-out table (read-time join like today).
5. **Scope explosion / can't ship.** 11 features at once = nothing lands well. → *Revision:* the staged roadmap below; each stage is independently shippable and testable via OTA. Leaderboards first (highest motivation-per-effort, pure reuse), social scheduling last (highest complexity/novelty).
6. **Notification fatigue.** Social nudges could annoy. → *Revision:* reuse existing per-rule opt-outs, cap social nudges to ≤1/day, only high-signal moments (partner workout tomorrow, about-to-be-passed, weekly winner).
7. **Group leaderboard N+1 / heavy RPCs.** → *Revision:* one RPC per board with a `group_id` param, set-based SQL (no per-member round trips), `limit 100`, indexed on `group_members(group_id)` and `scheduled_workouts(user_id, planned_date, status)`.

---

## Phase 5 — Final Recommendation: staged roadmap

Each stage: SQL migration (additive/idempotent) + JS (OTA) + a device-testable outcome.

- **Stage 1 — Tempo Score engine + leaderboard trio (flagship).** `lib/tempoScore.ts` (+tests), `friends_leaderboard_v2()` (adds scheduled/completed/% /active-days/streak + score components), `current_session_streak()` SQL, streak & score leaderboards, 3-tab Leaderboard UI in `social.tsx`. *Reuses everything; highest value; lowest risk.*
- **Stage 2 — Badges (consistency-flavored) + richer activity feed.** New badge set (Weekly Winner, 30-Day Streak, Consistency Champion, Perfect Week, Top-3 Monthly, Workout Partner), `user_badges` for competitive ones, `activity_events` for streak/perfect-week/badge feed items, badges on profiles.
- **Stage 3 — Private groups.** `groups`/`group_members`, create/join (invite via friend-code/link), group leaderboards (reuse Stage 1 RPCs with `group_id`), `group-detail` screen.
- **Stage 4 — Social scheduling (the differentiator).** `privacy_availability`, `freeWindows(user)` + overlap engine, "Workout together" suggestions (goal/split/focus compatibility), `workout_invites` + accept→schedule-both, social smart-reschedule, accountability nudges via `retention-push`.

Recommend building in this order; ship & verify each stage on-device before the next.

---

## Tempo Score v1 (proposed — confirm weights before build)

`score = 1000 × Σ(weight × component)`, every component ∈ [0,1], **zero strength inputs**:

| Component | Weight | Definition (rolling 28 days) |
|---|---|---|
| **Completion** | 0.35 | completed ÷ scheduled sessions |
| **Goal adherence** | 0.25 | min(1, avg weekly completed ÷ `days_per_week` goal) |
| **Consistency** | 0.15 | share of last 4 weeks that met ≥60% of goal |
| **Streak** | 0.15 | min(1, current session streak ÷ 21) |
| **Frequency** | 0.10 | min(1, avg weekly completed ÷ `days_per_week` goal) — capped so over-scheduling can't win |

**Why this honors the mission:** a beginner on a 3-day goal who completes 3/3 every week
scores ~1000 (completion 1.0, goal 1.0, consistency 1.0, frequency 1.0, streak climbing).
An advanced lifter on a 5-day goal completing 2/5 with misses scores far lower — exactly
the intended inversion. Weights are a single documented constant in `lib/tempoScore.ts`.
