-- TRASHMORPH Stage 3: recyclers, collection requests (with status history), GreenScore.

-- ───────────── Recyclers ─────────────
create table public.recyclers (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 2 and 120),
  description text check (char_length(description) <= 1000),
  accepted_materials text[] not null default '{}'
    check (accepted_materials <@ array['plastic','paper','cardboard','glass','metal','organic','electronic','textile','general','other']::text[]),
  recycler_type text not null check (recycler_type in ('recycling_center','scrap_dealer','ewaste_point','community_facility','composting','reuse_org')),
  latitude double precision not null check (latitude between -90 and 90),
  longitude double precision not null check (longitude between -180 and 180),
  address text check (char_length(address) <= 200),
  contact_information text check (char_length(contact_information) <= 200),
  source text not null default 'user_submitted' check (source in ('user_submitted','imported','admin')),
  verification_status text not null default 'pending' check (verification_status in ('pending','community','verified','rejected')),
  submitted_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index recyclers_status_idx on public.recyclers (verification_status);
create index recyclers_geo_idx on public.recyclers (latitude, longitude);
create trigger recyclers_updated before update on public.recyclers for each row execute function public.set_updated_at();

create or replace function public.limit_recycler_submissions() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if (select count(*) from public.recyclers where submitted_by = new.submitted_by and created_at > now() - interval '24 hours') >= 5 then
    raise exception 'daily recycler submission limit reached';
  end if;
  return new;
end $$;
create trigger recyclers_limit before insert on public.recyclers for each row execute function public.limit_recycler_submissions();

alter table public.recyclers enable row level security;
revoke all on public.recyclers from anon, authenticated;
grant select on public.recyclers to anon, authenticated;
grant insert (name, description, accepted_materials, recycler_type, latitude, longitude, address, contact_information, source, verification_status, submitted_by) on public.recyclers to authenticated;
-- Public sees only reviewed records. Submitters also see their own pending ones.
create policy "recyclers_read" on public.recyclers for select to anon, authenticated
  using (verification_status in ('verified','community') or submitted_by = auth.uid());
create policy "recyclers_suggest" on public.recyclers for insert to authenticated
  with check (submitted_by = auth.uid() and verification_status = 'pending' and source = 'user_submitted');
-- Review happens in the Supabase dashboard: update public.recyclers set verification_status = 'community' | 'verified' | 'rejected' where id = ...

-- ───────────── GreenScore ─────────────
create table public.greenscore_transactions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  points integer not null check (points > 0),
  activity_type text not null check (activity_type in ('listing_published','collection_collected','collection_handed_over')),
  reference_id uuid not null,
  description text not null,
  verification text not null check (verification in ('user_reported','counterparty_confirmed')),
  created_at timestamptz not null default now(),
  unique (user_id, activity_type, reference_id)   -- one award per event
);
create index greenscore_user_idx on public.greenscore_transactions (user_id, created_at desc);
alter table public.greenscore_transactions enable row level security;
revoke all on public.greenscore_transactions from anon, authenticated;
grant select on public.greenscore_transactions to authenticated;
create policy "score_select_own" on public.greenscore_transactions for select to authenticated using (user_id = auth.uid());
-- No insert/update/delete grants: only the SECURITY DEFINER functions below can award points.

create or replace function public.award_points(uid uuid, pts int, atype text, ref uuid, descr text, verif text, daily_cap int) returns void
language plpgsql security definer set search_path = public as $$
begin
  if (select count(*) from public.greenscore_transactions where user_id = uid and activity_type = atype and created_at > now() - interval '24 hours') >= daily_cap then
    return;
  end if;
  insert into public.greenscore_transactions (user_id, points, activity_type, reference_id, description, verification)
  values (uid, pts, atype, ref, descr, verif) on conflict (user_id, activity_type, reference_id) do nothing;
end $$;
revoke execute on function public.award_points(uuid, int, text, uuid, text, text, int) from public, anon, authenticated;

create or replace function public.award_listing_points() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.status = 'active' and (tg_op = 'INSERT' or old.status is distinct from 'active') then
    perform public.award_points(new.owner_id, 5, 'listing_published', new.id, 'Published a listing', 'user_reported', 3);
  end if;
  return new;
end $$;
create trigger listing_points after insert or update of status on public.waste_listings for each row execute function public.award_listing_points();

create or replace function public.my_greenscore() returns integer language sql stable security invoker as $$
  select coalesce(sum(points), 0)::int from public.greenscore_transactions where user_id = auth.uid()
$$;
create or replace function public.my_greenscore_breakdown() returns table (activity_type text, points bigint, events bigint)
language sql stable security invoker as $$
  select activity_type, sum(points)::bigint, count(*)::bigint from public.greenscore_transactions where user_id = auth.uid() group by activity_type
$$;
revoke execute on function public.my_greenscore(), public.my_greenscore_breakdown() from public, anon;
grant execute on function public.my_greenscore(), public.my_greenscore_breakdown() to authenticated;

