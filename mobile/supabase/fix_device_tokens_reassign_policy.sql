-- Tempo/Arclo — allow a device's push token to be reclaimed by a new user.
--
-- Found 2026-08-10 (Sentry, Postgres 42501 insufficient_privilege): the single
-- "Users can manage own device tokens" ALL policy required `auth.uid() = user_id`
-- on BOTH sides for every command. `registerPushToken` (lib/pushTokens.ts) upserts
-- on `onConflict: 'token'` — Expo push tokens are scoped to a (device, app
-- install), not an account, so if a SECOND account signs in on the same physical
-- device without a clean sign-out clearing the first account's row first (a real
-- scenario on a shared/resold device, and common on a shared test device), the
-- upsert's implicit UPDATE tries to touch a row still owned by the FIRST user.
-- The old policy's USING clause blocked that outright — the row wasn't even
-- visible to attempt an update on — so the whole upsert failed with 42501 and the
-- second user silently never got a token registered (caught by the function's own
-- try/catch, so no crash — just no retention pushes on that device).
--
-- Fix: split the ALL policy into one per command. SELECT/DELETE/INSERT are
-- unchanged (still `auth.uid() = user_id` both ways — you can only ever see,
-- remove, or create YOUR OWN rows). UPDATE's USING is relaxed to `true` so any
-- authenticated user's upsert can locate a conflicting row regardless of its
-- current owner, but its WITH CHECK stays `auth.uid() = user_id` — the row must
-- end up belonging to whoever is making the request. Net effect: a device token
-- can be reassigned to whoever currently controls that device, but nobody can
-- ever make a token point at someone ELSE's account. `token` is an opaque,
-- unguessable string issued by Apple/Google via Expo's push service, not
-- something an attacker could target without already controlling that device.

drop policy if exists "Users can manage own device tokens" on public.device_tokens;

create policy "Users can view own device tokens"
  on public.device_tokens for select
  using (auth.uid() = user_id);

create policy "Users can insert own device tokens"
  on public.device_tokens for insert
  with check (auth.uid() = user_id);

create policy "Users can reclaim a device token"
  on public.device_tokens for update
  using (true)
  with check (auth.uid() = user_id);

create policy "Users can delete own device tokens"
  on public.device_tokens for delete
  using (auth.uid() = user_id);
