-- TRASHMORPH Stage 2: listings, marketplace (favorites, inquiries, reports), notifications.

create table public.waste_listings (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  title text not null check (char_length(title) between 3 and 120),
  description text check (char_length(description) <= 2000),
  category text not null check (category in ('plastic','paper','cardboard','glass','metal','organic','electronic','textile','general','other')),
  quantity numeric not null check (quantity > 0 and quantity <= 1000000),
  unit text not null check (unit in ('kg','g','items','litres','boxes','bags')),
  condition text not null check (condition in ('like_new','good','fair','scrap')),
  listing_type text not null check (listing_type in ('free','exchange','price')),
  price numeric(10,2) check (price >= 0),
  latitude double precision check (latitude between -90 and 90),
  longitude double precision check (longitude between -180 and 180),
  location_label text not null check (char_length(location_label) between 2 and 120),
  status text not null default 'draft' check (status in ('draft','active','reserved','collected','completed','cancelled')),
  images text[] not null default '{}' check (cardinality(images) <= 5),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint price_matches_type check ((listing_type = 'price' and price is not null) or (listing_type <> 'price' and price is null)),
  constraint coords_pair check ((latitude is null) = (longitude is null))
);
create index waste_listings_browse_idx on public.waste_listings (status, created_at desc);
create index waste_listings_owner_idx on public.waste_listings (owner_id, created_at desc);
create index waste_listings_category_idx on public.waste_listings (category);
create trigger waste_listings_updated before update on public.waste_listings for each row execute function public.set_updated_at();

-- Database-level backstop for the status workflow and edit lock (the API checks too).
create or replace function public.validate_listing_update() returns trigger language plpgsql as $$
begin
  if new.status is distinct from old.status and not (
       (old.status = 'draft'     and new.status in ('active','cancelled'))
    or (old.status = 'active'    and new.status in ('reserved','cancelled'))
    or (old.status = 'reserved'  and new.status in ('active','collected','cancelled'))
    or (old.status = 'collected' and new.status = 'completed')) then
    raise exception 'invalid status transition % -> %', old.status, new.status;
  end if;
  if old.status not in ('draft','active') and
     (new.title, new.description, new.category, new.quantity, new.unit, new.condition, new.listing_type, new.price,
      new.latitude, new.longitude, new.location_label, new.images)
     is distinct from
     (old.title, old.description, old.category, old.quantity, old.unit, old.condition, old.listing_type, old.price,
      old.latitude, old.longitude, old.location_label, old.images) then
    raise exception 'listing can no longer be edited in status %', old.status;
  end if;
  return new;
end $$;
create trigger waste_listings_validate before update on public.waste_listings for each row execute function public.validate_listing_update();

-- Safe public view of seller info (no email, no role).
create view public.public_profiles as select id, full_name, avatar_url from public.profiles;
grant select on public.public_profiles to anon, authenticated;

create table public.marketplace_favorites (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  listing_id uuid not null references public.waste_listings(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (user_id, listing_id)
);

create table public.marketplace_inquiries (
  id uuid primary key default gen_random_uuid(),
  listing_id uuid not null references public.waste_listings(id) on delete cascade,
  sender_id uuid not null references auth.users(id) on delete cascade,
  recipient_id uuid not null references auth.users(id) on delete cascade,
  message text not null check (char_length(message) between 10 and 1000),
  reply_contact text check (char_length(reply_contact) <= 120),
  status text not null default 'new' check (status in ('new','read')),
  created_at timestamptz not null default now(),
  unique (listing_id, sender_id),
  check (sender_id <> recipient_id)
);
create index inquiries_recipient_idx on public.marketplace_inquiries (recipient_id, created_at desc);
create index inquiries_sender_idx on public.marketplace_inquiries (sender_id, created_at desc);

create table public.listing_reports (
  id uuid primary key default gen_random_uuid(),
  listing_id uuid not null references public.waste_listings(id) on delete cascade,
  reporter_id uuid not null references auth.users(id) on delete cascade,
  reason text not null check (reason in ('spam','unsafe','misleading','prohibited','other')),
  details text check (char_length(details) <= 500),
  created_at timestamptz not null default now(),
  unique (listing_id, reporter_id)
);

create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null,
  message text not null,
  notification_type text not null,
  reference_id uuid,
  read_at timestamptz,
  created_at timestamptz not null default now()
);
create index notifications_user_idx on public.notifications (user_id, created_at desc);
create index notifications_unread_idx on public.notifications (user_id) where read_at is null;

