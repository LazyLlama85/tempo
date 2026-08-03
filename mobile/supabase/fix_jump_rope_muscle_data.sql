-- Tempo — fix Jump Rope's muscle categorization (2026-08-02, founder-reported)
--
-- Jump Rope (id 00000000-0000-0000-0000-000000000048) listed 'shoulders' as a
-- PRIMARY muscle alongside 'calves'. A jump rope's primary training effect is
-- calf/lower-leg endurance from the jump itself — the arms/shoulders do real
-- work stabilizing the rope swing, but that's a secondary/stabilizer role, not
-- the exercise's main driver. This mislabeling surfaced directly to users: the
-- muscle-map/Body Intelligence screens showed Jump Rope as a "shoulders"
-- exercise, and Quick Workout's Target Area muscle filter could pull it into
-- a Shoulders-targeted session where it doesn't belong.
--
-- Moves 'shoulders' from primary to secondary (it already lists 'forearms'
-- and 'core' there for the same reason) rather than dropping it outright —
-- the stabilizer effect is real, just not primary.

update exercises
set primary_muscles = array_remove(primary_muscles, 'shoulders'),
    secondary_muscles = array_append(secondary_muscles, 'shoulders')
where id = '00000000-0000-0000-0000-000000000048'
  and 'shoulders' = any(primary_muscles)
  and not ('shoulders' = any(secondary_muscles));
