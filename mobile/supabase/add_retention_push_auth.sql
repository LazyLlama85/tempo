-- Tempo — retention-push edge function auth (2026-08-02 fix pass, Tier 1 #1)
--
-- retention-push is deployed with verify_jwt=false (the pg_cron caller has no user
-- JWT to present), which meant ANY unauthenticated POST ran the function with full
-- service-role DB access. This closes that hole with a shared secret stored in
-- Supabase Vault: the cron job sends it as the `x-retention-push-secret` header
-- (see the pg_cron job command, updated via cron.alter_job in the same session —
-- not re-declared here since cron.schedule isn't idempotent-safe to replay blindly),
-- and the function fetches the same value through this RPC to compare.
--
-- Vault's own tables aren't exposed through PostgREST by default (and shouldn't
-- be widened just for this), so a SECURITY DEFINER function in `public` — always
-- reachable via supabase-js .rpc() — is the reliable path. REVOKE from anon/
-- authenticated so only the service-role client (which bypasses grants entirely,
-- but we still lock this down defensively) can call it.

create or replace function public.get_retention_push_secret()
returns text
language sql
security definer
set search_path = public, vault
as $$
  select decrypted_secret from vault.decrypted_secrets where name = 'retention_push_shared_secret'
$$;

revoke all on function public.get_retention_push_secret() from public, anon, authenticated;
grant execute on function public.get_retention_push_secret() to service_role;
