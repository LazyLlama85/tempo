-- Tempo — RLS performance: stop re-evaluating auth.uid() per row.
--
-- Supabase's own linter (auth_rls_initplan) flagged 41 policies across ~20 tables
-- that call `auth.uid()` directly inside USING/WITH CHECK. Postgres can't tell
-- that function is stable for the duration of a statement when written bare, so
-- it re-invokes it for EVERY ROW scanned instead of once per query. Wrapping the
-- same call as `(select auth.uid())` lets the planner hoist it into an InitPlan
-- (evaluated once, cached, reused per row) — same access-control result, cheaper
-- plan. This matters most on exactly the tables Home's app-open sweep and its
-- 20+ queries already hit hardest: scheduled_workouts, set_logs, workout_logs,
-- user_plans.
--
-- ALTER POLICY only touches the clause(s) given — a policy whose WITH CHECK was
-- null before stays null (Postgres falls back to USING for it, unchanged
-- behavior), never adding a clause that wasn't there. Every rewrite below is a
-- pure `auth.uid()` -> `(select auth.uid())` substitution, including occurrences
-- nested inside EXISTS subqueries and function arguments (are_friends(),
-- is_group_member()) — no other change to role, command, or logic.

-- activity_events
alter policy "Insert own events" on public.activity_events
  with check (((select auth.uid()) = user_id));

alter policy "Read own or friends events" on public.activity_events
  using (
    ((select auth.uid()) = user_id) or (exists (
      select 1 from user_profiles p
      where p.user_id = activity_events.user_id
        and (p.privacy_activity = 'public'::text
          or (p.privacy_activity = 'friends'::text and are_friends((select auth.uid()), activity_events.user_id)))
    ))
  );

-- activity_reactions
alter policy "activity_reactions_own_delete" on public.activity_reactions
  using (reactor_id = (select auth.uid()));

alter policy "activity_reactions_own_insert" on public.activity_reactions
  with check (reactor_id = (select auth.uid()));

alter policy "activity_reactions_own_select" on public.activity_reactions
  using (reactor_id = (select auth.uid()));

-- adaptation_events
alter policy "Users can view own adaptation events" on public.adaptation_events
  using ((select auth.uid()) = user_id);

-- body_measurements
alter policy "Users can manage own measurements" on public.body_measurements
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

-- coach_messages
alter policy "own coach messages" on public.coach_messages
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

-- device_tokens
alter policy "Users can delete own device tokens" on public.device_tokens
  using ((select auth.uid()) = user_id);

alter policy "Users can insert own device tokens" on public.device_tokens
  with check ((select auth.uid()) = user_id);

alter policy "Users can reclaim a device token" on public.device_tokens
  with check ((select auth.uid()) = user_id);

alter policy "Users can view own device tokens" on public.device_tokens
  using ((select auth.uid()) = user_id);

-- exercise_substitutions
alter policy "Users manage own substitutions" on public.exercise_substitutions
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

-- exercises
alter policy "Delete own custom exercises" on public.exercises
  using (user_id = (select auth.uid()));

alter policy "Insert own custom exercises" on public.exercises
  with check ((user_id = (select auth.uid())) and (is_custom = true));

alter policy "Read built-in and own exercises" on public.exercises
  using ((user_id is null) or (user_id = (select auth.uid())));

alter policy "Update own custom exercises" on public.exercises
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

-- friendships
alter policy "Addressee responds" on public.friendships
  using ((select auth.uid()) = addressee_id)
  with check ((select auth.uid()) = addressee_id);

alter policy "Either party can remove" on public.friendships
  using (((select auth.uid()) = requester_id) or ((select auth.uid()) = addressee_id));

alter policy "Parties can view friendship" on public.friendships
  using (((select auth.uid()) = requester_id) or ((select auth.uid()) = addressee_id));

alter policy "Send friend request" on public.friendships
  with check (((select auth.uid()) = requester_id) and (status = 'pending'::text));

-- group_members
alter policy "Leave a group" on public.group_members
  using (user_id = (select auth.uid()));

alter policy "Members see co-members" on public.group_members
  using (is_group_member(group_id, (select auth.uid())));

-- groups
alter policy "Members read their groups" on public.groups
  using ((owner_id = (select auth.uid())) or is_group_member(id, (select auth.uid())));

alter policy "Owner manages group" on public.groups
  using (owner_id = (select auth.uid()))
  with check (owner_id = (select auth.uid()));

-- notification_log
alter policy "Users can view own notifications" on public.notification_log
  using ((select auth.uid()) = user_id);

-- scheduled_workouts
alter policy "Users can manage own scheduled workouts" on public.scheduled_workouts
  using ((select auth.uid()) = user_id);

-- set_logs
alter policy "Users can manage own set logs" on public.set_logs
  using (exists (
    select 1 from workout_logs w
    where w.id = set_logs.workout_log_id and w.user_id = (select auth.uid())
  ));

-- splits
alter policy "Users manage own splits" on public.splits
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

-- user_badges
alter policy "Read own or friends badges" on public.user_badges
  using (
    ((select auth.uid()) = user_id) or (exists (
      select 1 from user_profiles p
      where p.user_id = user_badges.user_id
        and (p.privacy_stats = 'public'::text
          or (p.privacy_stats = 'friends'::text and are_friends((select auth.uid()), user_badges.user_id)))
    ))
  );

-- user_plans
alter policy "Users can manage own plans" on public.user_plans
  using ((select auth.uid()) = user_id);

-- user_profiles
alter policy "Users can insert own profile" on public.user_profiles
  with check ((select auth.uid()) = user_id);

alter policy "Users can update own profile" on public.user_profiles
  using ((select auth.uid()) = user_id);

alter policy "Users can view own profile" on public.user_profiles
  using ((select auth.uid()) = user_id);

-- workout_invites
alter policy "Parties read invites" on public.workout_invites
  using (((select auth.uid()) = from_user) or ((select auth.uid()) = to_user));

-- workout_logs
alter policy "Users can manage own workout logs" on public.workout_logs
  using ((select auth.uid()) = user_id);

-- workout_shares
alter policy "Create own shares" on public.workout_shares
  with check ((select auth.uid()) = owner_id);

alter policy "Delete own shares" on public.workout_shares
  using ((select auth.uid()) = owner_id);

alter policy "Owners can read their own shares" on public.workout_shares
  using ((select auth.uid()) = owner_id);

-- workout_templates
alter policy "Friends can view templates" on public.workout_templates
  using (
    ((select auth.uid()) = user_id) or (exists (
      select 1 from user_profiles p
      where p.user_id = workout_templates.user_id
        and (p.privacy_workouts = 'public'::text
          or (p.privacy_workouts = 'friends'::text and are_friends((select auth.uid()), workout_templates.user_id)))
    ))
  );

alter policy "Users manage own templates" on public.workout_templates
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);
