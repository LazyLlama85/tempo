-- Tempo — avatar photo storage.
--
-- Profile pictures were previously just a preset icon+color sentinel
-- (user_profiles.avatar_url = "tempo:<icon>:<hex>") — no upload existed. This adds
-- a PUBLIC storage bucket for real avatar photos (public, unlike progress-photos,
-- because avatars are shown to friends elsewhere in the app and need no
-- signed-URL refresh cycle). parseAvatar() in src/lib/avatar.ts already renders any
-- http(s) URL found in avatar_url directly, so no column/schema change is needed —
-- only the bucket + its access policies.

insert into storage.buckets (id, name, public)
values ('avatars', 'avatars', true)
on conflict (id) do nothing;

-- Anyone can view an avatar (public bucket — needed so friends can see it too).
drop policy if exists "Avatar images are publicly accessible" on storage.objects;
create policy "Avatar images are publicly accessible"
  on storage.objects for select
  using (bucket_id = 'avatars');

-- A user may only upload/update/delete files inside their own "<user_id>/…" path.
drop policy if exists "Users can upload their own avatar" on storage.objects;
create policy "Users can upload their own avatar"
  on storage.objects for insert
  with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "Users can update their own avatar" on storage.objects;
create policy "Users can update their own avatar"
  on storage.objects for update
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "Users can delete their own avatar" on storage.objects;
create policy "Users can delete their own avatar"
  on storage.objects for delete
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);
