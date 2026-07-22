# `tempo-coach` Edge Function

The server half of Tempo Coach. Takes a user message plus a context pack the app
assembled, asks Claude for a reply, and returns text plus an optional **proposed**
action. It never writes to a training table and never executes a tool — the app
renders the action as a confirm card and the existing client lib functions do the
write when the user taps Apply.

Full design rationale: `TEMPO_COACH_PLAN.md` (repo root).

## Setup

```bash
cd mobile
npx supabase secrets set ANTHROPIC_API_KEY=sk-ant-...
npx supabase functions deploy tempo-coach     # JWT verification ON — do not pass --no-verify-jwt
```

Requires `add_tempo_coach.sql` to have been applied (the `coach_messages` table).
`SUPABASE_URL` and `SUPABASE_ANON_KEY` are injected by the platform.

> ⚠️ **The API key must never leave Supabase secrets.** An `EXPO_PUBLIC_*` key is
> inlined into the shipped IPA/APK at build time and is trivially extractable —
> anyone who downloads the app could spend the account's balance without limit.

## Contract

`POST` with the caller's Supabase JWT in `Authorization`.

```jsonc
// request
{
  "message": "I'm slammed Tuesday and Wednesday",
  "context": { /* CoachContext — built by lib/coach.buildCoachContext */ },
  "history": [{ "role": "user", "content": "..." }]   // last few turns; server keeps 10
}

// 200
{
  "text": "Both your Tue and Wed sessions are at risk...",
  "action": { "name": "reschedule_week", "input": { "reason": "...", "busy_days": ["tue","wed"] } },
  "truncated": false,
  "remaining": 2,
  "locked": true
}
```

`action` is `null` when the reply is purely conversational. `remaining` is the
number of messages left in the current window. `truncated` means the model hit
`max_tokens` — show the partial text, don't render the action.

| Status | Meaning |
|---|---|
| `400` | Empty/oversized message, oversized context, or unparseable body |
| `401` | Missing or invalid JWT |
| `402` | Quota exhausted. `{ error: "quota", locked, remaining: 0 }` — route to `/paywall` when `locked` |
| `500` | Upstream or unhandled failure. The user's allowance is **not** consumed |
| `503` | `ANTHROPIC_API_KEY` not configured |

## Quota

Counted from `coach_messages` in Postgres, not from anything the client sends — a
client-side check is UX, this is the limit. Rows are written only after a
successful reply, so a failed request never burns an allowance.

- **Free (`proEnabled && !isPro`)** — 3 messages per week, Monday-anchored UTC.
- **Pro / dormant** — 200 per calendar month, a soft cap to bound worst-case spend.

## Model configuration

`claude-opus-4-8`, `max_tokens: 1500`, `thinking: { type: 'adaptive' }`,
`output_config: { effort: 'medium' }`. Gotchas for this model, all of which are
400s if you get them wrong:

- `temperature` / `top_p` / `top_k` are **rejected**. Steer with the system prompt.
- Thinking is **off** unless explicitly set — omitting the field is not "adaptive".
- `budget_tokens` is removed; depth is `output_config.effort`.
- `effort` goes **inside** `output_config`, not top-level.
- Always check `stop_reason` before reading `content` — on a refusal it can be empty.

Tools use `strict: true` with closed schemas, so the action args always parse.
"Optional" args are modelled as required-with-an-empty-value, because strict mode
wants every property in `required`.

## Cost

Every call logs a line with `in`/`out` token counts. That log is how the real
per-message cost gets known — the estimate in `TEMPO_COACH_PLAN.md` §9 (~$0.04)
is a projection. Check it against reality before changing the free limit.

## Known limitation (v1)

The server can only see **comped** Pro grants (`app_config.pro_user_ids`), not real
RevenueCat subscriptions — RevenueCat's entitlement lives on the client. So once
Pro is live, a genuine paying subscriber is metered as free by this function.

Two ways out when it matters, in order of preference: verify the RevenueCat
receipt server-side, or have a RevenueCat webhook maintain a `pro_subscribers`
table this function reads. **Resolve this before flipping `pro_enabled` globally**
— shipping without it means charging people for something they still get rationed.
While Pro is dormant (`proEnabled === false`) nobody is locked, so it is not
currently user-visible.

## Testing

```bash
curl -sX POST "$SUPABASE_URL/functions/v1/tempo-coach" \
  -H "Authorization: Bearer $USER_JWT" \
  -H "Content-Type: application/json" \
  -d '{"message":"I am slammed Tuesday and Wednesday","context":{},"history":[]}'
```

Run this against the deployed function with a real user JWT before building any
UI on top of it.
