-- Argus · 0037: the admin digest names who has overdue follow-ups
--
-- "Team today: 17 overdue follow-ups (Bhaskar 12, Hemanth 5)": up to six RMs, worst first.

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
             -- who is behind, worst first: "Bhaskar 12, Hemanth 5"
             (select string_agg(x.who || ' ' || x.n, ', ' order by x.n desc) from (
                select coalesce(split_part(p.full_name, ' ', 1), p.email) as who, count(*) as n
                  from public.leads l join public.profiles p on p.id = l.rm_id
                 where (p.manager_id = a.id or not exists (select 1 from public.profiles x where x.manager_id = a.id))
                   and l.bucket::text in ('active_contact','awaiting_meeting','holding','deferred') and l.next_follow_up < v_today
                 group by p.id, p.full_name, p.email order by count(*) desc limit 6) x) as behind,
             (select count(*) from public.lead_entries e join public.profiles p on p.id = e.created_by
               where (p.manager_id = a.id or not exists (select 1 from public.profiles x where x.manager_id = a.id))
                 and e.occurred_at >= ((v_today - 1)::timestamp at time zone 'Asia/Kolkata') and e.occurred_at < (v_today::timestamp at time zone 'Asia/Kolkata')) as yesterday,
             (select count(*) from public.leads l join public.profiles p on p.id = l.rm_id
               where (p.manager_id = a.id or not exists (select 1 from public.profiles x where x.manager_id = a.id))
                 and l.converted_at >= ((v_today - 1)::timestamp at time zone 'Asia/Kolkata') and l.converted_at < (v_today::timestamp at time zone 'Asia/Kolkata')) as new_prospects
        from public.profiles a where a.is_active and a.role = 'admin'
    loop
      perform public.notify(r.id, 'digest', 'Team today: ' || r.overdue || ' overdue follow-up' || case when r.overdue = 1 then '' else 's' end
                  || case when r.behind is not null then ' (' || r.behind || ')' else '' end,
        'Yesterday: ' || r.yesterday || ' activit' || case when r.yesterday = 1 then 'y' else 'ies' end || ' logged'
          || case when r.new_prospects > 0 then ', ' || r.new_prospects || ' new prospect' || case when r.new_prospects = 1 then '' else 's' end else '' end,
        '/', 'digest:' || v_today, true);
    end loop;
  end if;
end $$;
