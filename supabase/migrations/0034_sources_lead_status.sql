-- Argus · 0034: more lead sources, and a lead status for every call
--
-- Sources: Cold Lead, DoubleTick, IVR Call, smallcase, Walk-in, Metabase (Calendly and Referral exist).
--
-- Lead status: what the RM recorded on the last call (DNP, Interested, Demo Required…).
--  * lead_statuses: the list, each with the call outcome it stands for, so the usual rules apply
--    (no answer → Not picked up and a strike; Not Interested / Invalid Number → Out List).
--  * leads.lead_status (+ when), lead_entries.lead_status: latest on the lead, and on each entry.
--  * log_activity takes p_status; set_lead_status changes it without logging a call.

insert into public.lead_sources (name, kind, sort_order) values
  ('Cold Lead',  'cold', 105),
  ('DoubleTick', 'warm', 52),
  ('IVR Call',   'warm', 54),
  ('smallcase',  'warm', 56),
  ('Walk-in',    'warm', 45),
  ('Metabase',   'cold', 170)
on conflict (name) do update set is_active = true;

create table if not exists public.lead_statuses (
  name       text primary key,
  outcome    text not null check (outcome in ('connected','no_answer','call_back','not_interested')),
  out_reason text,                         -- set: picking it moves the lead to the Out List
  sort_order int not null default 100,
  is_active  boolean not null default true
);
alter table public.lead_statuses enable row level security;
drop policy if exists lead_statuses_read on public.lead_statuses;
create policy lead_statuses_read on public.lead_statuses for select to authenticated using (true);
drop policy if exists lead_statuses_admin on public.lead_statuses;
create policy lead_statuses_admin on public.lead_statuses for all to authenticated using (public.is_admin()) with check (public.is_admin());

insert into public.lead_statuses (name, outcome, out_reason, sort_order) values
  ('DNP',                  'no_answer',      null, 10),
  ('Call Declined',        'no_answer',      null, 20),
  ('Switched Off',         'no_answer',      null, 30),
  ('Call Back Later',      'call_back',      null, 40),
  ('Invalid Number',       'no_answer',      'Invalid number', 50),
  ('Interested',           'connected',      null, 60),
  ('Follow-Up',            'connected',      null, 70),
  ('Warm-Up',              'connected',      null, 80),
  ('Just Exploring',       'connected',      null, 90),
  ('Demo Required',        'connected',      null, 100),
  ('Research Call',        'connected',      null, 110),
  ('Free Trial',           'connected',      null, 120),
  ('Home Visit',           'connected',      null, 130),
  ('Dual Login',           'connected',      null, 140),
  ('Payment Completed',    'connected',      null, 150),
  ('Already Subscribed',   'connected',      null, 160),
  ('Language Barrier',     'connected',      null, 170),
  ('Looking for a Job',    'connected',      null, 180),
  ('Out of Target Group',  'connected',      null, 190),
  ('Not Interested',       'not_interested', null, 200)
on conflict (name) do nothing;

alter table public.leads add column if not exists lead_status text references public.lead_statuses(name) on update cascade on delete set null;
alter table public.leads add column if not exists lead_status_at timestamptz;
alter table public.lead_entries add column if not exists lead_status text references public.lead_statuses(name) on update cascade on delete set null;
create index if not exists leads_lead_status_idx on public.leads (lead_status);

-- ── log_activity with a status ──
drop function if exists public.log_activity(uuid, text, text, text, timestamptz, date, text, date, text, text);
create or replace function public.log_activity(
  p_lead uuid, p_kind text, p_outcome text default null, p_notes text default null,
  p_occurred_at timestamptz default null, p_next_follow_up date default null,
  p_result text default null, p_deferred_until date default null, p_product text default null,
  p_platform text default null, p_status text default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare r uuid; s public.lead_statuses;
begin
  if p_platform is not null then
    if p_kind = 'meet_call' and p_platform not in ('google-meet','zoom') then raise exception 'Video calls are on Google Meet or Zoom'; end if;
    if p_kind = 'message' and p_platform not in ('whatsapp','sms','linkedin','other') then raise exception 'Messages are WhatsApp, SMS or LinkedIn'; end if;
    if p_kind not in ('meet_call','message') then p_platform := null; end if;
  end if;
  if p_status is not null then
    select * into s from public.lead_statuses where name = p_status and is_active;
    if not found then raise exception 'Unknown lead status "%"', p_status; end if;
    if p_kind = 'note' then raise exception 'A lead status goes with a call, message or meeting'; end if;
    -- the status decides what happened on a call
    if p_kind in ('phone_call','meet_call') then p_outcome := s.outcome;
    elsif p_kind in ('message','email') and s.outcome = 'not_interested' then p_outcome := 'not_interested';
    end if;
    if s.outcome = 'no_answer' or s.out_reason is not null or s.outcome = 'not_interested' then p_result := null; end if;
  end if;
  r := public._log_activity_rules(p_lead, p_kind, p_outcome, p_notes, p_occurred_at, p_next_follow_up,
                                  p_result, p_deferred_until, p_product);
  if p_platform is not null or p_status is not null then
    update public.lead_entries set platform = coalesce(p_platform, platform), lead_status = coalesce(p_status, lead_status)
     where lead_id = p_lead and kind = p_kind and created_by = auth.uid()
       and created_at = now();   -- the entry this call just added (same transaction)
  end if;
  if p_status is not null then
    update public.leads set lead_status = p_status, lead_status_at = coalesce(p_occurred_at, now()) where id = p_lead;
    if s.out_reason is not null and (select bucket::text from public.leads where id = p_lead) not in ('out','converting','client') then
      perform public._move(p_lead, 'out', s.out_reason);
    end if;
  end if;
  return r;
end $$;
grant execute on function public.log_activity(uuid, text, text, text, timestamptz, date, text, date, text, text, text) to authenticated;

-- change the status without logging a call (e.g. Payment Completed, Dual Login)
create or replace function public.set_lead_status(p_lead uuid, p_status text)
returns void language plpgsql security definer set search_path = public as $$
declare l public.leads;
begin
  l := public.assert_lead_access(p_lead);
  if p_status is not null and not exists (select 1 from public.lead_statuses where name = p_status and is_active) then
    raise exception 'Unknown lead status "%"', p_status;
  end if;
  if l.lead_status is not distinct from p_status then return; end if;
  update public.leads set lead_status = p_status, lead_status_at = now(), updated_at = now() where id = p_lead;
  perform public.log_event(p_lead, 'status', l.lead_status, p_status);
end $$;
revoke execute on function public.set_lead_status(uuid, text) from anon, public;
grant execute on function public.set_lead_status(uuid, text) to authenticated;
