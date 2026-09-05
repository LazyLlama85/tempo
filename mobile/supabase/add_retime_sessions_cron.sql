-- Applied 2026-09-05. Hourly server-side enforcement of "never schedule a
-- session at a time the user cannot make". See supabase/functions/retime-sessions.
-- Runs at :20, offset from retention-push-hourly (:00), so a session is corrected
-- before any notification could announce it at the wrong time.
select cron.schedule(
  'retime-sessions-hourly',
  '20 * * * *',
  $$
  select net.http_post(
    url := 'https://rtoahppnekykgmjukujm.supabase.co/functions/v1/retime-sessions',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-retention-push-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'retention_push_shared_secret' limit 1)
    ),
    body := '{}'::jsonb
  );
  $$
);
