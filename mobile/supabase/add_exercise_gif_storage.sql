-- Tempo — self-hosted cache for exercise form-guide GIFs.
--
-- The app used to call the ExerciseDB image endpoint live, on every device, on
-- every view (`src/data/exerciseMedia.ts`) — that's what exhausted the RapidAPI
-- BASIC plan's 690 req/month quota almost immediately, since the quota is shared
-- across every install, not per-developer. Each exercise's GIF never changes, so
-- it only needs to be fetched from RapidAPI ONCE, ever: scripts/backfill-exercise-media.mjs
-- downloads each one (within the free monthly quota, trickled across a few runs)
-- and uploads it here. The app then serves this public bucket directly — free,
-- unlimited, no RapidAPI call at runtime for the built-in library.
--
-- Public (like avatars) because it's static reference media with no owner —
-- everyone should be able to load it directly via the storage CDN URL, no
-- signed-URL refresh needed. Only the backfill script (service-role key) writes;
-- no client-facing insert/update/delete policy is needed or granted.

insert into storage.buckets (id, name, public)
values ('exercise-gifs', 'exercise-gifs', true)
on conflict (id) do nothing;

drop policy if exists "Exercise GIFs are publicly accessible" on storage.objects;
create policy "Exercise GIFs are publicly accessible"
  on storage.objects for select
  using (bucket_id = 'exercise-gifs');