-- ───────────── Collection requests ─────────────
create table public.collection_requests (
  id uuid primary key default gen_random_uuid(),
  requester_id uuid not null references auth.users(id) on delete cascade,
  owner_id uuid not null references auth.users(id) on delete cascade,
  listing_id uuid not null references public.waste_listings(id) on delete cascade,
  listing_title text not null,
  quantity numeric not null check (quantity > 0),
  requested_date date not null,
  time_window text not null default 'any' check (time_window in ('any','morning','afternoon','evening')),
  instructions text check (char_length(instructions) <= 500),
  status text not null default 'requested' check (status in ('requested','accepted','scheduled','in_progress','completed','cancelled','rejected')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (requester_id <> owner_id)
);
create unique index collection_one_open_per_listing on public.collection_requests (requester_id, listing_id)
  where status in ('requested','accepted','scheduled','in_progress');
create index collection_requester_idx on public.collection_requests (requester_id, created_at desc);
create index collection_owner_idx on public.collection_requests (owner_id, created_at desc);
create trigger collection_updated before update on public.collection_requests for each row execute function public.set_updated_at();

create table public.collection_status_history (
  id uuid primary key default gen_random_uuid(),
  collection_request_id uuid not null references public.collection_requests(id) on delete cascade,
  previous_status text,
  new_status text not null,
  changed_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);
create index collection_history_idx on public.collection_status_history (collection_request_id, created_at);

create or replace function public.prepare_collection_request() returns trigger language plpgsql security definer set search_path = public as $$
declare l public.waste_listings;
begin
  select * into l from public.waste_listings where id = new.listing_id;
  if not found or l.status <> 'active' then raise exception 'listing is not available for collection'; end if;
  if l.owner_id = new.requester_id then raise exception 'you cannot request collection of your own listing'; end if;
  if new.quantity > l.quantity then raise exception 'requested quantity exceeds the listing quantity'; end if;
  if new.requested_date < current_date or new.requested_date > current_date + 365 then raise exception 'requested date is out of range'; end if;
  new.owner_id := l.owner_id;
  new.listing_title := l.title;
  new.status := 'requested';
  return new;
end $$;
create trigger collection_prepare before insert on public.collection_requests for each row execute function public.prepare_collection_request();

create or replace function public.after_collection_request() returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.collection_status_history (collection_request_id, previous_status, new_status, changed_by) values (new.id, null, 'requested', new.requester_id);
  perform public.create_notification(new.owner_id, 'New collection request', 'Someone asked to collect "' || new.listing_title || '".', 'collection', new.id);
  return new;
end $$;
create trigger collection_after after insert on public.collection_requests for each row execute function public.after_collection_request();

-- The only way to change a request's status. Checks who may do what, updates the listing, writes history, notifies, awards points.
create or replace function public.change_collection_status(p_request uuid, p_status text) returns public.collection_requests
language plpgsql security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
  r public.collection_requests;
  l public.waste_listings;
  is_owner boolean; is_req boolean; allowed boolean; other uuid; prev text;
begin
  if uid is null then raise exception 'not authenticated'; end if;
  select * into r from public.collection_requests where id = p_request for update;
  if not found or (r.requester_id <> uid and r.owner_id <> uid) then raise exception 'request not found'; end if;
  prev := r.status;
  is_owner := r.owner_id = uid; is_req := r.requester_id = uid;
  allowed := case
    when r.status = 'requested'   and p_status in ('accepted','rejected') then is_owner
    when r.status = 'requested'   and p_status = 'cancelled' then is_req
    when r.status = 'accepted'    and p_status = 'scheduled' then is_owner
    when r.status = 'scheduled'   and p_status = 'in_progress' then is_owner
    when r.status = 'in_progress' and p_status = 'completed' then is_owner
    when r.status in ('accepted','scheduled','in_progress') and p_status = 'cancelled' then true
    else false end;
  if not allowed then raise exception 'that status change is not allowed'; end if;

  select * into l from public.waste_listings where id = r.listing_id for update;
  if p_status = 'accepted' then
    if l.status <> 'active' then raise exception 'the listing is no longer available'; end if;
    update public.waste_listings set status = 'reserved' where id = l.id;
  elsif p_status in ('cancelled','rejected') and r.status in ('accepted','scheduled','in_progress') and l.status = 'reserved' then
    update public.waste_listings set status = 'active' where id = l.id;
  elsif p_status = 'completed' then
    update public.waste_listings set status = 'collected' where id = l.id and status = 'reserved';
    update public.waste_listings set status = 'completed' where id = l.id and status = 'collected';
    perform public.award_points(r.requester_id, 20, 'collection_collected', r.id, 'Collected an item', 'counterparty_confirmed', 5);
    perform public.award_points(r.owner_id, 15, 'collection_handed_over', r.id, 'Handed over an item', 'counterparty_confirmed', 5);
  end if;

  update public.collection_requests set status = p_status where id = p_request returning * into r;
  insert into public.collection_status_history (collection_request_id, previous_status, new_status, changed_by)
    values (p_request, prev, p_status, uid);
  other := case when is_owner then r.requester_id else r.owner_id end;
  perform public.create_notification(other, 'Collection update', '"' || r.listing_title || '" is now ' || replace(p_status, '_', ' ') || '.', 'collection', r.id);
  return r;
end $$;
revoke execute on function public.change_collection_status(uuid, text) from public, anon;
grant execute on function public.change_collection_status(uuid, text) to authenticated;

alter table public.collection_requests enable row level security;
alter table public.collection_status_history enable row level security;
revoke all on public.collection_requests, public.collection_status_history from anon, authenticated;
grant select on public.collection_requests, public.collection_status_history to authenticated;
grant insert (requester_id, listing_id, quantity, requested_date, time_window, instructions) on public.collection_requests to authenticated;
create policy "collection_select_parties" on public.collection_requests for select to authenticated using (requester_id = auth.uid() or owner_id = auth.uid());
create policy "collection_insert_requester" on public.collection_requests for insert to authenticated with check (requester_id = auth.uid());
create policy "history_select_parties" on public.collection_status_history for select to authenticated using (
  exists (select 1 from public.collection_requests c where c.id = collection_request_id and (c.requester_id = auth.uid() or c.owner_id = auth.uid())));