-- Only the database (never a client) creates notifications. Respects the in-app preference.
create or replace function public.create_notification(uid uuid, t text, m text, ntype text, ref uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if coalesce((select (notification_preferences->>'in_app')::boolean from public.user_settings where user_id = uid), true) then
    insert into public.notifications (user_id, title, message, notification_type, reference_id) values (uid, t, m, ntype, ref);
  end if;
end $$;
revoke execute on function public.create_notification(uuid, text, text, text, uuid) from public, anon, authenticated;

create or replace function public.notify_new_inquiry() returns trigger
language plpgsql security definer set search_path = public as $$
declare t text;
begin
  select title into t from public.waste_listings where id = new.listing_id;
  perform public.create_notification(new.recipient_id, 'New inquiry', 'Someone asked about "' || coalesce(t, 'your listing') || '".', 'inquiry', new.listing_id);
  return new;
end $$;
create trigger inquiry_notify after insert on public.marketplace_inquiries for each row execute function public.notify_new_inquiry();

alter table public.waste_listings enable row level security;
alter table public.marketplace_favorites enable row level security;
alter table public.marketplace_inquiries enable row level security;
alter table public.listing_reports enable row level security;
alter table public.notifications enable row level security;

revoke all on public.waste_listings, public.marketplace_favorites, public.marketplace_inquiries, public.listing_reports, public.notifications from anon, authenticated;

grant select on public.waste_listings to anon, authenticated;
grant insert (owner_id, title, description, category, quantity, unit, condition, listing_type, price, latitude, longitude, location_label, status, images) on public.waste_listings to authenticated;
grant update (title, description, category, quantity, unit, condition, listing_type, price, latitude, longitude, location_label, status, images) on public.waste_listings to authenticated;
grant delete on public.waste_listings to authenticated;
create policy "listings_read" on public.waste_listings for select to anon, authenticated using (status = 'active' or owner_id = auth.uid());
create policy "listings_insert_own" on public.waste_listings for insert to authenticated with check (owner_id = auth.uid() and status in ('draft','active'));
create policy "listings_update_own" on public.waste_listings for update to authenticated using (owner_id = auth.uid()) with check (owner_id = auth.uid());
create policy "listings_delete_own" on public.waste_listings for delete to authenticated using (owner_id = auth.uid() and status in ('draft','cancelled'));

grant select, insert, delete on public.marketplace_favorites to authenticated;
create policy "fav_select_own" on public.marketplace_favorites for select to authenticated using (user_id = auth.uid());
create policy "fav_insert_own" on public.marketplace_favorites for insert to authenticated with check (user_id = auth.uid());
create policy "fav_delete_own" on public.marketplace_favorites for delete to authenticated using (user_id = auth.uid());

grant select on public.marketplace_inquiries to authenticated;
grant insert (listing_id, sender_id, recipient_id, message, reply_contact) on public.marketplace_inquiries to authenticated;
grant update (status) on public.marketplace_inquiries to authenticated;
create policy "inq_select_parties" on public.marketplace_inquiries for select to authenticated using (sender_id = auth.uid() or recipient_id = auth.uid());
create policy "inq_insert_sender" on public.marketplace_inquiries for insert to authenticated with check (
  sender_id = auth.uid() and exists (select 1 from public.waste_listings l where l.id = listing_id and l.owner_id = recipient_id and l.status = 'active' and l.owner_id <> auth.uid()));
create policy "inq_update_recipient" on public.marketplace_inquiries for update to authenticated using (recipient_id = auth.uid()) with check (recipient_id = auth.uid());

grant select, insert on public.listing_reports to authenticated;
create policy "reports_select_own" on public.listing_reports for select to authenticated using (reporter_id = auth.uid());
create policy "reports_insert_own" on public.listing_reports for insert to authenticated with check (reporter_id = auth.uid());

grant select on public.notifications to authenticated;
grant update (read_at) on public.notifications to authenticated;
create policy "notif_select_own" on public.notifications for select to authenticated using (user_id = auth.uid());
create policy "notif_update_own" on public.notifications for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

-- Listing photos: public read, writes only inside your own folder.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('listing-images', 'listing-images', true, 3145728, array['image/jpeg','image/png','image/webp'])
on conflict (id) do nothing;
create policy "listing_images_insert_own" on storage.objects for insert to authenticated
  with check (bucket_id = 'listing-images' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "listing_images_delete_own" on storage.objects for delete to authenticated
  using (bucket_id = 'listing-images' and (storage.foldername(name))[1] = auth.uid()::text);
