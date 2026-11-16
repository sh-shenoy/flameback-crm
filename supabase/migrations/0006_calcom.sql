-- Flameback CRM · 0006: switch scheduling from Calendly to Cal.com
--
--  * meetings: one table for booked meetings, whatever tool booked them (existing Calendly bookings copied in).
--  * calcom_connections: each RM's Cal.com API key + webhook secret (server-side only).
--  * apply_booking / apply_booking_cancel: same rules as before —
--      match the lead by hidden lead id, then email, then phone;
--      existing lead → Awaiting meeting with the time and video link (owner unchanged, strikes reset);
--      someone new → that RM's lead, source "Cal.com";
--      cancellation → meeting cleared, follow-up today; reschedule = new booking + old one closed quietly.
-- The Calendly tables and functions stay in place (unused) so nothing breaks while the switch happens.

insert into public.lead_sources (name, kind, sort_order) values ('Cal.com', 'warm', 14)
on conflict (name) do nothing;

alter table public.profiles add column if not exists cal_url text;
alter table public.profiles add column if not exists cal_connected_at timestamptz;

create table public.calcom_connections (            -- server-side only
  user_id         uuid primary key references public.profiles(id) on delete cascade,
  calcom_user_id  bigint,
  username        text,
  booking_url     text,
  api_key         text not null,
  webhook_id      text,
  webhook_secret  text not null,
  connected_at    timestamptz not null default now()
);
alter table public.calcom_connections enable row level security;
revoke all on public.calcom_connections from anon, authenticated;

create table public.meetings (
  booking_uid text primary key,
  provider    text not null check (provider in ('calendly','calcom')),
  rm_id       uuid not null references public.profiles(id),
  lead_id     uuid references public.leads(id) on delete set null,
  name        text,
  email       text,
  phone       text,
  event_name  text,
  start_time  timestamptz not null,
  end_time    timestamptz,
  join_url    text,
  status      text not null default 'active' check (status in ('active','canceled')),
  created_at  timestamptz not null default now(),
  canceled_at timestamptz
);
create index meetings_lead_idx on public.meetings (lead_id);
create index meetings_rm_start_idx on public.meetings (rm_id, start_time);
alter table public.meetings enable row level security;
create policy meetings_read on public.meetings for select to authenticated
  using (public.is_admin() or rm_id = auth.uid() or (lead_id is not null and public.can_access_lead(lead_id)));
revoke insert, update, delete on public.meetings from anon, authenticated;

-- keep existing Calendly bookings visible on the calendar and lead pages
insert into public.meetings (booking_uid, provider, rm_id, lead_id, name, email, phone, event_name, start_time, end_time, join_url, status, created_at, canceled_at)
select invitee_uri, 'calendly', rm_id, lead_id, name, email, phone, event_name, start_time, end_time, join_url, status, created_at, canceled_at
  from public.calendly_events
on conflict (booking_uid) do nothing;

-- Called by the calcom-webhook edge function (service role only).
-- p: booking_uid, provider, name, email, phone, event_name, start_time, end_time, join_url, lead_id, product
create or replace function public.apply_booking(p_rm uuid, p jsonb)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  l public.leads; v_lead uuid; v_phone text := public.normalize_phone(p->>'phone');
  v_email text := public.normalize_email(p->>'email'); v_start timestamptz := (p->>'start_time')::timestamptz;
  v_when text; v_provider text := coalesce(p->>'provider','calcom');
  v_source text := case when coalesce(p->>'provider','calcom') = 'calendly' then 'Calendly' else 'Cal.com' end;
