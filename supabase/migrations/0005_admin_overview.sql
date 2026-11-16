-- Flameback CRM · 0005: admin team overview, nudges, bulk reassign
--
--  * admin_team_stats: one row per active person with pipeline, activity and task numbers.
--  * Nudges: an admin sends someone a short prompt; it arrives as a notification and is kept as history.
--  * reassign_leads: hand several leads to another person in one go.
-- Everything here is admin-only.

create or replace function public.admin_team_stats(p_from date, p_to date)
returns table (
  user_id uuid, full_name text, email text, role text, team text, in_rotation boolean, avatar_url text,
  open_leads bigint, active_contact bigint, awaiting_meeting bigint, holding bigint, deferred bigint,
  due_today bigint, overdue bigint, meetings_week bigint, meetings_unrecorded bigint, untouched_7d bigint,
  new_leads bigint, committed bigint, out_list bigint, entries bigint, calls bigint,
  last_activity_at timestamptz, tasks_open bigint, tasks_overdue bigint, last_nudged_at timestamptz
)
language plpgsql stable security definer set search_path = public as $$
declare v_from timestamptz := p_from::timestamp at time zone 'Asia/Kolkata';
        v_to   timestamptz := (p_to + 1)::timestamp at time zone 'Asia/Kolkata';
        v_today date := public.ist_today();
begin
  if not public.is_admin() then raise exception 'Admins only'; end if;
  return query
  select p.id, p.full_name, p.email, p.role, p.team, p.in_rotation, p.avatar_url,
    count(l.id) filter (where l.bucket in ('active_contact','awaiting_meeting','holding','deferred')),
    count(l.id) filter (where l.bucket = 'active_contact'),
    count(l.id) filter (where l.bucket = 'awaiting_meeting'),
    count(l.id) filter (where l.bucket = 'holding'),
    count(l.id) filter (where l.bucket = 'deferred'),
    count(l.id) filter (where l.bucket in ('active_contact','awaiting_meeting','holding','deferred') and l.next_follow_up = v_today),
    count(l.id) filter (where l.bucket in ('active_contact','awaiting_meeting','holding','deferred') and l.next_follow_up < v_today),
    count(l.id) filter (where l.bucket = 'awaiting_meeting' and l.meeting_at >= now() and l.meeting_at < now() + interval '7 days'),
    count(l.id) filter (where l.bucket = 'awaiting_meeting' and l.meeting_at < now() - interval '1 hour'),
    count(l.id) filter (where l.bucket in ('active_contact','awaiting_meeting','holding')
                          and l.created_at < now() - interval '7 days'
                          and not exists (select 1 from public.lead_entries e where e.lead_id = l.id and e.occurred_at > now() - interval '7 days')),
    count(l.id) filter (where l.created_at >= v_from and l.created_at < v_to),
    count(l.id) filter (where l.converted_at >= v_from and l.converted_at < v_to),
    count(l.id) filter (where l.out_at >= v_from and l.out_at < v_to),
    (select count(*) from public.lead_entries e where e.created_by = p.id and e.occurred_at >= v_from and e.occurred_at < v_to),
    (select count(*) from public.lead_entries e where e.created_by = p.id and e.kind in ('phone_call','meet_call') and e.occurred_at >= v_from and e.occurred_at < v_to),
    (select max(e.created_at) from public.lead_entries e where e.created_by = p.id),
    (select count(*) from public.tasks t where (t.assignee_id = p.id or (t.assignee_id is null and t.to_team = p.team)) and t.status <> 'done'),
    (select count(*) from public.tasks t where (t.assignee_id = p.id or (t.assignee_id is null and t.to_team = p.team)) and t.status <> 'done' and t.due_date < v_today),
    (select max(n.created_at) from public.nudges n where n.to_user = p.id)
  from public.profiles p
  left join public.leads l on l.rm_id = p.id
  where p.is_active
  group by p.id
  order by p.full_name;
end $$;

create table public.nudges (
  id         uuid primary key default gen_random_uuid(),
  to_user    uuid not null references public.profiles(id) on delete cascade,
  from_user  uuid not null references public.profiles(id),
  message    text not null check (length(trim(message)) > 0),
  link       text,
  created_at timestamptz not null default now()
);
create index nudges_to_idx on public.nudges (to_user, created_at desc);
alter table public.nudges enable row level security;
create policy nudges_read on public.nudges for select to authenticated using (public.is_admin() or to_user = auth.uid());
revoke insert, update, delete on public.nudges from anon, authenticated;

create or replace function public.send_nudge(p_user uuid, p_message text, p_link text default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare v uuid; v_from text;
begin
  if not public.is_admin() then raise exception 'Only an admin can send nudges'; end if;
  if coalesce(btrim(p_message),'') = '' then raise exception 'Write a message'; end if;
  if not exists (select 1 from public.profiles where id = p_user and is_active) then raise exception 'Unknown person'; end if;
  insert into public.nudges (to_user, from_user, message, link) values (p_user, auth.uid(), left(btrim(p_message), 500), p_link)
  returning id into v;
  v_from := coalesce((select full_name from public.profiles where id = auth.uid()), 'Your admin');
  perform public.notify(p_user, 'nudge', 'Nudge from ' || v_from, left(btrim(p_message), 500), coalesce(p_link, '/'));
  return v;
end $$;

create or replace function public.reassign_leads(p_leads uuid[], p_rm uuid)
returns int language plpgsql security definer set search_path = public as $$
declare n int;
begin
  if not public.is_admin() then raise exception 'Only an admin can reassign leads'; end if;
  if not exists (select 1 from public.profiles where id = p_rm and is_active) then raise exception 'Unknown person'; end if;
  insert into public.lead_events (lead_id, kind, from_value, to_value, actor)
  select id, 'assigned', rm_id::text, p_rm::text, auth.uid() from public.leads where id = any (p_leads) and rm_id <> p_rm;
  -- one notification for the batch instead of one per lead (the trigger checks this flag)
  perform set_config('crm.bulk_reassign', 'on', true);
  update public.leads set rm_id = p_rm, updated_at = now() where id = any (p_leads) and rm_id <> p_rm;
  get diagnostics n = row_count;
  perform set_config('crm.bulk_reassign', 'off', true);
  if n > 0 then
    perform public.notify(p_rm, 'lead_assigned', n || ' lead' || case when n = 1 then '' else 's' end || ' assigned to you',
      'Reassigned by ' || coalesce((select full_name from public.profiles where id = auth.uid()), 'an admin'), '/leads');
  end if;
  return n;
end $$;

-- lead-assignment notifications stay quiet during a bulk reassign
create or replace function public._notify_lead_assigned()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if coalesce(current_setting('crm.bulk_reassign', true), 'off') = 'on' then return new; end if;
  if tg_op = 'INSERT' then
    if new.import_batch_id is null and new.source <> 'Calendly' then
      perform public.notify(new.rm_id, 'lead_assigned', 'New lead: ' || new.name,
        new.source || coalesce(' · ' || new.campaign, '') || ' · ' || new.product, '/leads/' || new.id);
    end if;
  elsif new.rm_id is distinct from old.rm_id then
    perform public.notify(new.rm_id, 'lead_assigned', 'Lead assigned to you: ' || new.name,
      'Reassigned by an admin', '/leads/' || new.id);
  end if;
  return new;
end $$;
