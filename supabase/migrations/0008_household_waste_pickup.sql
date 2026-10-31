-- Household Waste Pickup: private daily logs visible only to the household and recyclers.
alter table public.profiles drop constraint if exists profiles_role_check;
alter table public.profiles add constraint profiles_role_check check (role in ('user','recycler','admin'));
alter table public.profiles add column recycler_organization text check (char_length(recycler_organization) <= 160);
alter table public.profiles add column recycler_location text check (char_length(recycler_location) <= 200);
alter table public.profiles add column recycler_contact text check (char_length(recycler_contact) <= 200);
alter table public.profiles add constraint recycler_profile_details_required check (
  role <> 'recycler' or (coalesce(char_length(trim(recycler_organization)),0) >= 2 and coalesce(char_length(trim(recycler_location)),0) >= 2 and coalesce(char_length(trim(recycler_contact)),0) >= 5));
grant update (recycler_organization, recycler_location, recycler_contact) on public.profiles to authenticated;

create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
declare r text := case when new.raw_user_meta_data->>'account_type' = 'recycler' then 'recycler' else 'user' end;
begin
  insert into public.profiles (id, full_name, role, recycler_organization, recycler_location, recycler_contact)
  values (
    new.id,
    left(coalesce(new.raw_user_meta_data->>'full_name', new.raw_user_meta_data->>'name'), 100),
    r,
    case when r = 'recycler' then left(new.raw_user_meta_data->>'recycler_organization', 160) end,
    case when r = 'recycler' then left(new.raw_user_meta_data->>'recycler_location', 200) end,
    case when r = 'recycler' then left(new.raw_user_meta_data->>'recycler_contact', 200) end
  );
  insert into public.user_settings (user_id) values (new.id);
  return new;
end $$;

create table public.household_waste_cycles (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references auth.users(id) on delete cascade,
  location_label text not null check (char_length(location_label) between 2 and 200),
  started_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '35 days'),
  created_at timestamptz not null default now(),
  check (expires_at > started_at)
);
create index household_waste_cycles_expiry_idx on public.household_waste_cycles (expires_at);
create index household_waste_cycles_household_idx on public.household_waste_cycles (household_id, started_at desc);
alter table public.household_waste_cycles enable row level security;
revoke all on public.household_waste_cycles from anon, authenticated;
grant select, insert (household_id,location_label) on public.household_waste_cycles to authenticated;
create policy "household_waste_cycles_visible_to_owner_and_recyclers" on public.household_waste_cycles for select to authenticated using (
  household_id = auth.uid() or exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'recycler'));
create policy "household_waste_cycles_create_own" on public.household_waste_cycles for insert to authenticated with check (household_id = auth.uid());

create table public.household_waste_daily_logs (
  id uuid primary key default gen_random_uuid(),
  cycle_id uuid not null references public.household_waste_cycles(id) on delete cascade,
  logged_on date not null default current_date,
  biodegradable_items text[] not null default '{}',
  non_biodegradable_items text[] not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (cycle_id, logged_on),
  check (cardinality(biodegradable_items) <= 30 and cardinality(non_biodegradable_items) <= 30)
);
create index household_waste_logs_cycle_idx on public.household_waste_daily_logs (cycle_id, logged_on);
create trigger household_waste_logs_updated before update on public.household_waste_daily_logs for each row execute function public.set_updated_at();
alter table public.household_waste_daily_logs enable row level security;
revoke all on public.household_waste_daily_logs from anon, authenticated;
grant select, insert (cycle_id,logged_on,biodegradable_items,non_biodegradable_items), update (biodegradable_items,non_biodegradable_items) on public.household_waste_daily_logs to authenticated;
create policy "household_waste_logs_visible_to_owner_and_recyclers" on public.household_waste_daily_logs for select to authenticated using (
  exists (select 1 from public.household_waste_cycles c where c.id = cycle_id and
    (c.household_id = auth.uid() or exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'recycler'))));
create policy "household_waste_logs_write_own" on public.household_waste_daily_logs for all to authenticated using (
  exists (select 1 from public.household_waste_cycles c where c.id = cycle_id and c.household_id = auth.uid())) with check (
  exists (select 1 from public.household_waste_cycles c where c.id = cycle_id and c.household_id = auth.uid()));

