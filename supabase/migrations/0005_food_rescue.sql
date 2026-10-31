-- TRASHMORPH Stage 5: Food Rescue directory, donations and donor-reported outcomes.
-- The directory intentionally starts empty. Add only organizations whose details have been checked.

create table public.food_rescue_organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 2 and 160),
  organization_type text not null check (organization_type in ('food_bank','community_kitchen','shelter','ngo','other')),
  address text not null check (char_length(address) between 2 and 300),
  latitude double precision not null check (latitude between -90 and 90),
  longitude double precision not null check (longitude between -180 and 180),
  contact_number text check (char_length(contact_number) <= 80),
  website text check (char_length(website) <= 300),
  operating_hours text check (char_length(operating_hours) <= 500),
  donation_requirements text check (char_length(donation_requirements) <= 1000),
  verification_status text not null default 'verified' check (verification_status in ('verified','needs_review','inactive')),
  source_note text check (char_length(source_note) <= 500),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index food_rescue_orgs_geo_idx on public.food_rescue_organizations (latitude, longitude);
create index food_rescue_orgs_status_idx on public.food_rescue_organizations (verification_status);
create trigger food_rescue_orgs_updated before update on public.food_rescue_organizations for each row execute function public.set_updated_at();
alter table public.food_rescue_organizations enable row level security;
revoke all on public.food_rescue_organizations from anon, authenticated;
grant select on public.food_rescue_organizations to anon, authenticated;
create policy "food_orgs_read_reviewed" on public.food_rescue_organizations for select to anon, authenticated using (verification_status = 'verified');
-- Directory curation is platform-managed in the Supabase SQL editor; users cannot add or edit entries.

