# Tempo — Activation Definition (draft for founder sign-off, not a decree)

`PRODUCT_AUDIT.html`'s own "Critical — do before any marketing spend" tier names this as the #1
remaining gap: a written, agreed definition of "activated," so B0.3's funnel and every retention
decision downstream has a real target instead of a vibe. This is a proposal to approve or amend —
not something Claude should unilaterally decide, since it's a product judgment call about what
"the core loop is proven for this user" actually means.

## What's already built (code, today)

- `activation_reached` (in `lib/activation.ts`) fires **exactly once per user**, the moment they
  complete their **2nd session** (`ACTIVATION_SESSIONS = 2`). Reasoning already in the code: "a
  single first-run workout proves nothing about the habit; a SECOND completion means the user
  returned and the plan → train → log loop is actually working for them." **No time window** — it
  fires whenever the 2nd session happens, even if that's 60 days after signup. This is a real gap
  if the intent is "activated within the trial-relevant window" (see the open decision below).
- `calendar_connected` fires once per user **per provider**, the first time Google or device
  calendar is connected. Completely independent event — never gates or blocks `activation_reached`.
- Both are already de-duplicated by durable, force-close-proof localStorage flags (`lib/activation.ts`)
  — safe to build funnels/cohorts on without worrying about double-counting.

## Proposed definition

> **A user is "activated" when they complete their 2nd session** (already built, already firing).
> **Calendar-connected is tracked as a separate cohort split, not folded into the activation event
> itself.**

### Why a cohort split instead of requiring calendar connection

The alternative — `activated = calendar_connected AND 2 completed sessions` — sounds more aligned
with "the core loop that makes Tempo different," but has a real cost: calendar connection is
**optional by design** (removed from onboarding's required path specifically to cut OAuth friction —
see `ARCHITECTURE.md`'s Calendar section). Gating activation on an optional action means a
perfectly-engaged user who just never got around to connecting a calendar would show up as
"never activated" in every dashboard, which would understate real retention and could push toward
the wrong fix (nagging people to connect a calendar instead of asking whether the core habit loop
itself is working).

**Recommendation:** keep `activation_reached` exactly as it fires today (2 sessions, no calendar
requirement), and answer the real underlying question — "does the calendar wedge actually help
retention?" — as a **breakdown**, not a gate: segment the activation funnel and every retention
curve by `calendar_connected` (fired vs. not-fired) as a property/cohort. This gives you the more
interesting number — *do calendar-adopters retain better* — without corrupting the headline
activation rate.

## Open decision the founder still owes (this doc doesn't decide it)

**Should `activation_reached` gain a time window** (e.g., "2 sessions within 14 days of signup," per
this doc's original framing) so a technically-activated-eventually user who took 3 months to get
there doesn't count the same as someone who activated in week one? Two honest options:

- **Leave it uncapped** (today's behavior) — simpler, and "did they ever activate" is still a
  meaningful number on its own.
- **Add a window** — requires a small code change (`lib/activation.ts` would need the user's
  signup date to compare against, currently not threaded through) — genuinely more informative for
  measuring onboarding/trial-window effectiveness specifically, but is NEW code, not just
  documentation, so it's listed here as a decision + follow-up task, not something bundled into this
  draft.

## PostHog insights to build once real data exists (the funnel/retention dashboard from this session
is already live and waiting — id 1865254, "Tempo — Activation & Retention")

1. **Activation funnel, split by calendar-connected**: `onboarding_complete` → `activation_reached`,
   breakdown property = whether `calendar_connected` fired for that user. Answers "does connecting a
   calendar actually predict activation" directly.
2. **D7/D30 retention, split by calendar-connected**: same breakdown on the existing
   activation-anchored retention insight. Answers the audit's own question: "why users will stay...
   the scheduling wedge genuinely removes a real weekly decision" — this is the number that either
   proves or disproves that claim.
3. **Time-to-activation distribution** (once/if the time-window decision above is resolved and
   implemented): a simple trends query on `activation_reached`'s implicit delay from
   `onboarding_complete`, to see whether most activation happens in week one or trails off.

## Why this matters more than any remaining feature work

Every "Conversion Potential," "Retention," and "Subscription Value" score in `PRODUCT_AUDIT.html` is
explicitly held at "structural cap removed, not yet proven" — this definition, once approved and
once a build ships with the (already-fixed) PostHog key, is the thing that turns those from
projections into real, defensible numbers.
