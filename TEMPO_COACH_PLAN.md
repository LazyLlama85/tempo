# Tempo Coach — Implementation Plan

> # ▶ UNPARKED (founder, 2026-07-23) — building resumed
> **C1 + C2 + C3 are built. Next batch: C4 (the action layer).**
>
> **Blocking on the founder, not on code:**
> 1. **Deploy the function** — `cd mobile && npx supabase functions deploy tempo-coach`.
>    It has never been deployed; it does not exist in the Supabase project.
> 2. **Set the key** — `npx supabase secrets set ANTHROPIC_API_KEY=sk-ant-...` (billing enabled).
>    Without it the function returns 503 and the screen shows "Coach isn't available right now".
>
> Until both are done the Coach screen opens and behaves correctly but can't answer anything.
>
> **Still-open decisions** (neither blocks C4): (a) provider — Claude vs a cheaper model for
> free-tier turns, where the deciding axis is strict-schema tool-call reliability, not price;
> (b) the server-can't-see-RevenueCat-subscriptions gap in §7, which must be resolved before
> `pro_enabled` is flipped globally.
>
> ---
>
> **Status:** design doc, written 2026-07-22. C1 + C2 built 2026-07-22; **C3 + C4 built 2026-07-23**;
> C5 (metering UI, entry points, `PAYWALL_POINTS`) not started.
>
> **Deviation from §10, recorded:** C3 and C4 landed in the same session, which the build order
> explicitly warns against. The mitigation is that C4 was built against a **dev stub**
> (`lib/coachStub.ts`, `EXPO_PUBLIC_COACH_STUB=1`) rather than live model output, so the action
> layer has deterministic inputs and its own isolated diff — which is arguably a *better* test bed
> than a nondeterministic model. What is NOT mitigated: neither batch has been run on a device.
> **Audience:** the implementing session (Claude Sonnet). This document is the spec — follow the
> build order in §10, one batch per session, per `CLAUDE.md`'s Execution Protocol.
> **Companions:** `MONETIZATION_PLAN.md` (why Coach is the Pro tentpole), `proFeatures.ts`
> (the `tempo_coach` gate id, already registered), `ARCHITECTURE.md` (update it every batch).

---

## 0. TL;DR

Tempo Coach is a chat surface where the user talks to their own training data and Tempo
**proposes concrete changes it can apply with one tap**. It is the reason to buy Pro.

- **Yes, you need an AI API.** Anthropic API key, stored as a **Supabase secret**, called only
  from a new Edge Function. It must never be an `EXPO_PUBLIC_*` var. (§2)
- **The Coach never writes to the database on its own.** It returns *text + an optional proposed
  action*; the app renders a confirm card; the existing client lib functions do the actual write
  when the user taps Apply. This is the single most important design decision here. (§3)
- **Free users get 3 coach messages a week.** Running out is the paywall moment. (§7)
- One API round-trip per user message. No server-side agent loop, no duplicated business logic.

---

## 1. Phase 1 — Understand

**The feature.** A `/coach` screen: a message thread. The user types something in plain language
("my shoulder's tweaked", "I'm slammed Tue–Thu", "am I actually getting stronger?"). Tempo answers
using that user's real data, and when the right response is a *change* rather than a sentence, it
proposes the change as a tappable card.

**Why it's different from every AI fitness chatbot.** Because Tempo already has the actions
implemented as library functions. ChatGPT can tell you to move your Tuesday workout. Tempo can
move it. The tools in §4 are all thin wrappers over code that already exists and is already tested.

**How it interacts with existing systems.**

| System | Interaction |
|---|---|
| `stores/auth` | Supplies the JWT; the Edge Function verifies it (`verify_jwt = true` — unlike `retention-push`). |
| `stores/entitlements` | `useProGate()` supplies `locked`. Metering (§7) is the gate, not a hard block. |
| `lib/fitnessInsights`, `lib/tempoScore`, `lib/streak`, `lib/trainingLoad`, `lib/recovery` | Pure derivations that build the context pack. Nothing new to compute. |
| `lib/weekReschedule`, `lib/substitutions`, `lib/travelMode`, `lib/moveWorkout`, `lib/quickWorkout` | The action executors. Called **client-side**, after confirmation. |
| `lib/analytics` | New typed events (§8). |
| `lib/crashReporting` | Edge Function failures funnel through the existing React Query → Sentry path. |
| Supabase | One new table (`coach_messages`), one new Edge Function (`tempo-coach`). |

