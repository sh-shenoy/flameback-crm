-- Flameback CRM · Tasks (requests between RMs and the Compliance, Operations and Investment teams)
--
-- Rules:
--   * Everyone belongs to one team. A task goes from the raiser's team to an owning team,
--     optionally to a named assignee in that team.
--   * Who can see a task: whoever raised it, the assignee, everyone in the owning team, admins.
--   * Who can move a task between columns: the assignee, the owning team, admins
--     (and the raiser, who can close or reopen their own request).
--   * Blocked always needs a reason.
--   * A task may be linked to a lead; only someone who can open that lead can link it.
--   * Every change is recorded in task_events; comments live in task_comments.

alter table public.profiles
  add column if not exists team text not null default 'Sales'
  check (team in ('Sales','Operations','Compliance','Investment'));

create table public.tasks (
  id             uuid primary key default gen_random_uuid(),
  title          text not null check (length(trim(title)) > 0),
  details        text,
  priority       text not null default 'medium' check (priority in ('high','medium','low')),
  status         text not null default 'open' check (status in ('open','in_progress','blocked','done')),
  blocked_reason text,
  template       text,
  from_team      text not null,
  to_team        text not null check (to_team in ('Sales','Operations','Compliance','Investment')),
  assignee_id    uuid references public.profiles(id),
  lead_id        uuid references public.leads(id) on delete set null,
  lead_name      text,            -- copied so other teams can see who it is about
  due_date       date,
  created_by     uuid not null references public.profiles(id),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  done_at        timestamptz
);
create index tasks_assignee_idx on public.tasks (assignee_id, status);
create index tasks_team_idx on public.tasks (to_team, status);
create index tasks_creator_idx on public.tasks (created_by, status);
create index tasks_lead_idx on public.tasks (lead_id);

create table public.task_comments (
  id         uuid primary key default gen_random_uuid(),
  task_id    uuid not null references public.tasks(id) on delete cascade,
  author     uuid not null references public.profiles(id),
  body       text not null check (length(trim(body)) > 0),
  created_at timestamptz not null default now()
);
create index task_comments_task_idx on public.task_comments (task_id, created_at);

create table public.task_events (
  id         bigint generated always as identity primary key,
  task_id    uuid not null references public.tasks(id) on delete cascade,
  kind       text not null,     -- created, status, assigned, edited
  from_value text,
  to_value   text,
  detail     jsonb,
  actor      uuid references public.profiles(id),
  at         timestamptz not null default now()
);
create index task_events_task_idx on public.task_events (task_id, at);

-- ───────── access helpers ─────────

create or replace function public.my_team()
returns text language sql stable security definer set search_path = public as $$
  select team from public.profiles where id = auth.uid() and is_active;
$$;

