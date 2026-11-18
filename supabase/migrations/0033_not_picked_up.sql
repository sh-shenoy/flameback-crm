-- Argus · 0033: "Not picked up"
--
-- Open leads in the first stage are split by what has actually happened, not by a date:
--   New            nobody has called, messaged, emailed or met them yet
--   Not picked up  tried, but they haven't picked up or replied yet
--   Follow-up      spoke at least once (picked up, asked to call back, replied, met)
-- Two columns on leads hold this and are kept in step with the activity log:
--   first_attempt_at  the first call, video call, message, email or meeting
--   spoke_at          the first real conversation
-- Spoke wins: a lead that has been further along (meeting, holding, deferred, prospect) and comes back counts as spoken to.

alter table public.leads add column if not exists first_attempt_at timestamptz;
alter table public.leads add column if not exists spoke_at timestamptz;
create index if not exists leads_contact_state_idx on public.leads (rm_id, bucket, first_attempt_at, spoke_at);

create or replace function public._lead_contact_marks(p_lead uuid)
returns void language sql security definer set search_path = public as $$
  update public.leads l set
    first_attempt_at = (select min(e.occurred_at) from public.lead_entries e where e.lead_id = l.id
                         and e.kind in ('phone_call','meet_call','message','email','in_person')),
    spoke_at = coalesce(
      (select min(e.occurred_at) from public.lead_entries e where e.lead_id = l.id
          and (e.kind = 'in_person' or e.outcome in ('connected','replied','call_back'))),
      case when exists (select 1 from public.lead_events v where v.lead_id = l.id and v.kind = 'bucket'
                          and v.to_value in ('awaiting_meeting','holding','deferred','converting','client'))
           then (select min(v.at) from public.lead_events v where v.lead_id = l.id and v.kind = 'bucket'
                   and v.to_value in ('awaiting_meeting','holding','deferred','converting','client')) end)
  where l.id = p_lead;
$$;
revoke execute on function public._lead_contact_marks(uuid) from anon, authenticated, public;

create or replace function public._entries_contact_marks()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op in ('INSERT','UPDATE') then perform public._lead_contact_marks(new.lead_id); end if;
  if tg_op in ('DELETE','UPDATE') and (tg_op = 'DELETE' or old.lead_id <> new.lead_id) then perform public._lead_contact_marks(old.lead_id); end if;
  return null;
end $$;
drop trigger if exists lead_entries_contact_marks on public.lead_entries;
create trigger lead_entries_contact_marks after insert or update of kind, outcome, occurred_at, lead_id or delete on public.lead_entries
  for each row execute function public._entries_contact_marks();

-- moving forward (meeting, holding…) means they engaged
create or replace function public._events_contact_marks()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.kind = 'bucket' and new.to_value in ('awaiting_meeting','holding','deferred','converting','client') then
    update public.leads set spoke_at = coalesce(spoke_at, new.at) where id = new.lead_id;
  end if;
  return null;
end $$;
drop trigger if exists lead_events_contact_marks on public.lead_events;
create trigger lead_events_contact_marks after insert on public.lead_events
  for each row execute function public._events_contact_marks();

-- fill in for existing leads
do $$ declare r record; begin
  for r in select id from public.leads loop perform public._lead_contact_marks(r.id); end loop;
end $$;

drop function if exists public.report_conversion(date, date, text, uuid);
create or replace function public.report_conversion(p_from date, p_to date, p_group text, p_rm uuid default null)
returns table (grp text, source_kind text, leads bigint, contacted bigint, spoke bigint, interested bigint, met bigint,
               committed bigint, clients bigint, funded_amount numeric, out_list bigint, still_open bigint,
               new_now bigint, not_picked_now bigint, follow_up_now bigint)
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
         count(*) filter (where m.bucket::text = 'active_contact' and m.first_attempt_at is null and m.spoke_at is null) as new_now,
         count(*) filter (where m.bucket::text = 'active_contact' and m.first_attempt_at is not null and m.spoke_at is null) as not_picked_now,
         count(*) filter (where m.bucket::text = 'active_contact' and m.spoke_at is not null) as follow_up_now
    from m left join public.lead_sources s on s.name = m.source
   group by 1
   order by committed desc, leads desc;
$$;
grant execute on function public.report_conversion(date, date, text, uuid) to authenticated;

