-- Tempo Coach — conversation history + the metering surface.
--
-- One table backs three things at once, deliberately:
--   1. Thread history (what the user sees when they reopen /coach).
--   2. The prompt's conversation window (the last N rows are replayed to the model).
--   3. The free-tier quota — a count over role='user' rows since the start of the
--      week. There is no separate counter: one source of truth, and because it
--      lives in Postgres rather than on the device it survives reinstalls and
--      can't be cleared by wiping app data (the flaw in every device-local flag).
--
-- `action` holds the model's proposed tool call verbatim ({name, input}); the app
-- renders it as a confirm card and only writes to the real tables when the user
-- taps Apply. `action_state` is what makes the feature measurable — a Coach whose
-- proposals are never applied is a chatbot, and we want to find that out from data
-- rather than from vibes. See TEMPO_COACH_PLAN.md §5.

create table if not exists coach_messages (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users(id) on delete cascade,
  role         text not null check (role in ('user', 'assistant')),
  content      text not null,
  action       jsonb,
  action_state text check (action_state in ('proposed', 'applied', 'dismissed', 'failed')),
  created_at   timestamptz not null default now()
);

-- Every read is "this user's most recent messages" (thread render, prompt window)
-- or "this user's messages since date X" (quota). Both are served by this index.
create index if not exists coach_messages_user_created_idx
  on coach_messages (user_id, created_at desc);

alter table coach_messages enable row level security;

-- A coach thread is strictly private: a user reads and writes only their own rows.
-- The Edge Function inserts using the caller's JWT (not the service-role key), so
-- this policy is the real enforcement, not a formality.
drop policy if exists "own coach messages" on coach_messages;
create policy "own coach messages" on coach_messages
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
