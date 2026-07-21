-- Public (logged-out) share preview (PRODUCT_AUDIT.html §26, L27).
--
-- get_workout_share_by_code (fix_workout_shares_rls.sql) already implements the
-- correct capability-URL model — "you may read a row if you present its exact
-- code" — but was only granted to `authenticated`, so a shared workout could not
-- be viewed by anyone without a Tempo account. That defeats the entire point of
-- a share link as a growth loop: a logged-out stranger hitting fittempo.app/w/x
-- got nothing. A public web preview (web/share.html) is a first-class instance
-- of the exact same "if you have the code, you're meant to see it" model this
-- function was already built around — it needs no new trust boundary, only the
-- same read extended to anon.

grant execute on function public.get_workout_share_by_code(text) to anon;
