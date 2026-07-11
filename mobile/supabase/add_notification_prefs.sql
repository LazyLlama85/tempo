-- Tempo — per-rule notification preferences (audit §6.1).
--
-- Replaces the all-or-nothing push switch with granular control: a user who finds
-- one nag wrong (say streak-at-risk) can mute just that one and keep the weekly
-- report, instead of silencing everything (which is what drives the "annoying app"
-- uninstall). The client writes this; the retention-push Edge Function reads it and
-- skips any rule set to false.
--
-- Shape (jsonb, all keys optional — absent key = its default):
--   { "missed_workout": true, "streak_at_risk": true,
--     "weekly_report": true, "free_time_gap": true }
-- Defaults live in the client (lib/notificationPrefs.ts) and the function: every
-- rule defaults ON, so nothing a user currently receives silently stops — a rule is
-- only muted when explicitly turned off. (The audit suggested free_time_gap default
-- OFF; that's a one-line flip in both places if desired.) The pre-workout reminder
-- and the reactivation win-back are intentionally NOT here:
-- the former is a device-local setting (local notifications are per-device), the
-- latter is a low-frequency win-back kept always-on.
--
-- NULL = "user never touched the settings" = use all defaults. RLS already scopes
-- user_profiles to its owner; the Edge Function reads it with the service role.

alter table user_profiles
  add column if not exists notification_prefs jsonb;