begin
  if exists (select 1 from public.meetings where booking_uid = p->>'booking_uid') then
    return (select lead_id from public.meetings where booking_uid = p->>'booking_uid');
  end if;
  v_when := to_char(v_start at time zone 'Asia/Kolkata', 'DD Mon YYYY, HH12:MI am');

  if nullif(p->>'lead_id','') is not null and (p->>'lead_id') ~ '^[0-9a-f-]{36}$' then
    select * into l from public.leads where id = (p->>'lead_id')::uuid;
  end if;
  if l.id is null and v_email is not null then select * into l from public.leads where unit = 'IQWM' and email = v_email; end if;
  if l.id is null and v_phone is not null then select * into l from public.leads where unit = 'IQWM' and phone = v_phone; end if;

  if l.id is not null then
    v_lead := l.id;
    if l.bucket in ('active_contact','holding','deferred','out') then
      perform public._move(v_lead, 'awaiting_meeting', 'Booked via ' || v_source);
    end if;
    if l.bucket <> 'converting' then
      update public.leads set meeting_at = v_start, meeting_url = nullif(p->>'join_url',''),
             next_follow_up = (v_start at time zone 'Asia/Kolkata')::date,
             email = coalesce(email, v_email), phone = coalesce(phone, v_phone), updated_at = now()
       where id = v_lead;
    end if;
  else
    insert into public.leads (unit, name, phone, email, product, source, bucket, meeting_at, meeting_url,
                              next_follow_up, rm_id, created_by)
    values ('IQWM', coalesce(nullif(btrim(p->>'name'),''), v_email, 'Booking'), v_phone, v_email,
            coalesce(public.normalize_product(p->>'product'), 'RIA'),
            v_source, 'awaiting_meeting', v_start, nullif(p->>'join_url',''),
            (v_start at time zone 'Asia/Kolkata')::date, p_rm, p_rm)
    returning id into v_lead;
    insert into public.lead_events (lead_id, kind, detail, actor) values (v_lead, 'created', jsonb_build_object('via', v_provider), null);
    insert into public.lead_events (lead_id, kind, to_value, actor) values (v_lead, 'assigned', p_rm::text, null);
  end if;

  insert into public.lead_entries (lead_id, kind, notes, bucket_at, created_by)
  values (v_lead, 'note',
          'Meeting booked via ' || v_source || ' for ' || v_when || ' IST' || coalesce(' · ' || nullif(p->>'event_name',''), '')
            || coalesce(E'\nMeeting link: ' || nullif(p->>'join_url',''), ''),
          (select bucket from public.leads where id = v_lead), p_rm);

  insert into public.meetings (booking_uid, provider, rm_id, lead_id, name, email, phone, event_name, start_time, end_time, join_url)
  values (p->>'booking_uid', v_provider, p_rm, v_lead, p->>'name', v_email, v_phone, p->>'event_name',
          v_start, nullif(p->>'end_time','')::timestamptz, nullif(p->>'join_url',''));

  perform public.notify(p_rm, 'meeting_booked', 'Meeting booked: ' || (select name from public.leads where id = v_lead),
    v_when || ' IST' || coalesce(' · ' || nullif(p->>'event_name',''), ''), '/leads/' || v_lead, 'book:' || (p->>'booking_uid'));
  if (select rm_id from public.leads where id = v_lead) <> p_rm then
    perform public.notify((select rm_id from public.leads where id = v_lead), 'meeting_booked',
      'Meeting booked: ' || (select name from public.leads where id = v_lead),
      v_when || ' IST · with a colleague', '/leads/' || v_lead, 'book:' || (p->>'booking_uid'));
  end if;
  return v_lead;
end $$;

create or replace function public.apply_booking_cancel(p_uid text, p_rescheduled boolean, p_reason text default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare m public.meetings; l public.leads;
begin
  select * into m from public.meetings where booking_uid = p_uid;
  if not found or m.status = 'canceled' then return null; end if;
  update public.meetings set status = 'canceled', canceled_at = now() where booking_uid = p_uid;
  if m.lead_id is null then return null; end if;
  select * into l from public.leads where id = m.lead_id;
  insert into public.lead_entries (lead_id, kind, notes, bucket_at, created_by)
  values (m.lead_id, 'note',
          case when p_rescheduled then 'Meeting rescheduled (the new time is on the next booking)'
               else 'Meeting cancelled' || coalesce(' · ' || nullif(btrim(p_reason),''), '') end,
          l.bucket, m.rm_id);
  if not p_rescheduled then
    perform public.notify(l.rm_id, 'meeting_canceled', 'Meeting cancelled: ' || l.name,
      coalesce(nullif(btrim(p_reason),''), 'Cancelled by the client or in the calendar'), '/leads/' || l.id, 'cancel:' || p_uid);
  end if;
  -- only clear the meeting if it is still this booking's time (a reschedule may already have set a new one)
  if not p_rescheduled and l.bucket = 'awaiting_meeting' and l.meeting_at = m.start_time then
    update public.leads set meeting_at = null, meeting_url = null, next_follow_up = public.ist_today(), updated_at = now()
     where id = m.lead_id;
  end if;
  return m.lead_id;
end $$;

-- bookings create their own "meeting booked" notification, so don't also say "new lead"
create or replace function public._notify_lead_assigned()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if coalesce(current_setting('crm.bulk_reassign', true), 'off') = 'on' then return new; end if;
  if tg_op = 'INSERT' then
    if new.import_batch_id is null and new.source not in ('Calendly', 'Cal.com') then
      perform public.notify(new.rm_id, 'lead_assigned', 'New lead: ' || new.name,
        new.source || coalesce(' · ' || new.campaign, '') || ' · ' || new.product, '/leads/' || new.id);
    end if;
  elsif new.rm_id is distinct from old.rm_id then
    perform public.notify(new.rm_id, 'lead_assigned', 'Lead assigned to you: ' || new.name,
      'Reassigned by an admin', '/leads/' || new.id);
  end if;
  return new;
end $$;

revoke execute on function public.apply_booking(uuid, jsonb), public.apply_booking_cancel(text, boolean, text)
  from anon, authenticated, public;
grant execute on function public.apply_booking(uuid, jsonb), public.apply_booking_cancel(text, boolean, text)
  to service_role;