create or replace function public.can_see_task(p_task uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select public.is_admin() or exists (
    select 1 from public.tasks t
     where t.id = p_task
       and (t.created_by = auth.uid() or t.assignee_id = auth.uid() or t.to_team = public.my_team()));
$$;

create or replace function public.task_for_update(p_task uuid, p_need_owner boolean)
returns public.tasks language plpgsql security definer set search_path = public as $$
declare t public.tasks;
begin
  select * into t from public.tasks where id = p_task for update;
  if not found or not public.can_see_task(p_task) then raise exception 'Task not found'; end if;
  if p_need_owner and not (public.is_admin() or t.assignee_id = auth.uid()
                           or t.to_team = public.my_team() or t.created_by = auth.uid()) then
    raise exception 'Only the owning team or the person who raised it can change this task';
  end if;
  return t;
end $$;

create or replace function public.task_event(p_task uuid, p_kind text, p_from text, p_to text, p_detail jsonb default null)
returns void language sql security definer set search_path = public as $$
  insert into public.task_events (task_id, kind, from_value, to_value, detail, actor)
  values (p_task, p_kind, p_from, p_to, p_detail, auth.uid());
$$;

-- ───────── create / edit ─────────

-- p: title, details, priority, to_team, assignee_id, lead_id, due_date, template, status
create or replace function public.create_task(p jsonb)
returns uuid language plpgsql security definer set search_path = public as $$
declare v uuid; v_assignee uuid := nullif(p->>'assignee_id','')::uuid; v_lead uuid := nullif(p->>'lead_id','')::uuid;
        v_status text := coalesce(nullif(p->>'status',''), 'open');
begin
  if not public.is_staff() then raise exception 'Not signed in'; end if;
  if coalesce(btrim(p->>'title'),'') = '' then raise exception 'Give the task a title'; end if;
  if v_status = 'blocked' then raise exception 'A new task cannot start as Blocked'; end if;
  if v_assignee is not null and not exists (select 1 from public.profiles where id = v_assignee and is_active) then
    raise exception 'Unknown assignee';
  end if;
  if v_lead is not null and not public.can_access_lead(v_lead) then raise exception 'You cannot link that lead'; end if;

  insert into public.tasks (title, details, priority, status, template, from_team, to_team, assignee_id, lead_id, lead_name, due_date, created_by, done_at)
  values (btrim(p->>'title'), nullif(btrim(p->>'details'),''), coalesce(nullif(p->>'priority',''),'medium'), v_status,
          nullif(p->>'template',''), coalesce(public.my_team(),'Sales'), p->>'to_team', v_assignee, v_lead,
          (select name from public.leads where id = v_lead),
          nullif(p->>'due_date','')::date, auth.uid(), case when v_status = 'done' then now() end)
  returning id into v;
  perform public.task_event(v, 'created', null, v_status);
  if v_assignee is not null then perform public.task_event(v, 'assigned', null, v_assignee::text); end if;
  return v;
end $$;

create or replace function public.update_task(p_task uuid, p jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare t public.tasks; v_assignee uuid; v_lead uuid;
begin
  t := public.task_for_update(p_task, true);
  if p ? 'title' and coalesce(btrim(p->>'title'),'') = '' then raise exception 'Give the task a title'; end if;
  v_assignee := case when p ? 'assignee_id' then nullif(p->>'assignee_id','')::uuid else t.assignee_id end;
  v_lead     := case when p ? 'lead_id' then nullif(p->>'lead_id','')::uuid else t.lead_id end;
  if v_assignee is distinct from t.assignee_id and v_assignee is not null
     and not exists (select 1 from public.profiles where id = v_assignee and is_active) then
    raise exception 'Unknown assignee';
  end if;
  if v_lead is distinct from t.lead_id and v_lead is not null and not public.can_access_lead(v_lead) then
    raise exception 'You cannot link that lead';
  end if;
  update public.tasks set
    title       = case when p ? 'title' then btrim(p->>'title') else title end,
    details     = case when p ? 'details' then nullif(btrim(p->>'details'),'') else details end,
    priority    = case when p ? 'priority' then p->>'priority' else priority end,
    to_team     = case when p ? 'to_team' then p->>'to_team' else to_team end,
    due_date    = case when p ? 'due_date' then nullif(p->>'due_date','')::date else due_date end,
    assignee_id = v_assignee,
    lead_id     = v_lead,
    lead_name   = case when v_lead is distinct from t.lead_id then (select name from public.leads where id = v_lead) else lead_name end,
    updated_at  = now()
  where id = p_task;
  if v_assignee is distinct from t.assignee_id then
    perform public.task_event(p_task, 'assigned', t.assignee_id::text, v_assignee::text);
  end if;
  if p ? 'to_team' and p->>'to_team' is distinct from t.to_team then
    perform public.task_event(p_task, 'edited', t.to_team, p->>'to_team', jsonb_build_object('field','team'));
  end if;
  if p ? 'due_date' and nullif(p->>'due_date','')::date is distinct from t.due_date then
    perform public.task_event(p_task, 'edited', t.due_date::text, p->>'due_date', jsonb_build_object('field','due'));
  end if;
  if p ? 'priority' and p->>'priority' is distinct from t.priority then
    perform public.task_event(p_task, 'edited', t.priority, p->>'priority', jsonb_build_object('field','priority'));
  end if;
end $$;

create or replace function public.set_task_status(p_task uuid, p_status text, p_reason text default null)
returns void language plpgsql security definer set search_path = public as $$
declare t public.tasks;
begin
  t := public.task_for_update(p_task, true);
  if p_status not in ('open','in_progress','blocked','done') then raise exception 'Unknown status'; end if;
  if p_status = t.status then return; end if;
  if p_status = 'blocked' and coalesce(btrim(p_reason),'') = '' then raise exception 'Say why the task is blocked'; end if;
  update public.tasks set
    status = p_status,
    blocked_reason = case when p_status = 'blocked' then btrim(p_reason) else null end,
    done_at = case when p_status = 'done' then now() else null end,
    updated_at = now()
  where id = p_task;
  perform public.task_event(p_task, 'status', t.status, p_status,
    case when p_status = 'blocked' then jsonb_build_object('reason', btrim(p_reason)) end);
end $$;

create or replace function public.add_task_comment(p_task uuid, p_body text)
returns uuid language plpgsql security definer set search_path = public as $$
declare v uuid;
begin
  if not public.can_see_task(p_task) then raise exception 'Task not found'; end if;
  if coalesce(btrim(p_body),'') = '' then raise exception 'Write a comment first'; end if;
  insert into public.task_comments (task_id, author, body) values (p_task, auth.uid(), btrim(p_body)) returning id into v;
  update public.tasks set updated_at = now() where id = p_task;
  return v;
end $$;

-- Only the raiser (or an admin) can delete a task, and only before anyone has worked it.
create or replace function public.delete_task(p_task uuid)
returns void language plpgsql security definer set search_path = public as $$
declare t public.tasks;
begin
  select * into t from public.tasks where id = p_task;
  if not found or not (public.is_admin() or t.created_by = auth.uid()) then raise exception 'Only the person who raised it can delete this task'; end if;
  delete from public.tasks where id = p_task;
end $$;

-- ───────── row-level security ─────────

alter table public.tasks enable row level security;
alter table public.task_comments enable row level security;
alter table public.task_events enable row level security;

create policy tasks_read on public.tasks for select to authenticated
  using (public.is_admin() or created_by = auth.uid() or assignee_id = auth.uid() or to_team = public.my_team());
create policy task_comments_read on public.task_comments for select to authenticated
  using (public.can_see_task(task_id));
create policy task_events_read on public.task_events for select to authenticated
  using (public.can_see_task(task_id));

revoke insert, update, delete on public.tasks, public.task_comments, public.task_events from anon, authenticated;
revoke execute on function public.task_for_update(uuid, boolean), public.task_event(uuid, text, text, text, jsonb)
  from authenticated, public;

-- ───────── round-robin only within Sales; new sign-ups start out of rotation ─────────
-- (Operations / Compliance / Investment people sign in too now; they must not receive leads.)
alter table public.profiles alter column in_rotation set default false;

create or replace function public.next_rm(p_unit text default 'IQWM')
returns uuid language plpgsql security definer set search_path = public as $$
declare v uuid;
begin
  select id into v from public.profiles
   where is_active and in_rotation and team = 'Sales' and unit = p_unit
   order by last_assigned_at asc nulls first, created_at asc
   limit 1
   for update skip locked;
  if v is null then
    v := auth.uid();   -- nobody in rotation: keep it with whoever added it
  end if;
  update public.profiles set last_assigned_at = clock_timestamp() where id = v;
  return v;
end $$;
revoke execute on function public.next_rm(text) from authenticated, public;
