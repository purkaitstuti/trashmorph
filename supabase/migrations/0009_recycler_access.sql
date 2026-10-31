-- Backfill recycler signups made before migration 0008 and add a safe profile upgrade path.
update public.profiles p
set role = 'recycler',
    recycler_organization = left(u.raw_user_meta_data->>'recycler_organization', 160),
    recycler_location = left(u.raw_user_meta_data->>'recycler_location', 200),
    recycler_contact = left(u.raw_user_meta_data->>'recycler_contact', 200)
from auth.users u
where u.id = p.id
  and u.raw_user_meta_data->>'account_type' = 'recycler'
  and coalesce(char_length(trim(u.raw_user_meta_data->>'recycler_organization')),0) >= 2
  and coalesce(char_length(trim(u.raw_user_meta_data->>'recycler_location')),0) >= 2
  and coalesce(char_length(trim(u.raw_user_meta_data->>'recycler_contact')),0) >= 5;

-- Household versus recycler authorship is assigned by the database, not the listing client.
alter table public.waste_listings add column seller_type text not null default 'household'
  check (seller_type in ('household','recycler'));
update public.waste_listings l set seller_type = case when p.role = 'recycler' then 'recycler' else 'household' end
from public.profiles p where p.id = l.owner_id;
create index waste_listings_seller_type_idx on public.waste_listings (seller_type, status, created_at desc);

create or replace function public.set_listing_seller_type() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  select case when p.role = 'recycler' then 'recycler' else 'household' end
  into new.seller_type from public.profiles p where p.id = new.owner_id;
  if new.seller_type is null then raise exception 'listing owner profile not found'; end if;
  return new;
end $$;
create trigger waste_listings_seller_type before insert or update of owner_id on public.waste_listings
for each row execute function public.set_listing_seller_type();

create or replace function public.activate_my_recycler_profile(p_organization text, p_location text, p_contact text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'sign in first'; end if;
  if p_organization is null or p_location is null or p_contact is null
     or char_length(trim(p_organization)) not between 2 and 160
     or char_length(trim(p_location)) not between 2 and 200
     or char_length(trim(p_contact)) not between 5 and 200 then
    raise exception 'organization name, location, and contact details are required';
  end if;
  update public.profiles
  set role = 'recycler', recycler_organization = trim(p_organization),
      recycler_location = trim(p_location), recycler_contact = trim(p_contact)
  where id = auth.uid() and role in ('user','recycler');
  if not found then raise exception 'this profile cannot be changed to a recycler account'; end if;
  update public.waste_listings set seller_type = 'recycler' where owner_id = auth.uid();
end $$;
revoke all on function public.activate_my_recycler_profile(text,text,text) from public, anon;
grant execute on function public.activate_my_recycler_profile(text,text,text) to authenticated;

create or replace function public.current_user_is_recycler() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'recycler')
$$;
revoke all on function public.current_user_is_recycler() from public;
grant execute on function public.current_user_is_recycler() to anon, authenticated;

drop policy if exists "listings_read" on public.waste_listings;
create policy "listings_read" on public.waste_listings for select to anon, authenticated using (
  (status = 'active' and (
    not public.current_user_is_recycler()
    or seller_type = 'household'
  )) or owner_id = auth.uid()
);

-- Bypass nested table RLS only after independently checking the signed-in recycler role.
create or replace function public.household_waste_available_cycles(p_limit integer default 20, p_offset integer default 0)
returns table (id uuid, household_id uuid, location_label text, started_at timestamptz, expires_at timestamptz, logs jsonb, total_count bigint)
language plpgsql stable security definer set search_path = public as $$
begin
  if auth.uid() is null or not exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'recycler') then
    raise exception 'recycler account required';
  end if;
  if p_limit < 1 or p_limit > 50 or p_offset < 0 then raise exception 'invalid page'; end if;
  return query
  with active_cycles as (
    select c.id, c.household_id, c.location_label, c.started_at, c.expires_at
    from public.household_waste_cycles c where c.expires_at > now()
  ), selected_cycles as (
    select c.*, count(*) over() as n from active_cycles c order by c.started_at asc limit p_limit offset p_offset
  )
  select p.id, p.household_id, p.location_label, p.started_at, p.expires_at,
    coalesce((select jsonb_agg(jsonb_build_object(
      'id', d.id, 'logged_on', d.logged_on, 'biodegradable_items', d.biodegradable_items,
      'non_biodegradable_items', d.non_biodegradable_items, 'created_at', d.created_at, 'updated_at', d.updated_at
    ) order by d.logged_on) from public.household_waste_daily_logs d where d.cycle_id = p.id), '[]'::jsonb),
    p.n
  from selected_cycles p order by p.started_at asc;
end $$;
revoke all on function public.household_waste_available_cycles(integer,integer) from public, anon;
grant execute on function public.household_waste_available_cycles(integer,integer) to authenticated;

notify pgrst, 'reload schema';