create table public.household_waste_pickup_requests (
  id uuid primary key default gen_random_uuid(),
  cycle_id uuid not null references public.household_waste_cycles(id) on delete cascade,
  household_id uuid not null references auth.users(id) on delete cascade,
  recycler_id uuid not null references auth.users(id) on delete cascade,
  message text check (char_length(message) <= 500),
  status text not null default 'requested' check (status in ('requested','accepted','declined','completed','cancelled')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (household_id <> recycler_id)
);
create unique index household_waste_pickup_one_open on public.household_waste_pickup_requests (cycle_id, recycler_id) where status in ('requested','accepted');
create unique index household_waste_one_accepted_per_cycle on public.household_waste_pickup_requests (cycle_id) where status = 'accepted';
create index household_waste_pickups_household_idx on public.household_waste_pickup_requests (household_id, created_at desc);
create index household_waste_pickups_recycler_idx on public.household_waste_pickup_requests (recycler_id, created_at desc);
create trigger household_waste_pickups_updated before update on public.household_waste_pickup_requests for each row execute function public.set_updated_at();
alter table public.household_waste_pickup_requests enable row level security;
revoke all on public.household_waste_pickup_requests from anon, authenticated;
grant select, insert (cycle_id,household_id,recycler_id,message), update (status) on public.household_waste_pickup_requests to authenticated;
create policy "household_waste_pickups_participants_read" on public.household_waste_pickup_requests for select to authenticated using (auth.uid() in (household_id,recycler_id));
create policy "household_waste_pickups_recycler_request" on public.household_waste_pickup_requests for insert to authenticated with check (
  recycler_id = auth.uid() and exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'recycler') and
  exists (select 1 from public.household_waste_cycles c where c.id = cycle_id and c.household_id = household_id and c.expires_at > now()));
create policy "household_waste_pickups_participant_update" on public.household_waste_pickup_requests for update to authenticated using (
  auth.uid() in (household_id,recycler_id)) with check (auth.uid() in (household_id,recycler_id));

create or replace function public.validate_household_waste_pickup_update() returns trigger
language plpgsql security invoker set search_path = public as $$
declare r text;
begin
  select role into r from public.profiles where id = auth.uid();
  if new.cycle_id <> old.cycle_id or new.household_id <> old.household_id or new.recycler_id <> old.recycler_id then
    raise exception 'pickup request participants cannot be changed';
  end if;
  if old.status = 'requested' and new.status in ('accepted','declined') and auth.uid() = old.household_id then return new; end if;
  if old.status = 'requested' and new.status = 'cancelled' and auth.uid() = old.recycler_id and r = 'recycler' then return new; end if;
  if old.status = 'accepted' and new.status = 'cancelled' and auth.uid() = old.household_id then return new; end if;
  if old.status = 'accepted' and new.status = 'completed' and auth.uid() = old.recycler_id and r = 'recycler' then return new; end if;
  raise exception 'pickup request status change is not allowed';
end $$;
create trigger household_waste_pickup_validate_update before update on public.household_waste_pickup_requests for each row execute function public.validate_household_waste_pickup_update();

create or replace function public.notify_household_waste_pickup_status() returns trigger
language plpgsql security definer set search_path = public as $$
declare target uuid;
begin
  if new.status = old.status then return new; end if;
  target := case when auth.uid() = new.household_id then new.recycler_id else new.household_id end;
  perform public.create_notification(target, 'Household pickup updated', 'A household waste pickup request is now ' || replace(new.status, '_', ' ') || '.', 'household_waste_pickup', new.id);
  return new;
end $$;
create trigger household_waste_pickup_status_notify after update on public.household_waste_pickup_requests for each row execute function public.notify_household_waste_pickup_status();

create or replace function public.household_waste_my_recycler_contacts()
returns table (id uuid, full_name text, recycler_organization text, recycler_location text, recycler_contact text)
language sql stable security definer set search_path = public as $$
  select p.id, p.full_name, p.recycler_organization, p.recycler_location,
    case when r.status in ('accepted','completed') then p.recycler_contact else null end
  from public.household_waste_pickup_requests r
  join public.profiles p on p.id = r.recycler_id
  where r.household_id = auth.uid()
$$;
revoke all on function public.household_waste_my_recycler_contacts() from public, anon;
grant execute on function public.household_waste_my_recycler_contacts() to authenticated;

create or replace function public.notify_household_waste_pickup() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform public.create_notification(new.household_id, 'Household waste pickup request', 'A recycler has requested to collect your logged household waste.', 'household_waste_pickup', new.id);
  return new;
end $$;
create trigger household_waste_pickup_notify after insert on public.household_waste_pickup_requests for each row execute function public.notify_household_waste_pickup();

-- Scheduled retention: a cycle and all its daily item records/requests are removed after day 35.
create extension if not exists pg_cron;
select cron.schedule('trashmorph-household-waste-retention', '17 * * * *', $$delete from public.household_waste_cycles where expires_at <= now()$$)
where not exists (select 1 from cron.job where jobname = 'trashmorph-household-waste-retention');

notify pgrst, 'reload schema';
