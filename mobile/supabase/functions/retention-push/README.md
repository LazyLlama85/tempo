# retention-push

Server-driven retention notifications. Decides per user whether to send a push
*right now* and delivers it via the Expo Push API. This is the engine that makes
notifications a retention driver instead of device-local alarms.

## What it does

On each run (scheduled hourly) it evaluates four rules per user, each
de-duplicated to **at most once per user per day** via `notification_log`:

| Type             | Trigger                                                        | Deep link      |
|------------------|---------------------------------------------------------------|----------------|
| `missed_workout` | A plan session was due earlier today and isn't completed.     | `plan`         |
| `streak_at_risk` | Trained yesterday, not yet today, and it's evening.           | `quick-workout`|
| `free_time_gap`  | Nothing scheduled/done today, during the active daytime hours.| `quick-workout`|
| `reactivation`   | No completed workout in the last 5 days.                      | `home`         |

Every send attempt is written to `notification_log` (`sent` / `failed` + Expo
ticket id + error). Tokens Expo reports as `DeviceNotRegistered` are disabled so
we stop wasting sends on dead devices. Whole-batch network failures are logged as
`failed` and naturally retried on the next hourly run.

## Setup

1. Apply the schema: run `supabase/add_push_notifications.sql` (creates
   `device_tokens` and `notification_log`).
2. Deploy the function (no JWT — it's invoked by cron, not users):

   ```
   npx supabase functions deploy retention-push --no-verify-jwt
   ```

   `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are injected by the platform.
3. Schedule it hourly with pg_cron + pg_net — see the commented `cron.schedule`
   block at the bottom of `add_push_notifications.sql`.

## Client side

`mobile/src/lib/pushTokens.ts` registers each device's Expo push token on login
(and removes it on sign-out). Tap routing lives in `src/app/_layout.tsx`, which
reads `data.screen` from the push payload.

## Notes / future work

- `free_time_gap` currently uses a daytime heuristic (no scheduled or completed
  workout during active hours). True calendar-gap detection needs the on-device
  calendar data and could be pushed up to the server later.
- Local scheduling (`notifications.ts`) is kept only for the immediate
  "starts in 30 min" pre-workout reminder; all retention nudges are server-driven.
