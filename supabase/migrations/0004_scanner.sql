-- TRASHMORPH Stage 4: waste scan history and private scan-image storage.
create table public.waste_scans (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  image_path text,                                  -- null when the user chose not to save the photo
  category text not null check (category in ('plastic','paper','cardboard','glass','metal','organic','electronic','textile','general','other','uncertain')),
  confidence real not null check (confidence >= 0 and confidence <= 1),
  top_guess text check (char_length(top_guess) <= 60),
  suggested_action text not null,
  is_uncertain boolean not null,
  model_version text,
  created_at timestamptz not null default now()
);
create index waste_scans_user_idx on public.waste_scans (user_id, created_at desc);
alter table public.waste_scans enable row level security;
revoke all on public.waste_scans from anon, authenticated;
grant select, delete on public.waste_scans to authenticated;
grant insert (user_id, image_path, category, confidence, top_guess, suggested_action, is_uncertain, model_version) on public.waste_scans to authenticated;
create policy "scans_select_own" on public.waste_scans for select to authenticated using (user_id = auth.uid());
create policy "scans_insert_own" on public.waste_scans for insert to authenticated with check (user_id = auth.uid());
create policy "scans_delete_own" on public.waste_scans for delete to authenticated using (user_id = auth.uid());

-- Private bucket: nobody can read a scan photo except its owner (the API hands out short-lived signed links).
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('scan-images', 'scan-images', false, 5242880, array['image/jpeg','image/png','image/webp'])
on conflict (id) do nothing;
create policy "scan_images_select_own" on storage.objects for select to authenticated
  using (bucket_id = 'scan-images' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "scan_images_insert_own" on storage.objects for insert to authenticated
  with check (bucket_id = 'scan-images' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "scan_images_delete_own" on storage.objects for delete to authenticated
  using (bucket_id = 'scan-images' and (storage.foldername(name))[1] = auth.uid()::text);
