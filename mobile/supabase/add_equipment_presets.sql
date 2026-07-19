-- Tempo — saved equipment presets for Quick Workout.
--
-- A user can save named equipment sets ("Home – bands & dumbbells", "Hotel gym")
-- and pick one when generating a Quick Workout, so the session is built around the
-- gear they actually have right now. Stored as a jsonb array on the profile
-- (same pattern as travel_mode / notification_prefs), so it syncs across devices.
--
-- Shape: [{ "id": "uuid", "name": "Home", "equipment": ["dumbbells","resistance_bands"] }]
-- Reads/writes degrade gracefully if this column is missing (lib/equipmentPresets).

alter table public.user_profiles
  add column if not exists equipment_presets jsonb not null default '[]'::jsonb;