create or replace function public.run_notification_sweeps()
returns void language plpgsql security definer set search_path = public as $$
declare r record; v_today date := public.ist_today();
begin
  -- daily digest from 9 am IST
  if extract(hour from now() at time zone 'Asia/Kolkata') >= 9 then
    for r in
      select p.id,
             (select count(*) from public.leads l where l.rm_id = p.id and l.bucket in ('active_contact','awaiting_meeting','holding','deferred') and l.next_follow_up = v_today) as due,
             (select count(*) from public.leads l where l.rm_id = p.id and l.bucket in ('active_contact','awaiting_meeting','holding','deferred') and l.next_follow_up < v_today) as overdue,
             (select count(*) from public.tasks t where (t.assignee_id = p.id or (t.assignee_id is null and t.to_team = p.team)) and t.status <> 'done' and t.due_date <= v_today) as tasks,
             (select count(*) from public.leads l where l.rm_id = p.id and l.bucket = 'active_contact' and l.first_attempt_at is null and l.spoke_at is null) as fresh
        from public.profiles p where p.is_active and p.role <> 'admin'
    loop
      if r.due + r.overdue + r.tasks + r.fresh > 0 then
        perform public.notify(r.id, 'digest', 'Today: ' || r.due || ' follow-up' || case when r.due = 1 then '' else 's' end || ' due'
                    || case when r.overdue > 0 then ', ' || r.overdue || ' overdue' else '' end
                    || case when r.fresh > 0 then ', ' || r.fresh || ' new lead' || case when r.fresh = 1 then '' else 's' end || ' to contact' else '' end,
          case when r.tasks > 0 then r.tasks || ' task' || case when r.tasks = 1 then '' else 's' end || ' due or overdue' else 'Open your dashboard to start' end,
          '/', 'digest:' || v_today, true);
      end if;
    end loop;
  end if;

  -- meetings starting within ~35 minutes
  for r in select id, name, rm_id, meeting_at from public.leads
            where bucket = 'awaiting_meeting' and meeting_at > now() and meeting_at <= now() + interval '35 minutes'
  loop
    perform public.notify(r.rm_id, 'meeting_soon', 'Meeting in ' || greatest(1, ceil(extract(epoch from r.meeting_at - now()) / 60))::int || ' min: ' || r.name,
      to_char(r.meeting_at at time zone 'Asia/Kolkata', 'HH12:MI am') || ' IST', '/leads/' || r.id, 'meet:' || r.id || ':' || r.meeting_at, true);
  end loop;

  -- admins: one team digest from 9 am IST
  if extract(hour from now() at time zone 'Asia/Kolkata') >= 9 then
    for r in
      select a.id,
             (select count(*) from public.leads l join public.profiles p on p.id = l.rm_id
               where (p.manager_id = a.id or not exists (select 1 from public.profiles x where x.manager_id = a.id))
                 and l.bucket::text in ('active_contact','awaiting_meeting','holding','deferred') and l.next_follow_up < v_today) as overdue,
             (select count(*) from public.leads l join public.profiles p on p.id = l.rm_id
               where (p.manager_id = a.id or not exists (select 1 from public.profiles x where x.manager_id = a.id))
                 and l.bucket::text = 'active_contact' and l.created_at < now() - interval '24 hours'
                 and not exists (select 1 from public.lead_entries e where e.lead_id = l.id)) as untouched,
             (select count(*) from public.lead_entries e join public.profiles p on p.id = e.created_by
               where (p.manager_id = a.id or not exists (select 1 from public.profiles x where x.manager_id = a.id))
                 and e.occurred_at >= ((v_today - 1)::timestamp at time zone 'Asia/Kolkata') and e.occurred_at < (v_today::timestamp at time zone 'Asia/Kolkata')) as yesterday,
             (select count(*) from public.leads l join public.profiles p on p.id = l.rm_id
               where (p.manager_id = a.id or not exists (select 1 from public.profiles x where x.manager_id = a.id))
                 and l.converted_at >= ((v_today - 1)::timestamp at time zone 'Asia/Kolkata') and l.converted_at < (v_today::timestamp at time zone 'Asia/Kolkata')) as new_prospects
        from public.profiles a where a.is_active and a.role = 'admin'
    loop
      perform public.notify(r.id, 'digest', 'Team today: ' || r.overdue || ' overdue follow-up' || case when r.overdue = 1 then '' else 's' end
                  || case when r.untouched > 0 then ', ' || r.untouched || ' new lead' || case when r.untouched = 1 then '' else 's' end || ' untouched' else '' end,
        'Yesterday: ' || r.yesterday || ' activit' || case when r.yesterday = 1 then 'y' else 'ies' end || ' logged'
          || case when r.new_prospects > 0 then ', ' || r.new_prospects || ' new prospect' || case when r.new_prospects = 1 then '' else 's' end else '' end,
        '/', 'digest:' || v_today, true);
    end loop;
  end if;
end $$;