**Assumptions to verify while building.**
1. Supabase Edge Functions (Deno) accept `npm:` specifiers. If `npm:@anthropic-ai/sdk` fails to
   resolve at deploy time, fall back to `https://esm.sh/@anthropic-ai/sdk` — the existing functions
   already use esm.sh for `@supabase/supabase-js`.
2. The founder has an Anthropic API key with billing enabled. Nothing works without it.
3. The context pack fits comfortably in budget (§9 says ~2k tokens; measure it, don't assume).

---

## 2. The AI API — what you actually need

**Provider:** Anthropic. **Model:** `claude-sonnet-5` (was `claude-opus-4-8`; changed 2026-07-23 — see §9).

### Setup (founder-side, do this before writing code)

```bash
# 1. Get a key at console.anthropic.com, add billing.
# 2. Store it as a Supabase secret — NOT in .env.local, NOT as EXPO_PUBLIC_*.
cd mobile
npx supabase secrets set ANTHROPIC_API_KEY=sk-ant-...
```

### Non-negotiable security rules

- **The key lives only in Supabase secrets.** Any `EXPO_PUBLIC_ANTHROPIC_KEY` is inlined into the
  app bundle at build time and is trivially extractable from a shipped IPA/APK. Anyone who pulls it
  can spend the founder's money without limit. If you find yourself typing `EXPO_PUBLIC` next to an
  API key, stop.
- **`verify_jwt = true`** on this function (the opposite of `retention-push`, which is cron-invoked).
  An unauthenticated LLM endpoint is a free API for the whole internet.
- **Rate limit server-side** (§7). A client-side check is UX; the server check is the wallet.

### Model configuration

```ts
const MODEL = 'claude-sonnet-5'   // $3 / $15 per million tokens (input / output), 1M context
```

API details that matter and are easy to get wrong on this model:

- **`temperature`, `top_p`, `top_k` are rejected with a 400.** Do not send them. Steer tone with
  the system prompt.
- **Thinking is off unless you ask for it.** Omitting the `thinking` field runs *without* thinking.
  Set `thinking: { type: 'adaptive' }` explicitly — the Coach has to reason about a real schedule
  before proposing a change.
- **`budget_tokens` is removed** (400). Depth is controlled by `output_config.effort`.
- **`effort`** goes inside `output_config`, not top-level. Default is `high`; for a latency-sensitive
  chat start at `'medium'` and tune. Lower effort = faster replies, fewer tokens.
- **`max_tokens: 1500`** is plenty for a chat turn and stays well under the SDK's HTTP timeout, so
  v1 can be non-streaming. (Streaming is a v2 polish item — see §11.)
- **Strict tools:** put `strict: true` at the top level of each tool definition (a sibling of
  `name`/`description`/`input_schema`), and give every schema `additionalProperties: false` plus a
  `required` array. This guarantees the action args parse cleanly.
- **Prompt caching won't help at first.** Opus 4.8's minimum cacheable prefix is 4096 tokens; the
  system prompt + tool definitions will be smaller than that, so a `cache_control` marker would be
  a no-op. Revisit if the system prompt grows past ~4k.

---

## 3. Phase 2 — Architecture

### The core decision: propose on the server, apply on the client

```
┌────────────────────────── app (React Native) ──────────────────────────┐
│                                                                        │
│  coach.tsx                                                             │
│    ├── buildCoachContext()   ← pure, reuses fitnessInsights/tempoScore/ │
│    │                            plan rows/calendar conflicts           │
│    ├── POST ──────────────────────────────┐                            │
│    │                                      │                            │
│    └── renders: text  +  ConfirmCard ─────│──── on tap: executeAction()│
│                                           │       └── weekReschedule / │
│                                           │           substitutions /  │
│                                           │           travelMode / ... │
└───────────────────────────────────────────│────────────────────────────┘
                                            ▼
                        ┌─── Edge Function: tempo-coach ───┐
                        │  1. verify JWT                   │
                        │  2. check quota (coach_messages) │
                        │  3. call Claude (tools = intent  │
                        │     declarations, NOT executed)  │
                        │  4. return { text, action|null } │
                        └──────────────────────────────────┘
```

**Why this shape and not a server-side agent loop:**

1. **No duplicated business logic.** `planWeekReschedule`, `getAlternatives`, `saveTravelMode` etc.
   live in `mobile/src/lib` with `@/` path aliases and app types. Porting them into Deno would mean
   two copies of the scheduling engine drifting apart — exactly the regression class `CLAUDE.md`
   warns about.
2. **Safe by construction.** The model cannot silently rewrite someone's training week. Every write
   still goes through the same code path a button press uses today, with the user's own session.
3. **One API call per message.** A server-side tool loop is 2–4 calls per turn. This is 1.
4. **Better UX anyway.** "Here's what I'd change — Apply?" beats a schedule that mutated while you
   were reading.

**Tool-use is used for intent selection, not execution.** The Edge Function declares the tools,
Claude picks one and fills in typed arguments, and the function reads the `tool_use` block and
returns it as `action` **without** sending a `tool_result` back. `stop_reason` will be `tool_use`;
that's the terminal state for us.

**Getting text *and* an action in one call.** When Claude emits a `tool_use` block it often emits a
`text` block alongside it. Force this in the system prompt: *"Before proposing a change, always
write one or two sentences explaining what you're about to change and why."* Then:

```ts
const text = resp.content.filter(b => b.type === 'text').map(b => b.text).join('\n').trim()
const toolUse = resp.content.find(b => b.type === 'tool_use') ?? null
```

If `text` comes back empty and `toolUse` is present, the **client** renders a locally-generated
fallback sentence from the action args (e.g. `Move ${name} to ${day}?`). Never ship an empty bubble.

### Impact on the rest of the app

| Area | Impact |
|---|---|
| Navigation | One new route `app/coach.tsx`, pushed modally. Entry points in §6. |
| State | React Query for the send mutation; local `useState` for the thread. **No new global store** — a coach thread is screen-local. Persist to `coach_messages` for history. |
| Database | One table. See §5. |
| Analytics | Four new events (§8). |
| Offline | Send is disabled with an inline "Coach needs a connection" note. History reads from cache. |
| Migration | Purely additive. No existing table or screen changes shape. |

---

## 4. The tool surface (v1 — five tools)

Each tool maps to an executor that **already exists**. Do not invent new capabilities in this batch.

| Tool | Args | Client executor | Notes |
|---|---|---|---|
| `reschedule_week` | `{ reason: string, busy_days?: string[] }` | `lib/weekReschedule.planWeekReschedule` → existing apply path in `(tabs)/plan.tsx` | Already Pro-gated as `schedule_optimization`. |
| `move_workout` | `{ workout_id: string, to_date: string, to_time?: string }` | `lib/moveWorkout` + `resyncMovedWorkout` | `to_date` is `YYYY-MM-DD`. |
| `swap_exercise` | `{ exercise_id: string, reason: string }` | `lib/substitutions.getAlternatives` → `saveSubstitution` | Reason drives the alternative filter (pain vs equipment vs preference). |
| `start_travel_mode` | `{ until: string, equipment: string[] }` | `lib/travelMode.saveTravelMode` | `equipment` values must match the `Equipment` union in `src/types`. |
| `explain` | `{ topic: 'plan' \| 'progress' \| 'deload' \| 'session' }` | none — read-only | Lets the model signal "this is an explanation" so the UI can attach a "See in Progress" deep link. |

**Schema rules for every tool:** `strict: true`, `additionalProperties: false`, explicit `required`.
Give every property a `description` — the model's argument quality depends on it more than on the
system prompt. Be **prescriptive about when to call**, not just what the tool does; Opus 4.8 reaches
for tools conservatively by default, so each `description` should state its trigger condition
("Call this when the user says a body part hurts or an exercise is unavailable").

**Define the tool list as a frozen, deterministically-ordered constant.** Tools render at position 0
of the prompt; reordering them per request would invalidate any future prompt caching.

---

## 5. Data model

New migration: `mobile/supabase/add_tempo_coach.sql`.

```sql
-- Tempo Coach — conversation history + the metering surface.
create table if not exists coach_messages (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  role        text not null check (role in ('user','assistant')),
  content     text not null,
  action      jsonb,              -- the proposed tool_use, if any
  action_state text check (action_state in ('proposed','applied','dismissed')),
  created_at  timestamptz not null default now()
);

create index if not exists coach_messages_user_created_idx
  on coach_messages (user_id, created_at desc);

alter table coach_messages enable row level security;

create policy "own coach messages" on coach_messages
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
```

Notes for the implementer:
- `action_state` is what makes the Coach measurable: **apply-rate is the metric this feature moves.**
  A coach whose proposals are never applied is a chatbot, and we should find that out from data.
- The weekly quota is a `count(*)` over `role = 'user'` since the start of the user's week. No
  separate counter table — one source of truth, and it survives reinstalls (unlike a device flag).
- Follow the existing convention: `.sql` in `mobile/supabase/` is the source of truth, then apply it
  (Supabase SQL editor or the MCP `apply_migration`). Record it as applied in `ARCHITECTURE.md`.

---

## 6. Client work

### `src/lib/coach.ts` (new)

```ts
export interface CoachContext { /* the compact data pack — see below */ }
export interface CoachAction  { name: string; input: Record<string, unknown> }
export interface CoachReply   { text: string; action: CoachAction | null; remaining: number | null }

export function buildCoachContext(...): CoachContext   // pure; composes existing derivations
export async function sendCoachMessage(client, ctx, history, text): Promise<CoachReply>
export async function fetchCoachHistory(client, userId, limit): Promise<CoachMessage[]>
export function describeAction(action: CoachAction): string   // the empty-text fallback sentence
```

**`buildCoachContext` must stay pure and cheap.** It composes what `useProgressStats` and the Plan
tab already fetch:

- profile: goal, experience, days/week, equipment, injuries, units
- this week + next week of `scheduled_workouts` (id, date, time, focus, status)
- `adaptation_mode` and current `week_index` from the active `UserPlan`
- last 4 weeks: completed count, volume trend, `tempoScore` components, current streak
- recent PRs (top 3), latest bodyweight + `computeWeightTrend`
- any active `travel_mode`, any detected calendar conflicts
- last 3 session feedback ratings

Serialize compactly (short keys, no prose, no nulls) and **sort object keys deterministically** —
non-deterministic JSON ordering is the classic silent prompt-cache invalidator.

### `src/app/coach.tsx` (new)

Follow the conventions in `quick-workout.tsx` exactly: `useTheme()` / `useThemedStyles(makeStyles)`,
`Spacing`/`Radius`/`CardShadow` from `@/constants/theme`, `ScreenHeader` + `DismissButton` from
`@/components/brand`, `PressableScale` from `@/components/motion`, `track()` on every meaningful tap.

- Message list (`FlatList`, inverted), user bubbles right / coach bubbles left.
- Composer pinned above the keyboard (`KeyboardAvoidingView`), send disabled while pending.
- Typing indicator: reuse `PulseLoader` or `TempoLottie`.
- **`ConfirmCard`** below a coach bubble carrying an action: icon + one-line summary + `Apply` /
  `Not now`. On Apply → run the executor → optimistic UI → `queryInvalidation` → set `action_state`.
  On failure use `describeSaveError` (existing) — never a raw error string.
- Empty state: 3–4 tappable starter prompts ("I'm busy Tuesday and Wednesday", "My shoulder hurts",
  "Am I actually progressing?"). Starters materially lift first-use rate.
- **Sheets:** if any sub-sheet is needed, use `TempoSheet` (RN `Modal`). Do **not** reach for
  `@gorhom/bottom-sheet` — it silently renders nothing on this RN 0.85 / React 19 / new-arch stack.

### Entry points

1. **Home** — a "Ask your coach" row under the day card.
2. **Plan tab** — on a conflict/missed-session card, "Ask Tempo to fix it" pre-fills the composer.
3. **Progress** — under an insight, "Why?" opens Coach with `explain` context.

Entry points are what make it a product instead of a buried tab. Ship at least #1 and #2.

---

## 7. Gating & metering (the conversion mechanism)

```
free  → 3 coach messages per MONTH  (server-enforced)   ← founder call, 2026-07-23
Pro   → unlimited, soft cap 200/month to bound cost
```

**This is deliberate, and it is the most important product decision in the feature.** The tentpole
has to be *tasted*. A user who has never seen the Coach fix their week has no reason to buy it.
Running out mid-conversation, right after it just did something useful, is the highest-intent
paywall moment the app has — and unlike the current invisible scheduler gate, the user knows exactly
what they are buying.

**The 3/month cap, and what it costs (recorded so the tradeoff is not forgotten).** The original
design was 3/**week**. The founder moved it to 3/month so free users "can't do much". That is a
legitimate call and it is what's built — but be honest about the mechanism it weakens: at 3/week a
free user hits the wall repeatedly, each time in a moment where the Coach has just proven useful,
which is what makes the wall a *purchase moment*. At 3/month they hit it once and then face four
weeks of a dead surface, which is what makes a wall a *reason to stop opening the app*. **The number
to watch is the conversion rate on `paywall_shown` with `context: 'tempo_coach'`.** If that's flat
while Coach opens keep happening, the cap is too tight and 3/week (or 5/month) is the fix — not more
tools. Cost is not the reason to keep it tight: at 3/month a free user costs roughly $0.08/month on
`claude-sonnet-5`, so the cap is a product lever, not a budget one.

Implementation:
- Enforce in the Edge Function: count `role='user'` rows since the start of the user's calendar
  month; if `>= 3` and not Pro, return `402` with `{ error: 'quota', remaining: 0 }`. Both tiers now
  share the same month window, so there is one boundary function instead of two.
- Client shows remaining count in the header ("2 left this month") when `locked` is true.
- On `402` → `track('paywall_shown', { context: 'tempo_coach' })` → route to `/paywall`.
- Pro status: the Edge Function must check entitlement itself. Read `app_config.pro_enabled` +
  the user's row the same way `lib/proConfig.fetchProState` does — **do not trust a client-sent
  `isPro` flag**.
- While Pro is dormant (`proEnabled === false`), `locked` is false and everyone is unlimited. That
  is correct and matches every other gate in the app.
- Add `tempo_coach` to `PAYWALL_POINTS` in `proFeatures.ts` **only once the screen ships** — App
  Store review rejects paywalls advertising features that don't exist.

---

## 8. Analytics

Add to `EventProperties` in `lib/analytics.ts` (typed map — every call site is compile-checked):

```ts
coach_opened:         { entry: 'home' | 'plan' | 'progress' | 'tab' }
coach_message_sent:   { has_action: boolean; locked: boolean }
coach_action_proposed:{ tool: string }
coach_action_applied: { tool: string; outcome: 'applied' | 'dismissed' | 'failed' }
```

`coach_action_applied` with `outcome: 'applied'` is **the** metric. If proposals are made and never
applied, the Coach is decoration and we should say so in `PRODUCT_AUDIT.html` rather than celebrate
shipping it.

---

## 9. Cost model

Rough per-message estimate — the table below is at `claude-opus-4-8` rates ($5 / $25 per MTok), the
original design. **The shipped model is `claude-sonnet-5` ($3 / $15), so halve the cost column: about
$0.026 per message, or ~$0.017 while intro pricing runs through 2026-08-31.**

| Component | Tokens | Cost |
|---|---|---|
| System prompt + tool definitions | ~1,500 in | $0.008 |
| Context pack | ~2,000 in | $0.010 |
| Conversation history (capped at last 10 turns) | ~1,000 in | $0.005 |
| Reply + adaptive thinking | ~800 out | $0.020 |
| **Total** | | **≈ $0.04 / message** |

- A Pro user at ~20 messages/month ≈ **$0.80/month** — comfortably inside any sane subscription price.
- A free user at the **3/month** cap ≈ **$0.13/month**. 10,000 monthly-active free users exercising
  the full cap is roughly **$1.3k/month**. (At the original 3/week cap this line was ~$0.55/user and
  ~$5.5k/month — the cap change did most of the cost work on its own.)

**Model choice (2026-07-23) — DECIDED, and shipped in the function.** `claude-sonnet-5` over `claude-opus-4-8`:
~$0.026/message vs ~$0.043 (intro pricing $2/$10 per MTok through 2026-08-31 makes it ~$0.017), it
takes the **identical request body** (adaptive thinking, `output_config.effort`, `strict` tools), and
it is near-Opus on exactly the axis that matters here — picking the right tool and only using ids
that exist in the context. `claude-haiku-4-5` is ~5× cheaper again but **does not support adaptive
thinking or `effort`** (both 400), so it would need a branched request shape, and it is the most
likely of the three to fumble a five-tool choice.

**Non-Anthropic providers (Grok 4.1 Fast, Gemini Flash, GPT-5-mini)** are ~10–20× cheaper per token
again, and the 3/month cap has made that saving nearly irrelevant — a few hundred dollars a month at
a scale Tempo does not have. What it would cost: a second SDK in Deno, a different tool-calling
dialect, divergent refusal/stop-reason handling, and an unproven answer on strict-schema tool
reliability. A Coach that proposes moving a workout that doesn't exist is worse than no Coach.
**Decision: stay on Anthropic.** Revisit only if the `usage` log line shows real spend at real scale.

**Levers if cost ever bites, in order:** (1) trim the context pack — it's the biggest input line and
the easiest to shrink; (2) drop `effort` to `'low'` for free-tier turns; (3) route free-tier traffic
to a cheaper model. Lever 3 is a **product decision, not an optimization** — a visibly worse free
Coach undermines the taste-the-tentpole strategy. Ask the founder before pulling it.

**Verify before launch:** run `client.messages.countTokens()` against a real context pack rather than
trusting the table above. Add a `usage` log line in the Edge Function (`input_tokens`,
`output_tokens`) from day one so the real number is knowable.

---

## 10. Build order

One batch per session. Verify (`npx tsc --noEmit` in `mobile/`, tests, `/verify`) and commit at the
end of each. Update `ARCHITECTURE.md` and `EXECUTION_STATUS.md` every time.

**Batch C1 — Backend spine.**
`mobile/supabase/add_tempo_coach.sql` (write + apply) and
`mobile/supabase/functions/tempo-coach/index.ts` + `README.md`, modelled on `retention-push`'s
structure and comment style. Verify with `curl` against the deployed function using a real user JWT
before writing any UI. Deploy: `npx supabase functions deploy tempo-coach` (JWT verification **on**).

**Batch C2 — Client library.**
`src/lib/coach.ts` — `buildCoachContext`, `sendCoachMessage`, `fetchCoachHistory`, `describeAction`.
Unit tests for `buildCoachContext` (shape + determinism) and `describeAction` (every tool) in
`src/lib/__tests__/coach.test.ts`, following the existing test conventions.

**Batch C3 — The screen.**
`src/app/coach.tsx`: thread, composer, typing state, history load. No actions yet — text only.
Ship it behind a tester flag and use it yourself for a day before building C4.

**Batch C4 — Actions.**
`ConfirmCard`, the executor switch, optimistic apply, `queryInvalidation`, `action_state` writes,
`describeSaveError` on failure. This is the batch that makes it a product.

**Batch C5 — Metering, gating, entry points.**
Server quota + `402` handling, remaining-count UI, paywall routing, the three entry points,
`tempo_coach` added to `PAYWALL_POINTS`, analytics events, `PRODUCT_AUDIT.html` update.

Do **not** collapse C3 and C4 into one session. The action layer is where regressions to the
scheduling engine would come from, and it deserves its own "nothing else changed" diff review.

---

## 11. Phase 3 — Edge cases

| Case | Required behavior |
|---|---|
| Offline | Send disabled with an inline note. History renders from cache. Never a spinner that hangs. |
| Request fails / times out | Bubble stays with a Retry affordance. Do **not** consume quota — increment the counter only on a successful reply. |
| Force close mid-send | The user message was already persisted; the reply wasn't. On reopen show the orphan user message with Retry. |
| User leaves and returns | History loads from `coach_messages` (cap at last 20 for the prompt; render more). |
| Action proposed, then applied elsewhere | Re-validate on Apply: re-read the target row; if it moved/completed, show "that already changed" and refresh — never blind-write. |
| Action proposed on a stale plan | Same guard. The `workout_id` must still exist and be `scheduled`. |
| Two Applies at once | Disable the button on first press; `action_state` transition is idempotent. |
| Quota exhausted mid-thread | `402` → inline "You've used your free coach messages for this month" + Upgrade. History stays readable. |
| Pro flipped off mid-session | The next send re-checks server-side. Client `locked` follows the store. |
| Model returns no tool and no text | Should be impossible; if it happens, show a generic "I didn't catch that — try rephrasing" and log to Sentry. |
| Model proposes an action for a nonexistent workout | Validate args client-side before rendering the card. Invalid → render text only, log to Sentry. |
| Model refuses (`stop_reason: 'refusal'`) | Check `stop_reason` **before** reading `content` — `content` can be empty. Show a neutral message. |
| Hits `max_tokens` | `stop_reason: 'max_tokens'` → show the partial text plus a "…" affordance. Don't render a truncated action. |
| Upgrading from an older app version | Purely additive; old builds simply lack the route. |
| Denied notification/calendar permission | Coach still works; it just can't propose calendar-dependent actions. Reflect that in the context pack. |

---

## 12. Phase 4 — Potential problems with this design

Arguing to reject it:

- **"It's a chatbot with extra steps."** Fair, *if* the actions don't land. The entire defensibility
  is the Apply button. If `coach_action_applied` stays near zero after launch, this feature failed
  regardless of how good the prose is — and the honest response is to say so in the audit, not to
  add more tools. **Mitigation:** ship the actions in C4, instrument apply-rate, and treat it as the
  go/no-go for pricing on the Coach story.
- **"Free users will burn the API budget."** Real risk, quantified in §9. **Mitigation:** the cap is
  server-enforced, the counter is unbypassable (DB-backed, not a device flag), and §9 has four
  levers in priority order. Add the `usage` log line in C1 so this is measured, not guessed.
- **"The propose/apply split means the Coach feels less magical than a real agent."** Partly true.
  But an agent that silently rewrites a training week is a support nightmare and a trust-destroyer
  the first time it gets one wrong, and the user has no undo. One tap is a small price for that.
  Revisit only after apply-rate proves people trust the proposals.
- **"Context pack drift."** `buildCoachContext` composes ~8 existing derivations. When any of them
  changes shape, the Coach silently degrades — it won't crash, it'll just give worse answers.
  **Mitigation:** the C2 unit test asserts the context shape, so a change to an upstream derivation
  breaks a test instead of quietly making the Coach dumber.
- **"Latency."** Adaptive thinking + a 2k-token context on Opus is not instant. **Mitigation:** start
  at `effort: 'medium'`, keep `max_tokens` at 1500, show a real typing indicator, and treat streaming
  as the first v2 item if it feels slow on device.
- **"Another surface to maintain before M4 (retention proof)."** The `CLAUDE.md` execution protocol
  says depth, not breadth, before M4. The counter-argument: this is not a new surface competing with
  the wedge — it is the thing that makes the Pro tier purchasable at all, which is milestone M2. If
  the founder disagrees, the ordering to change is C5's entry points, not the whole feature.
- **"App Store review."** An AI feature in a fitness app needs an accurate privacy disclosure (data
  is sent to a third-party processor) and must not give medical advice. **Mitigation:** the system
  prompt must include an explicit refusal instruction for medical/injury-diagnosis questions ("I'm
  not able to diagnose an injury — here's how I'd adjust training around it, and see a professional
  if it persists"), and the legal screen needs a line about third-party AI processing.

---

## 13. Phase 5 — Final recommendation

Build it in the C1–C5 order above. Ship C1–C3 to yourself first and actually use it for a day before
building the action layer — if the text-only version isn't useful, the action layer won't save it,
and that's a cheap thing to learn early.

Two things this plan deliberately does **not** do, and should not be talked into doing:
1. Execute writes on the server. Keep the confirm tap.
2. Add tools beyond the five in §4 before apply-rate is measured. More tools is the reflexive move
   and the wrong one; a coach that does five things reliably beats one that does twelve badly.

---

*Written 2026-07-22. Update `ARCHITECTURE.md` and `PRODUCT_AUDIT.html` as each batch lands, per
`CLAUDE.md`.*
