-- Argus · 0022: admin home — per-RM numbers, quality flags, team digest
--
--  * manager_dashboard(from, to, scope): one row per RM ('team' = RMs I manage; 'all' = every RM).
--    Workload (open, overdue, meetings), speed (first-response hours), period results (new leads,
--    prospects, clients, funded) and quality flags (untouched new leads, untouched 7 days, thin call
--    notes, stuck prospects, leads on 4 strikes, activity drop vs the previous 4 weeks).
--  * The 9 am digest: RMs keep theirs; admins now get a team digest instead.

create or replace function public.manager_dashboard(p_from date, p_to date, p_scope text default 'team')
returns table (
  user_id uuid, full_name text, avatar_url text, manager_id uuid, in_rotation boolean, on_leave boolean,
  open_leads bigint, due_today bigint, overdue bigint, meetings_week bigint, meetings_unrecorded bigint,
  new_leads bigint, first_response_hours numeric, prospects bigint, clients bigint, funded numeric,
  untouched_24h bigint, untouched_7d bigint, on_4_strikes bigint, stuck_prospects bigint,
  thin_notes_7d bigint, activity_7d bigint, activity_prev_weekly numeric, last_activity_at timestamptz,
  tasks_overdue bigint
)
language plpgsql stable security definer set search_path = public as $$
declare v_from timestamptz := p_from::timestamp at time zone 'Asia/Kolkata';
        v_to   timestamptz := (p_to + 1)::timestamp at time zone 'Asia/Kolkata';
        v_today date := public.ist_today();
begin
  if not public.is_admin() then raise exception 'Admins only'; end if;
  return query
  select p.id, p.full_name, p.avatar_url, p.manager_id, p.in_rotation, p.on_leave,
    (select count(*) from public.leads l where l.rm_id = p.id and l.bucket::text in ('active_contact','awaiting_meeting','holding','deferred')),
    (select count(*) from public.leads l where l.rm_id = p.id and l.bucket::text in ('active_contact','awaiting_meeting','holding','deferred') and l.next_follow_up = v_today),
    (select count(*) from public.leads l where l.rm_id = p.id and l.bucket::text in ('active_contact','awaiting_meeting','holding','deferred') and l.next_follow_up < v_today),
    (select count(*) from public.meetings m where m.rm_id = p.id and m.status = 'active' and m.start_time >= now() and m.start_time < now() + interval '7 days'),
    (select count(*) from public.leads l where l.rm_id = p.id and l.bucket::text = 'awaiting_meeting' and l.meeting_at < now() - interval '1 hour'),
    (select count(*) from public.leads l where l.rm_id = p.id and l.created_at >= v_from and l.created_at < v_to),
    (select round((percentile_cont(0.5) within group (order by extract(epoch from (f.first_at - l.created_at)) / 3600))::numeric, 1)
       from public.leads l
       cross join lateral (select min(e.created_at) as first_at from public.lead_entries e where e.lead_id = l.id) f
      where l.rm_id = p.id and l.created_at >= v_from and l.created_at < v_to and f.first_at is not null),
    (select count(*) from public.leads l where l.rm_id = p.id and l.converted_at >= v_from and l.converted_at < v_to),
    (select count(*) from public.leads l where l.rm_id = p.id and l.bucket::text = 'client' and l.funded_at >= p_from and l.funded_at <= p_to),
    (select coalesce(sum(l.funded_amount), 0) from public.leads l where l.rm_id = p.id and l.bucket::text = 'client' and l.funded_at >= p_from and l.funded_at <= p_to),
    (select count(*) from public.leads l where l.rm_id = p.id and l.bucket::text = 'active_contact' and l.created_at < now() - interval '24 hours'
        and not exists (select 1 from public.lead_entries e where e.lead_id = l.id)),
    (select count(*) from public.leads l where l.rm_id = p.id and l.bucket::text in ('active_contact','awaiting_meeting','holding')
        and l.created_at < now() - interval '7 days'
        and not exists (select 1 from public.lead_entries e where e.lead_id = l.id and e.occurred_at > now() - interval '7 days')),
    (select count(*) from public.leads l where l.rm_id = p.id and l.strikes = 4 and l.bucket::text in ('active_contact','awaiting_meeting')),
    (select count(*) from public.leads l where l.rm_id = p.id and l.bucket::text = 'converting'
        and (exists (select 1 from public.onboarding_items i where i.lead_id = l.id and i.status = 'blocked')
             or coalesce((select max(i.updated_at) from public.onboarding_items i where i.lead_id = l.id), l.converted_at) < now() - interval '7 days')),
    (select count(*) from public.lead_entries e where e.created_by = p.id and e.occurred_at > now() - interval '7 days'
        and (e.kind in ('meet_call','in_person') or (e.kind = 'phone_call' and e.outcome = 'connected'))
        and length(btrim(coalesce(e.notes, ''))) < 25),
    (select count(*) from public.lead_entries e where e.created_by = p.id and e.occurred_at > now() - interval '7 days'),
    (select round(count(*)::numeric / 4, 1) from public.lead_entries e where e.created_by = p.id
        and e.occurred_at > now() - interval '35 days' and e.occurred_at <= now() - interval '7 days'),
    (select max(e.created_at) from public.lead_entries e where e.created_by = p.id),
    (select count(*) from public.tasks t where (t.assignee_id = p.id) and t.status <> 'done' and t.due_date < v_today)
  from public.profiles p
  where p.is_active and p.role <> 'admin' and p.team = 'Sales'
    and (p_scope = 'all' or p.manager_id = auth.uid())
  order by p.full_name;
end $$;
revoke execute on function public.manager_dashboard(date, date, text) from anon, public;
grant execute on function public.manager_dashboard(date, date, text) to authenticated;

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
             (select count(*) from public.tasks t where (t.assignee_id = p.id or (t.assignee_id is null and t.to_team = p.team)) and t.status <> 'done' and t.due_date <= v_today) as tasks
        from public.profiles p where p.is_active and p.role <> 'admin'
    loop
      if r.due + r.overdue + r.tasks > 0 then
        perform public.notify(r.id, 'digest', 'Today: ' || r.due || ' follow-up' || case when r.due = 1 then '' else 's' end || ' due'
                    || case when r.overdue > 0 then ', ' || r.overdue || ' overdue' else '' end,
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
