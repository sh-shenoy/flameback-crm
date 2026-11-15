-- Flameback CRM · Calendly
--
-- Each RM connects their own Calendly account (Settings → Connect my Calendly).
-- The calendly-connect edge function stores the connection here and asks Calendly
-- to notify calendly-webhook of that RM's bookings.
--
-- When a booking arrives:
--   * the lead is matched by the hidden lead id in the booking link, then by email, then by phone;
--   * an existing lead moves to Awaiting meeting with the meeting time (the owner does not change);
--   * someone new becomes a lead owned by the RM whose Calendly it was, source "Calendly";
--   * a cancellation clears the meeting time and sets a follow-up for today
--     (a reschedule simply arrives as a new booking).
-- Every booking is stored once (calendly_events), so repeated notifications are harmless.

insert into public.lead_sources (name, kind, sort_order) values ('Calendly', 'warm', 15)
on conflict (name) do nothing;

alter table public.profiles add column if not exists calendly_url text;
alter table public.profiles add column if not exists calendly_connected_at timestamptz;
alter table public.leads add column if not exists meeting_url text;

-- Secrets for each RM's connection. No policies: only the edge functions (service role) can read it.
create table public.calendly_connections (
  user_id           uuid primary key references public.profiles(id) on delete cascade,
  calendly_user_uri text not null,
  organization_uri  text not null,
  scheduling_url    text,
  webhook_uri       text,
  signing_key       text not null,
  access_token      text not null,
  connected_at      timestamptz not null default now()
);
alter table public.calendly_connections enable row level security;
revoke all on public.calendly_connections from anon, authenticated;

create table public.calendly_events (
  invitee_uri  text primary key,
  event_uri    text not null,
  rm_id        uuid not null references public.profiles(id),
  lead_id      uuid references public.leads(id) on delete set null,
  name         text,
  email        text,
  phone        text,
  event_name   text,
  start_time   timestamptz not null,
  end_time     timestamptz,
  join_url     text,
  status       text not null default 'active' check (status in ('active','canceled')),
  created_at   timestamptz not null default now(),
  canceled_at  timestamptz
);
create index calendly_events_lead_idx on public.calendly_events (lead_id);
alter table public.calendly_events enable row level security;
create policy calendly_events_read on public.calendly_events for select to authenticated
  using (public.is_admin() or rm_id = auth.uid() or (lead_id is not null and public.can_access_lead(lead_id)));
revoke insert, update, delete on public.calendly_events from anon, authenticated;

-- Called by the calendly-webhook edge function (service role only).
-- p: invitee_uri, event_uri, name, email, phone, event_name, start_time, end_time, join_url, lead_id, product
create or replace function public.apply_calendly_booking(p_rm uuid, p jsonb)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  l public.leads; v_lead uuid; v_phone text := public.normalize_phone(p->>'phone');
  v_email text := public.normalize_email(p->>'email'); v_start timestamptz := (p->>'start_time')::timestamptz;
  v_when text;
begin
  if exists (select 1 from public.calendly_events where invitee_uri = p->>'invitee_uri') then
    return (select lead_id from public.calendly_events where invitee_uri = p->>'invitee_uri');
  end if;
  v_when := to_char(v_start at time zone 'Asia/Kolkata', 'DD Mon YYYY, HH12:MI am');

  -- 1. hidden lead id from the CRM's booking link, 2. email, 3. phone
  if nullif(p->>'lead_id','') is not null and (p->>'lead_id') ~ '^[0-9a-f-]{36}$' then
    select * into l from public.leads where id = (p->>'lead_id')::uuid;
  end if;
  if l.id is null and v_email is not null then select * into l from public.leads where unit = 'IQWM' and email = v_email; end if;
  if l.id is null and v_phone is not null then select * into l from public.leads where unit = 'IQWM' and phone = v_phone; end if;

  if l.id is not null then
    v_lead := l.id;
    if l.bucket in ('active_contact','holding','deferred','out') then
      perform public._move(v_lead, 'awaiting_meeting', 'Booked via Calendly');
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
    values ('IQWM', coalesce(nullif(btrim(p->>'name'),''), v_email, 'Calendly booking'), v_phone, v_email,
            case when upper(coalesce(p->>'product','')) in ('RIA','PMS') then upper(p->>'product') else 'RIA' end,
            'Calendly', 'awaiting_meeting', v_start, nullif(p->>'join_url',''),
            (v_start at time zone 'Asia/Kolkata')::date, p_rm, p_rm)
    returning id into v_lead;
    insert into public.lead_events (lead_id, kind, detail, actor) values (v_lead, 'created', jsonb_build_object('via','calendly'), null);
    insert into public.lead_events (lead_id, kind, to_value, actor) values (v_lead, 'assigned', p_rm::text, null);
  end if;

  insert into public.lead_entries (lead_id, kind, notes, bucket_at, created_by)
  values (v_lead, 'note',
          'Meeting booked via Calendly for ' || v_when || ' IST' || coalesce(' · ' || nullif(p->>'event_name',''), '')
            || coalesce(E'\nMeet link: ' || nullif(p->>'join_url',''), ''),
          (select bucket from public.leads where id = v_lead), p_rm);

  insert into public.calendly_events (invitee_uri, event_uri, rm_id, lead_id, name, email, phone, event_name, start_time, end_time, join_url)
  values (p->>'invitee_uri', p->>'event_uri', p_rm, v_lead, p->>'name', v_email, v_phone, p->>'event_name',
          v_start, nullif(p->>'end_time','')::timestamptz, nullif(p->>'join_url',''));
  return v_lead;
end $$;

create or replace function public.apply_calendly_cancel(p_invitee_uri text, p_rescheduled boolean, p_reason text default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare e public.calendly_events; l public.leads;
begin
  select * into e from public.calendly_events where invitee_uri = p_invitee_uri;
  if not found or e.status = 'canceled' then return null; end if;
  update public.calendly_events set status = 'canceled', canceled_at = now() where invitee_uri = p_invitee_uri;
  if e.lead_id is null then return null; end if;
  select * into l from public.leads where id = e.lead_id;
  insert into public.lead_entries (lead_id, kind, notes, bucket_at, created_by)
  values (e.lead_id, 'note',
          case when p_rescheduled then 'Calendly meeting rescheduled (the new time arrives as a new booking)'
               else 'Calendly meeting cancelled' || coalesce(' · ' || nullif(btrim(p_reason),''), '') end,
          l.bucket, e.rm_id);
  -- only clear the meeting if it is still this booking's time (a reschedule may already have set a new one)
  if not p_rescheduled and l.bucket = 'awaiting_meeting' and l.meeting_at = e.start_time then
    update public.leads set meeting_at = null, meeting_url = null, next_follow_up = public.ist_today(), updated_at = now()
     where id = e.lead_id;
  end if;
  return e.lead_id;
end $$;

-- _move clears meeting_url too when leaving Awaiting meeting
create or replace function public._clear_meeting_url()
returns trigger language plpgsql as $$
begin
  if new.bucket <> 'awaiting_meeting' and old.bucket = 'awaiting_meeting' then new.meeting_url := null; end if;
  return new;
end $$;
create trigger leads_clear_meeting_url before update of bucket on public.leads
  for each row execute function public._clear_meeting_url();

revoke execute on function public.apply_calendly_booking(uuid, jsonb), public.apply_calendly_cancel(text, boolean, text)
  from anon, authenticated, public;
grant execute on function public.apply_calendly_booking(uuid, jsonb), public.apply_calendly_cancel(text, boolean, text)
  to service_role;
