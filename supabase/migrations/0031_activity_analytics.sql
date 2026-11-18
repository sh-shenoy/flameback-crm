-- Argus · 0031: activity analytics
--
-- 1. Activity entries record the platform: video calls on Google Meet or Zoom, messages on
--    WhatsApp, SMS or LinkedIn. log_activity takes p_platform.
-- 2. report_conversion adds "Spoke" (a real conversation: call picked up, met in person, or a reply)
--    and where leads sit right now (new, in follow-up), so each RM gets a full funnel.
-- 3. activity_analytics(from, to, rms): admin-only numbers for the Analytics page.

alter table public.lead_entries add column if not exists platform text
  check (platform in ('google-meet','zoom','whatsapp','sms','linkedin','other'));

-- ── log_activity with a platform ──
-- The existing function keeps all the rules; it is renamed and the public one wraps it.
alter function public.log_activity(uuid, text, text, text, timestamptz, date, text, date, text)
  rename to _log_activity_rules;
revoke execute on function public._log_activity_rules(uuid, text, text, text, timestamptz, date, text, date, text)
  from anon, authenticated, public;

create or replace function public.log_activity(
  p_lead uuid, p_kind text, p_outcome text default null, p_notes text default null,
  p_occurred_at timestamptz default null, p_next_follow_up date default null,
  p_result text default null, p_deferred_until date default null, p_product text default null,
  p_platform text default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare r uuid;
begin
  if p_platform is not null then
    if p_kind = 'meet_call' and p_platform not in ('google-meet','zoom') then raise exception 'Video calls are on Google Meet or Zoom'; end if;
    if p_kind = 'message' and p_platform not in ('whatsapp','sms','linkedin','other') then raise exception 'Messages are WhatsApp, SMS or LinkedIn'; end if;
    if p_kind not in ('meet_call','message') then p_platform := null; end if;
  end if;
  r := public._log_activity_rules(p_lead, p_kind, p_outcome, p_notes, p_occurred_at, p_next_follow_up,
                                  p_result, p_deferred_until, p_product);
  if p_platform is not null then
    update public.lead_entries set platform = p_platform
     where lead_id = p_lead and kind = p_kind and created_by = auth.uid()
       and created_at = now();   -- the entry this call just added (same transaction)
  end if;
  return r;
end $$;
grant execute on function public.log_activity(uuid, text, text, text, timestamptz, date, text, date, text, text) to authenticated;

-- ── report_conversion: Spoke, plus where leads are now ──
drop function if exists public.report_conversion(date, date, text, uuid);
create or replace function public.report_conversion(p_from date, p_to date, p_group text, p_rm uuid default null)
returns table (grp text, source_kind text, leads bigint, contacted bigint, spoke bigint, interested bigint, met bigint,
               committed bigint, clients bigint, funded_amount numeric, out_list bigint, still_open bigint,
               new_now bigint, follow_up_now bigint)
language sql stable security invoker set search_path = public as $$
  with l as (
    select l.*,
           exists (select 1 from public.lead_entries e where e.lead_id = l.id) as has_entries,
           exists (select 1 from public.lead_entries e where e.lead_id = l.id
                     and (e.kind = 'in_person' or e.outcome in ('connected','replied'))) as has_spoken,
           exists (select 1 from public.lead_events v where v.lead_id = l.id and v.kind = 'bucket'
                     and v.to_value in ('awaiting_meeting','holding','deferred','converting','client')) as reached_interest,
           exists (select 1 from public.lead_events v where v.lead_id = l.id and v.kind = 'bucket'
                     and v.to_value in ('holding','deferred','converting','client')) as reached_meeting
      from public.leads l
     where l.created_at >= (p_from::timestamp at time zone 'Asia/Kolkata')
       and l.created_at <  ((p_to + 1)::timestamp at time zone 'Asia/Kolkata')
       and (p_rm is null or l.rm_id = p_rm)
  ), m as (
    select l.*,
           (l.reached_interest or l.reached_meeting or l.bucket::text in ('awaiting_meeting','holding','deferred','converting','client')) as is_interested,
           (l.reached_meeting or l.bucket::text in ('holding','deferred','converting','client')) as is_met,
           (l.bucket::text in ('converting','client') or l.converted_at is not null) as is_committed
      from l
  )
  select case p_group
           when 'campaign' then coalesce(nullif(m.campaign,''), '(no campaign)')
           when 'referrer' then coalesce(nullif(m.referred_by,''), '(not referred)')
           when 'product'  then m.product
           when 'rm'       then coalesce((select full_name from public.profiles p where p.id = m.rm_id), '?')
           else m.source end as grp,
         case when p_group = 'source' then max(s.kind) end as source_kind,
         count(*) as leads,
         count(*) filter (where m.has_entries or m.bucket::text <> 'active_contact') as contacted,
         count(*) filter (where m.has_spoken or m.is_interested) as spoke,
         count(*) filter (where m.is_interested) as interested,
         count(*) filter (where m.is_met) as met,
         count(*) filter (where m.is_committed) as committed,
         count(*) filter (where m.bucket::text = 'client') as clients,
         coalesce(sum(m.funded_amount) filter (where m.bucket::text = 'client'), 0) as funded_amount,
         count(*) filter (where m.bucket::text = 'out') as out_list,
         count(*) filter (where m.bucket::text in ('active_contact','awaiting_meeting','holding','deferred')) as still_open,
         count(*) filter (where m.bucket::text = 'active_contact' and m.next_follow_up is null) as new_now,
         count(*) filter (where m.bucket::text = 'active_contact' and m.next_follow_up is not null) as follow_up_now
    from m left join public.lead_sources s on s.name = m.source
   group by 1
   order by committed desc, leads desc;
$$;
grant execute on function public.report_conversion(date, date, text, uuid) to authenticated;

-- ── activity_analytics ──
-- Everything the team did with clients between two IST dates, for the RMs given (null = everyone).
-- Admin-only. Returns one jsonb document; the page draws it.
create or replace function public.activity_analytics(p_from date, p_to date, p_rms uuid[] default null)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  t0 timestamptz := p_from::timestamp at time zone 'Asia/Kolkata';
  t1 timestamptz := (p_to + 1)::timestamp at time zone 'Asia/Kolkata';
  days int := p_to - p_from + 1;
  p0 timestamptz := (p_from - days)::timestamp at time zone 'Asia/Kolkata';   -- previous period of the same length
  res jsonb;
begin
  if not public.is_admin() then raise exception 'Admins only'; end if;
  if p_to < p_from then raise exception 'The end date is before the start date'; end if;
  if days > 400 then raise exception 'Pick a period of at most 400 days'; end if;

  with e as (   -- activity entries in this period and the previous one
    select x.*, (x.occurred_at >= t0) as cur,
           case when x.kind = 'meet_call' then coalesce(x.platform, 'google-meet')
                when x.kind = 'message' then coalesce(x.platform, 'other') end as plat,
           (x.occurred_at at time zone 'Asia/Kolkata')::date as d,
           extract(hour from x.occurred_at at time zone 'Asia/Kolkata')::int as hr,
           extract(isodow from x.occurred_at at time zone 'Asia/Kolkata')::int as dow
      from public.lead_entries x
     where x.occurred_at >= p0 and x.occurred_at < t1
       and (p_rms is null or x.created_by = any(p_rms))
  ), ec as (select * from e where cur),
  g as (        -- Gmail synced emails
    select m.*, (m.sent_at >= t0) as cur from public.gmail_messages m
     where m.sent_at >= p0 and m.sent_at < t1 and (p_rms is null or m.user_id = any(p_rms))
  ), mt as (    -- meetings booked through the scheduler, by when they take place
    select m.*, case when m.join_url ilike '%zoom.us%' then 'zoom'
                     when m.join_url ilike '%meet.google.com%' then 'google-meet'
                     when m.join_url is null or m.join_url = '' then 'in-person'
                     else 'other' end as plat
      from public.meetings m
     where m.start_time >= t0 and m.start_time < t1 and (p_rms is null or m.rm_id = any(p_rms))
  ), mv as (    -- stage moves
    select v.* from public.lead_events v
     where v.kind = 'bucket' and v.at >= t0 and v.at < t1 and (p_rms is null or v.actor = any(p_rms))
  ), nl as (    -- leads that came in, with their first outreach
    select l.id, l.rm_id, l.source, l.created_at,
           (select min(x.occurred_at) from public.lead_entries x
             where x.lead_id = l.id and x.kind in ('phone_call','meet_call','message','email','in_person')) as first_touch
      from public.leads l
     where l.created_at >= t0 and l.created_at < t1 and (p_rms is null or l.rm_id = any(p_rms))
  ), outreach as (select * from ec where kind in ('phone_call','meet_call','message','email','in_person')),
  calls as (select * from ec where kind in ('phone_call','meet_call'))
  select jsonb_build_object(
    'totals', jsonb_build_object(
      'activities', (select count(*) from ec),
      'activities_prev', (select count(*) from e where not cur),
      'clients', (select count(distinct lead_id) from outreach),
      'clients_prev', (select count(distinct lead_id) from e where not cur and kind in ('phone_call','meet_call','message','email','in_person')),
      'calls', (select count(*) from calls),
      'calls_prev', (select count(*) from e where not cur and kind in ('phone_call','meet_call')),
      'connected', (select count(*) from calls where outcome = 'connected'),
      'connected_prev', (select count(*) from e where not cur and kind in ('phone_call','meet_call') and outcome = 'connected'),
      'meetings', (select count(*) from ec where kind = 'in_person' or (kind = 'meet_call' and outcome = 'connected')),
      'meetings_prev', (select count(*) from e where not cur and (kind = 'in_person' or (kind = 'meet_call' and outcome = 'connected'))),
      'messages', (select count(*) from ec where kind = 'message'),
      'emails', (select count(*) from ec where kind = 'email') + (select count(*) from g where cur and direction = 'out'),
      'notes', (select count(*) from ec where kind = 'note'),
      'new_leads', (select count(*) from nl),
      'new_reached', (select count(*) from nl where first_touch is not null),
      'median_first_hours', (select round((percentile_cont(0.5) within group (order by extract(epoch from first_touch - created_at)) / 3600)::numeric, 1)
                               from nl where first_touch is not null and first_touch >= created_at)
    ),
    'daily', (select coalesce(jsonb_agg(jsonb_build_object(
                'd', dd::date,
                'activities', (select count(*) from ec where d = dd::date),
                'clients', (select count(distinct lead_id) from outreach where d = dd::date),
                'calls', (select count(*) from calls where d = dd::date),
                'connected', (select count(*) from calls where d = dd::date and outcome = 'connected'),
                'meetings', (select count(*) from ec where d = dd::date and (kind = 'in_person' or (kind = 'meet_call' and outcome = 'connected'))),
                'prev', (select count(*) from e where not cur and d = (dd - make_interval(days => days))::date)
              ) order by dd), '[]'::jsonb)
                from generate_series(p_from::timestamp, p_to::timestamp, interval '1 day') dd),
    'channels', (select coalesce(jsonb_agg(c order by (c->>'n')::int desc), '[]'::jsonb) from (
        select jsonb_build_object('key', ch, 'n', count(*),
                 'connected', count(*) filter (where outcome in ('connected','replied') or kind = 'in_person'),
                 'leads', count(distinct lead_id)) as c
          from (select ec.*, case kind when 'phone_call' then 'phone' when 'in_person' then 'in-person'
                                       when 'email' then 'email' else plat end as ch
                  from ec where kind <> 'note') z
         group by ch
        union all
        select jsonb_build_object('key', 'gmail', 'n', count(*) filter (where direction = 'out'),
                 'connected', count(*) filter (where direction = 'in'), 'leads', count(distinct lead_id))
          from g where cur having count(*) > 0) q),
    'outcomes', (select coalesce(jsonb_object_agg(k, n), '{}'::jsonb) from (
        select coalesce(outcome, 'none') as k, count(*) as n from calls group by 1) q),
    'meetings', jsonb_build_object(
        'by_platform', (select coalesce(jsonb_object_agg(plat, n), '{}'::jsonb) from (
            select plat, count(*) filter (where status = 'active') as n from mt group by plat) q),
        'booked', (select count(*) from mt where status = 'active'),
        'canceled', (select count(*) from mt where status = 'canceled'),
        'logged', (select coalesce(jsonb_object_agg(k, n), '{}'::jsonb) from (
            select case when kind = 'in_person' then 'in-person' else plat end as k, count(*) as n
              from ec where kind = 'in_person' or (kind = 'meet_call' and outcome = 'connected') group by 1) q)),
    'by_rm', (select coalesce(jsonb_agg(r order by (r->>'activities')::int desc), '[]'::jsonb) from (
        select jsonb_build_object(
                 'rm', p.id, 'name', p.full_name,
                 'activities', (select count(*) from ec where created_by = p.id),
                 'clients', (select count(distinct lead_id) from outreach where created_by = p.id),
                 'calls', (select count(*) from calls where created_by = p.id),
                 'connected', (select count(*) from calls where created_by = p.id and outcome = 'connected'),
                 'meetings', (select count(*) from ec where created_by = p.id and (kind = 'in_person' or (kind = 'meet_call' and outcome = 'connected'))),
                 'messages', (select count(*) from ec where created_by = p.id and kind = 'message'),
                 'emails', (select count(*) from ec where created_by = p.id and kind = 'email') + (select count(*) from g where cur and user_id = p.id and direction = 'out'),
                 'moved_forward', (select count(*) from mv where actor = p.id and to_value in ('awaiting_meeting','holding','converting','client')),
                 'new_leads', (select count(*) from nl where rm_id = p.id),
                 'new_reached', (select count(*) from nl where rm_id = p.id and first_touch is not null),
                 'median_first_hours', (select round((percentile_cont(0.5) within group (order by extract(epoch from first_touch - created_at)) / 3600)::numeric, 1)
                                          from nl where rm_id = p.id and first_touch is not null and first_touch >= created_at),
                 'active_days', (select count(distinct d) from ec where created_by = p.id)
               ) as r
          from public.profiles p
         where p.role <> 'admin' and p.is_active
           and (p_rms is null or p.id = any(p_rms))) q),
    'by_source', (select coalesce(jsonb_agg(s order by (s->>'activities')::int desc), '[]'::jsonb) from (
        select jsonb_build_object('source', l.source, 'activities', count(*),
                 'clients', count(distinct o.lead_id) filter (where o.kind <> 'note'),
                 'connected', count(*) filter (where o.outcome in ('connected','replied') or o.kind = 'in_person')) as s
          from ec o join public.leads l on l.id = o.lead_id group by l.source) q),
    'hours', (select coalesce(jsonb_agg(jsonb_build_object('h', h, 'n', (select count(*) from outreach where hr = h)) order by h), '[]'::jsonb)
                from generate_series(0, 23) h),
    'weekdays', (select coalesce(jsonb_agg(jsonb_build_object('dow', w, 'n', (select count(*) from outreach where dow = w)) order by w), '[]'::jsonb)
                from generate_series(1, 7) w),
    'moves', (select coalesce(jsonb_object_agg(to_value, n), '{}'::jsonb) from (
        select to_value, count(*) as n from mv group by to_value) q),
    'email', jsonb_build_object(
        'sent', (select count(*) from g where cur and direction = 'out'),
        'received', (select count(*) from g where cur and direction = 'in'),
        'logged', (select count(*) from ec where kind = 'email'),
        'logged_replied', (select count(*) from ec where kind = 'email' and outcome = 'replied')),
    'messages', jsonb_build_object(
        'by_platform', (select coalesce(jsonb_object_agg(plat, n), '{}'::jsonb) from (
            select plat, count(*) as n from ec where kind = 'message' group by plat) q),
        'replied', (select count(*) from ec where kind = 'message' and outcome = 'replied'))
  ) into res;
  return res;
end $$;
revoke execute on function public.activity_analytics(date, date, uuid[]) from anon, public;
grant execute on function public.activity_analytics(date, date, uuid[]) to authenticated;
