-- Argus · 0017: report funnel gets a "Wants to meet" stage
--
-- report_conversion adds `interested`: leads that reached Awaiting meeting (or went further), so a
-- source's funnel reads Leads → Contacted → Wants to meet → Met → Committed. The return type changes,
-- so the function is dropped and recreated.

drop function if exists public.report_conversion(date, date, text, uuid);

create or replace function public.report_conversion(p_from date, p_to date, p_group text, p_rm uuid default null)
returns table (grp text, source_kind text, leads bigint, contacted bigint, interested bigint, met bigint, committed bigint, out_list bigint, still_open bigint)
language sql stable security invoker set search_path = public as $$
  with l as (
    select l.*,
           exists (select 1 from public.lead_entries e where e.lead_id = l.id) as has_entries,
           exists (select 1 from public.lead_events v where v.lead_id = l.id and v.kind = 'bucket'
                     and v.to_value in ('awaiting_meeting','holding','deferred','converting')) as reached_interest,
           exists (select 1 from public.lead_events v where v.lead_id = l.id and v.kind = 'bucket'
                     and v.to_value in ('holding','deferred','converting')) as reached_meeting
      from public.leads l
     where l.created_at >= (p_from::timestamp at time zone 'Asia/Kolkata')
       and l.created_at <  ((p_to + 1)::timestamp at time zone 'Asia/Kolkata')
       and (p_rm is null or l.rm_id = p_rm)
  )
  select case p_group
           when 'campaign' then coalesce(nullif(l.campaign,''), '(no campaign)')
           when 'referrer' then coalesce(nullif(l.referred_by,''), '(not referred)')
           when 'product'  then l.product
           when 'rm'       then coalesce((select full_name from public.profiles p where p.id = l.rm_id), '?')
           else l.source end as grp,
         case when p_group = 'source' then max(s.kind) end as source_kind,
         count(*) as leads,
         count(*) filter (where l.has_entries or l.bucket <> 'active_contact') as contacted,
         count(*) filter (where l.reached_interest or l.reached_meeting or l.bucket in ('awaiting_meeting','holding','deferred','converting')) as interested,
         count(*) filter (where l.reached_meeting or l.bucket in ('holding','deferred','converting')) as met,
         count(*) filter (where l.bucket = 'converting' or l.converted_at is not null) as committed,
         count(*) filter (where l.bucket = 'out') as out_list,
         count(*) filter (where l.bucket in ('active_contact','awaiting_meeting','holding','deferred')) as still_open
    from l left join public.lead_sources s on s.name = l.source
   group by 1
   order by committed desc, leads desc;
$$;