create table public.food_donations (
  id uuid primary key default gen_random_uuid(),
  donor_id uuid not null references auth.users(id) on delete cascade,
  donor_type text not null check (donor_type in ('individual','organization')),
  donor_organization_name text check (char_length(donor_organization_name) <= 160),
  title text not null check (char_length(title) between 3 and 120),
  food_category text not null check (food_category in ('prepared_meal','bakery','produce','dairy','packaged','other')),
  description text check (char_length(description) <= 1500),
  quantity numeric not null check (quantity > 0 and quantity <= 1000000),
  unit text not null check (unit in ('kg','g','servings','boxes','bags','items','litres')),
  prepared_at timestamptz not null,
  storage_conditions text not null check (char_length(storage_conditions) between 2 and 500),
  allergens text[] not null default '{}',
  pickup_deadline timestamptz not null,
  location_label text not null check (char_length(location_label) between 2 and 120),
  -- These coordinates are rounded by the API before storage and are the only coordinates ever published.
  latitude double precision not null check (latitude between -90 and 90),
  longitude double precision not null check (longitude between -180 and 180),
  photo_url text check (char_length(photo_url) <= 500),
  status text not null default 'available' check (status in ('available','donated','expired','cancelled')),
  organization_id uuid references public.food_rescue_organizations(id) on delete set null,
  reported_quantity numeric check (reported_quantity > 0),
  donated_at date,
  verification text not null default 'not_verified' check (verification in ('not_verified','donor_reported','independently_verified')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (pickup_deadline > prepared_at),
  check ((donor_type = 'organization' and nullif(btrim(donor_organization_name),'') is not null) or donor_type = 'individual'),
  check (reported_quantity is null or reported_quantity <= quantity),
  check ((status = 'donated' and verification = 'donor_reported' and reported_quantity is not null and donated_at is not null)
      or (status <> 'donated' and verification = 'not_verified' and reported_quantity is null and donated_at is null and organization_id is null))
);
create index food_donations_status_deadline_idx on public.food_donations (status, pickup_deadline);
create index food_donations_donor_idx on public.food_donations (donor_id, created_at desc);
create index food_donations_geo_idx on public.food_donations (latitude, longitude);
create trigger food_donations_updated before update on public.food_donations for each row execute function public.set_updated_at();

create or replace function public.guard_food_donation_update() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.donor_id <> old.donor_id then raise exception 'donor cannot be changed'; end if;
  if old.status <> 'available' and new.status <> old.status then raise exception 'terminal donation status cannot be changed'; end if;
  if new.status = 'donated' and (new.verification <> 'donor_reported' or new.reported_quantity is null or new.donated_at is null) then
    raise exception 'donation outcome must be donor-reported with quantity and date';
  end if;
  if new.status <> 'donated' then
    new.organization_id := null; new.reported_quantity := null; new.donated_at := null; new.verification := 'not_verified';
  end if;
  return new;
end $$;
create trigger food_donations_guard before update on public.food_donations for each row execute function public.guard_food_donation_update();

create or replace function public.validate_food_donation() returns trigger language plpgsql set search_path = public as $$
begin
  if new.prepared_at > now() then raise exception 'preparation time cannot be in the future'; end if;
  if new.pickup_deadline <= now() then raise exception 'pickup deadline must be in the future'; end if;
  if new.location_label ~ '[0-9#]' or new.location_label ~* '\m(house|flat|apartment|street|road|lane|building|floor|unit|door)\M' then
    raise exception 'use an approximate neighborhood, not a street address';
  end if;
  -- Enforce coarse public coordinates even for writes that bypass the application API.
  new.latitude := round(new.latitude::numeric, 2)::double precision;
  new.longitude := round(new.longitude::numeric, 2)::double precision;
  return new;
end $$;
create trigger food_donations_validate before insert or update of prepared_at,pickup_deadline,latitude,longitude,location_label on public.food_donations for each row execute function public.validate_food_donation();

create or replace function public.record_food_donation_outcome(p_donation uuid, p_status text, p_organization uuid, p_quantity numeric, p_donated_at date)
returns public.food_donations language plpgsql security definer set search_path = public as $$
declare row public.food_donations;
begin
  if auth.uid() is null then raise exception 'authentication required'; end if;
  if p_status not in ('donated','cancelled') then raise exception 'invalid donation outcome'; end if;
  update public.food_donations set status = p_status,
    organization_id = case when p_status = 'donated' then p_organization else null end,
    reported_quantity = case when p_status = 'donated' then p_quantity else null end,
    donated_at = case when p_status = 'donated' then p_donated_at else null end,
    verification = case when p_status = 'donated' then 'donor_reported' else 'not_verified' end
  where id = p_donation and donor_id = auth.uid() and status = 'available' and pickup_deadline > now()
  returning * into row;
  if not found then raise exception 'donation is unavailable or expired'; end if;
  return row;
end $$;
revoke execute on function public.record_food_donation_outcome(uuid,text,uuid,numeric,date) from public, anon;
grant execute on function public.record_food_donation_outcome(uuid,text,uuid,numeric,date) to authenticated;

alter table public.food_donations enable row level security;
revoke all on public.food_donations from anon, authenticated;
grant select on public.food_donations to anon, authenticated;
grant insert (donor_id,donor_type,donor_organization_name,title,food_category,description,quantity,unit,prepared_at,storage_conditions,allergens,pickup_deadline,location_label,latitude,longitude,photo_url,status,verification) on public.food_donations to authenticated;
grant update (donor_type,donor_organization_name,title,food_category,description,quantity,unit,prepared_at,storage_conditions,allergens,pickup_deadline,location_label,latitude,longitude,photo_url) on public.food_donations to authenticated;
grant delete on public.food_donations to authenticated;
create policy "food_donations_public_active" on public.food_donations for select to anon, authenticated using (status = 'available' and pickup_deadline > now() or donor_id = auth.uid());
create policy "food_donations_insert_own" on public.food_donations for insert to authenticated with check (donor_id = auth.uid() and status = 'available' and verification = 'not_verified');
create policy "food_donations_update_own" on public.food_donations for update to authenticated using (donor_id = auth.uid()) with check (donor_id = auth.uid());
create policy "food_donations_delete_own" on public.food_donations for delete to authenticated using (donor_id = auth.uid() and status in ('available','cancelled','expired'));

-- Anonymous callers see only currently available fields. Donor IDs and outcome metadata are omitted.
create view public.food_donations_public with (security_barrier = true) as
  select id,title,food_category,description,quantity,unit,prepared_at,storage_conditions,allergens,pickup_deadline,
    location_label,latitude,longitude,photo_url,status,reported_quantity,donated_at,verification,created_at,updated_at
  from public.food_donations where status = 'available' and pickup_deadline > now();
revoke all on public.food_donations_public from public;
grant select on public.food_donations_public to anon, authenticated;
revoke select on public.food_donations from anon;

-- Expiration is committed when the donor next views their listings or dashboard.
create or replace function public.expire_my_food_donations() returns void language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'authentication required'; end if;
  update public.food_donations set status = 'expired'
  where donor_id = auth.uid() and status = 'available' and pickup_deadline <= now();
end $$;
revoke execute on function public.expire_my_food_donations() from public, anon;
grant execute on function public.expire_my_food_donations() to authenticated;

-- Dashboard aggregation runs in PostgreSQL, so totals cover every record rather than a page cap.
create or replace function public.my_food_rescue_dashboard(p_date_from date default null, p_date_to date default null)
returns jsonb language sql stable security invoker set search_path = public as $$
  with mine as (
    select * from public.food_donations
    where donor_id = auth.uid()
      and (p_date_from is null or created_at >= p_date_from::timestamptz)
      and (p_date_to is null or created_at < (p_date_to + 1)::timestamptz)
  ),
  cats as (select food_category, count(*)::int as count from mine where status = 'donated' group by food_category order by count(*) desc, food_category),
  activity as (
    select event_date, event_type, count(*)::int as count from (
      select created_at::date as event_date, 'listed'::text as event_type from mine
      union all
      select donated_at as event_date, 'donated'::text as event_type from mine where status = 'donated'
    ) events group by event_date, event_type order by event_date
  )
  select jsonb_build_object(
    'total_listed', count(*),
    'reported_donated', count(*) filter (where status = 'donated'),
    'reported_quantity', coalesce(sum(reported_quantity) filter (where status = 'donated'), 0),
    'status_counts', jsonb_build_object(
      'available', count(*) filter (where status = 'available'),
      'donated', count(*) filter (where status = 'donated'),
      'expired', count(*) filter (where status = 'expired'),
      'cancelled', count(*) filter (where status = 'cancelled')),
    'by_category', coalesce((select jsonb_agg(jsonb_build_object('category', food_category, 'count', count)) from cats), '[]'::jsonb),
    'activity', coalesce((select jsonb_agg(jsonb_build_object('date', event_date, 'type', event_type, 'count', count)) from activity), '[]'::jsonb),
    'verification_note', 'Donation outcomes are donor-reported and have not been independently verified.'
  ) from mine
$$;
revoke execute on function public.my_food_rescue_dashboard(date,date) from public, anon;
grant execute on function public.my_food_rescue_dashboard(date,date) to authenticated;

create table public.food_donation_reports (
  id uuid primary key default gen_random_uuid(),
  donation_id uuid not null references public.food_donations(id) on delete cascade,
  reporter_id uuid not null references auth.users(id) on delete cascade,
  reason text not null check (reason in ('unsafe_food','misleading','other')),
  details text check (char_length(details) <= 1000),
  created_at timestamptz not null default now(),
  unique (donation_id, reporter_id)
);
alter table public.food_donation_reports enable row level security;
revoke all on public.food_donation_reports from anon, authenticated;
grant insert (donation_id,reporter_id,reason,details) on public.food_donation_reports to authenticated;
create policy "food_reports_insert_other_active" on public.food_donation_reports for insert to authenticated with check (
  reporter_id = auth.uid() and exists (select 1 from public.food_donations d where d.id = donation_id and d.status = 'available' and d.donor_id <> auth.uid()));

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('food-rescue-images','food-rescue-images',true,3145728,array['image/jpeg','image/png','image/webp']) on conflict (id) do nothing;
create policy "food_rescue_images_insert_own" on storage.objects for insert to authenticated with check (bucket_id = 'food-rescue-images' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "food_rescue_images_delete_own" on storage.objects for delete to authenticated using (bucket_id = 'food-rescue-images' and (storage.foldername(name))[1] = auth.uid()::text);

-- A donor-reported handover earns 10 points at most once per donation, controlled by the database.
alter table public.greenscore_transactions drop constraint greenscore_transactions_activity_type_check;
alter table public.greenscore_transactions add constraint greenscore_transactions_activity_type_check
  check (activity_type in ('listing_published','collection_collected','collection_handed_over','food_donation_reported'));
create or replace function public.award_food_donation_points() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.status = 'donated' and old.status = 'available' then
    perform public.award_points(new.donor_id,10,'food_donation_reported',new.id,'Reported a food donation','user_reported',3);
  end if;
  return new;
end $$;
create trigger food_donation_points after update of status on public.food_donations for each row execute function public.award_food_donation_points();

notify pgrst, 'reload schema';
