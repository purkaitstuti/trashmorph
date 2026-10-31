-- Marketplace inquiry conversations and notifications that point to the exact inquiry.
create table public.marketplace_inquiry_replies (
  id uuid primary key default gen_random_uuid(),
  inquiry_id uuid not null references public.marketplace_inquiries(id) on delete cascade,
  sender_id uuid not null references auth.users(id) on delete cascade,
  recipient_id uuid not null references auth.users(id) on delete cascade,
  message text not null check (char_length(message) between 1 and 2000),
  created_at timestamptz not null default now(),
  check (sender_id <> recipient_id)
);
create index inquiry_replies_thread_idx on public.marketplace_inquiry_replies (inquiry_id, created_at);
alter table public.marketplace_inquiry_replies enable row level security;
revoke all on public.marketplace_inquiry_replies from anon, authenticated;
grant select, insert (inquiry_id,sender_id,recipient_id,message) on public.marketplace_inquiry_replies to authenticated;
create policy "inquiry_replies_select_parties" on public.marketplace_inquiry_replies for select to authenticated using (
  exists (select 1 from public.marketplace_inquiries i where i.id = inquiry_id and (i.sender_id = auth.uid() or i.recipient_id = auth.uid())));
create policy "inquiry_replies_insert_parties" on public.marketplace_inquiry_replies for insert to authenticated with check (
  sender_id = auth.uid() and exists (
    select 1 from public.marketplace_inquiries i where i.id = inquiry_id and
      ((i.sender_id = auth.uid() and recipient_id = i.recipient_id) or (i.recipient_id = auth.uid() and recipient_id = i.sender_id))));

create or replace function public.notify_new_inquiry() returns trigger
language plpgsql security definer set search_path = public as $$
declare t text;
begin
  select title into t from public.waste_listings where id = new.listing_id;
  perform public.create_notification(new.recipient_id, 'New inquiry', 'Someone asked about "' || coalesce(t, 'your listing') || '".', 'inquiry', new.id);
  return new;
end $$;

create or replace function public.notify_inquiry_reply() returns trigger
language plpgsql security definer set search_path = public as $$
declare t text;
begin
  select l.title into t from public.marketplace_inquiries i join public.waste_listings l on l.id = i.listing_id where i.id = new.inquiry_id;
  perform public.create_notification(new.recipient_id, 'New inquiry reply', 'Someone replied about "' || coalesce(t, 'a listing') || '".', 'inquiry_reply', new.inquiry_id);
  return new;
end $$;
create trigger inquiry_reply_notify after insert on public.marketplace_inquiry_replies for each row execute function public.notify_inquiry_reply();

-- Existing inquiry notifications referenced a listing. Point them at the matching inquiry where timestamps align.
update public.notifications n set reference_id = i.id
from public.marketplace_inquiries i
where n.notification_type = 'inquiry' and n.user_id = i.recipient_id and n.reference_id = i.listing_id and n.created_at = i.created_at;

notify pgrst, 'reload schema';
