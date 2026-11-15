-- Flameback CRM · 0004: notifications, access requests, US RIA, task files, conversion report, Gmail
--
--  * Notifications: one table, filled by triggers and timed sweeps; each person reads only their own.
--  * Access requests: new sign-ups wait for an admin, who approves them as RM or Admin (or rejects).
--  * Products: RIA, PMS and US RIA.
--  * Task files: private storage bucket "task-files"; whoever can see the task can see its files.
--  * Conversion report: leads → contacted → met → committed / out, grouped by source, campaign, referrer, product or RM.
--  * Gmail: each RM's connection (server-side only) and the emails matched to their leads.

-- ═════════════ products ═════════════
alter table public.leads drop constraint if exists leads_product_check;
alter table public.leads add constraint leads_product_check check (product in ('RIA','PMS','US RIA'));
alter table public.import_batches drop constraint if exists import_batches_product_check;
alter table public.import_batches add constraint import_batches_product_check check (product is null or product in ('RIA','PMS','US RIA'));

-- "us ria", "US-RIA", "usria" → 'US RIA'; "ria" → 'RIA'; anything else → null
create or replace function public.normalize_product(p text)
returns text language sql immutable as $$
  select case regexp_replace(upper(coalesce(p,'')), '[^A-Z]', '', 'g')
           when 'RIA' then 'RIA' when 'PMS' then 'PMS' when 'USRIA' then 'US RIA' else null end
$$;

-- ═════════════ notifications ═════════════
create table public.notifications (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references public.profiles(id) on delete cascade,
  kind       text not null,
  title      text not null,
  body       text,
  link       text,            -- in-app path, e.g. /leads/<id>
  ref_key    text,            -- dedupe key for digests / reminders
  read_at    timestamptz,
  created_at timestamptz not null default now()
);
create unique index notifications_ref_uq on public.notifications (user_id, ref_key) where ref_key is not null;
create index notifications_user_idx on public.notifications (user_id, created_at desc);
alter table public.notifications enable row level security;
create policy notifications_read on public.notifications for select to authenticated using (user_id = auth.uid());
revoke insert, update, delete on public.notifications from anon, authenticated;

-- Send one notification. Never to yourself, never to someone without access.
-- With a ref_key, a repeat replaces the earlier one (used for digests and per-upload counts).
create or replace function public.notify(p_user uuid, p_kind text, p_title text, p_body text, p_link text,
                                         p_ref text default null, p_allow_self boolean default false)
returns void language plpgsql security definer set search_path = public as $$
begin
  if p_user is null or (p_user = auth.uid() and not p_allow_self) then return; end if;
  if not exists (select 1 from public.profiles where id = p_user and is_active) then return; end if;
  if p_ref is null then
    insert into public.notifications (user_id, kind, title, body, link) values (p_user, p_kind, p_title, p_body, p_link);
  else
    insert into public.notifications (user_id, kind, title, body, link, ref_key)
    values (p_user, p_kind, p_title, p_body, p_link, p_ref)
    on conflict (user_id, ref_key) where ref_key is not null
    do update set title = excluded.title, body = excluded.body, link = excluded.link, read_at = null, created_at = now();
  end if;
end $$;

create or replace function public.mark_notifications_read(p_ids uuid[] default null)
returns void language sql security definer set search_path = public as $$
  update public.notifications set read_at = now()
   where user_id = auth.uid() and read_at is null and (p_ids is null or id = any (p_ids));
$$;

-- live pop-ups (Supabase Realtime); harmless where Realtime isn't present
do $$ begin
  alter publication supabase_realtime add table public.notifications;
exception when others then raise notice 'realtime publication not available: %', sqlerrm;
end $$;

-- leads: assigned by hand or round-robin (uploads notify once per upload; Calendly notifies as a booking)
create or replace function public._notify_lead_assigned()
returns trigger language plpgsql security definer set search_path = public as $$
begin
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
create trigger leads_notify_assigned after insert or update of rm_id on public.leads
  for each row execute function public._notify_lead_assigned();

-- tasks: created / assigned / status / edited
create or replace function public._notify_task_event()
returns trigger language plpgsql security definer set search_path = public as $$
declare t public.tasks; who text; link text; u uuid;
begin
  select * into t from public.tasks where id = new.task_id;
  if not found then return new; end if;
  who := coalesce((select full_name from public.profiles where id = new.actor), 'Someone');
  link := '/tasks?task=' || t.id;
  if new.kind = 'created' then
    if t.assignee_id is not null then
      perform public.notify(t.assignee_id, 'task', 'New task: ' || t.title, 'From ' || who || ' (' || t.from_team || ')', link);
    else
      for u in select id from public.profiles where is_active and team = t.to_team loop
        perform public.notify(u, 'task', 'New task for ' || t.to_team || ': ' || t.title, 'From ' || who || ' (' || t.from_team || ')', link);
      end loop;
    end if;
  elsif new.kind = 'assigned' and new.to_value is not null
        -- the assignee already got "New task" when it was created with them
        and not exists (select 1 from public.task_events c where c.task_id = new.task_id and c.kind = 'created' and c.at = new.at) then
    perform public.notify(new.to_value::uuid, 'task', 'Task assigned to you: ' || t.title, 'By ' || who, link);
  elsif new.kind in ('status','edited') then
    for u in select distinct x from unnest(array[t.created_by, t.assignee_id]) x where x is not null loop
      perform public.notify(u, 'task',
        case when new.kind = 'status'
             then initcap(replace(new.to_value,'_',' ')) || ': ' || t.title
             else 'Task updated: ' || t.title end,
        who || case when new.kind = 'status' and new.detail ? 'reason' then ' · ' || (new.detail->>'reason')
                    when new.kind = 'status' then ' moved it'
                    else ' changed the ' || case new.detail->>'field' when 'due' then 'due date' when 'team' then 'team' when 'priority' then 'priority' else 'details' end end,
        link);
    end loop;
  end if;
  return new;
end $$;
create trigger task_events_notify after insert on public.task_events
  for each row execute function public._notify_task_event();

-- task comments: raiser, assignee and earlier commenters
create or replace function public._notify_task_comment()
returns trigger language plpgsql security definer set search_path = public as $$
declare t public.tasks; u uuid;
begin
  select * into t from public.tasks where id = new.task_id;
  for u in select distinct x from (
             select t.created_by as x union select t.assignee_id union
             select author from public.task_comments where task_id = new.task_id) s where x is not null loop
    if u <> new.author then
      perform public.notify(u, 'task', 'Comment on ' || t.title,
        coalesce((select full_name from public.profiles where id = new.author), 'Someone') || ': ' || left(new.body, 140),
        '/tasks?task=' || t.id);
    end if;
  end loop;
  return new;
end $$;
create trigger task_comments_notify after insert on public.task_comments
  for each row execute function public._notify_task_comment();

-- ═════════════ access requests ═════════════
alter table public.profiles add column if not exists approved_at timestamptz;
alter table public.profiles add column if not exists rejected_at timestamptz;
update public.profiles set approved_at = created_at where is_active and approved_at is null;

-- everyone can read their own profile (so a pending person sees "waiting for approval")
create policy profiles_self on public.profiles for select to authenticated using (id = auth.uid());

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
declare first_user boolean := not exists (select 1 from public.profiles); a uuid; v_name text;
begin
  if lower(coalesce(new.email,'')) not like '%@flamebackcapital.com' then
    raise exception 'Only flamebackcapital.com accounts can use Flameback CRM';
  end if;
  v_name := coalesce(new.raw_user_meta_data->>'full_name', new.raw_user_meta_data->>'name', split_part(new.email,'@',1));
  insert into public.profiles (id, email, full_name, avatar_url, role, is_active, in_rotation, approved_at)
  values (new.id, lower(new.email), v_name, new.raw_user_meta_data->>'avatar_url',
          case when first_user then 'admin' else 'rm' end,
          first_user, false, case when first_user then now() end);
  if not first_user then
    for a in select id from public.profiles where role = 'admin' and is_active loop
      perform public.notify(a, 'access_request', v_name || ' asked for access', lower(new.email), '/admin');
    end loop;
  end if;
  return new;
end $$;

create or replace function public.approve_user(p_user uuid, p_role text, p_in_rotation boolean default true)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'Only an admin can approve access'; end if;
  if p_role not in ('rm','admin') then raise exception 'Role must be RM or Admin'; end if;
  update public.profiles set is_active = true, role = p_role, team = 'Sales', approved_at = now(), rejected_at = null,
         in_rotation = coalesce(p_in_rotation, false)
   where id = p_user;
  if not found then raise exception 'Unknown person'; end if;
  perform public.notify(p_user, 'access_approved', 'Your access is approved',
    'You can now use Flameback CRM as ' || case when p_role = 'admin' then 'an Admin' else 'an RM' end || '.', '/');
end $$;

create or replace function public.reject_user(p_user uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'Only an admin can reject access'; end if;
  if p_user = auth.uid() then raise exception 'You cannot reject yourself'; end if;
  update public.profiles set is_active = false, in_rotation = false, rejected_at = now() where id = p_user;
end $$;

-- ═════════════ task files ═════════════
insert into storage.buckets (id, name, public, file_size_limit)
values ('task-files', 'task-files', false, 20971520)
on conflict (id) do nothing;

create table public.task_files (
  id          uuid primary key default gen_random_uuid(),
  task_id     uuid not null references public.tasks(id) on delete cascade,
  path        text not null unique,          -- <task id>/<random>-<file name> inside the bucket
  file_name   text not null,
  size_bytes  bigint,
  mime_type   text,
  uploaded_by uuid not null references public.profiles(id),
  created_at  timestamptz not null default now()
);
create index task_files_task_idx on public.task_files (task_id);
alter table public.task_files enable row level security;
create policy task_files_read on public.task_files for select to authenticated using (public.can_see_task(task_id));
revoke insert, update, delete on public.task_files from anon, authenticated;

create or replace function public.task_id_from_path(p text)
returns uuid language plpgsql immutable as $$
begin
  return split_part(p, '/', 1)::uuid;
exception when others then return null;
end $$;

create policy task_files_obj_read on storage.objects for select to authenticated
  using (bucket_id = 'task-files' and public.can_see_task(public.task_id_from_path(name)));
create policy task_files_obj_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'task-files' and public.can_see_task(public.task_id_from_path(name)));
create policy task_files_obj_delete on storage.objects for delete to authenticated
  using (bucket_id = 'task-files' and (public.is_admin()
         or exists (select 1 from public.task_files f where f.path = name and f.uploaded_by = auth.uid())));

-- record an uploaded file (after the browser has put it in storage)
create or replace function public.add_task_file(p_task uuid, p_path text, p_name text, p_size bigint, p_mime text)
returns uuid language plpgsql security definer set search_path = public as $$
declare v uuid; t public.tasks; u uuid;
begin
  if not public.can_see_task(p_task) then raise exception 'Task not found'; end if;
  if public.task_id_from_path(p_path) is distinct from p_task then raise exception 'File path does not belong to this task'; end if;
  insert into public.task_files (task_id, path, file_name, size_bytes, mime_type, uploaded_by)
  values (p_task, p_path, p_name, p_size, p_mime, auth.uid()) returning id into v;
  update public.tasks set updated_at = now() where id = p_task;
  select * into t from public.tasks where id = p_task;
  for u in select distinct x from unnest(array[t.created_by, t.assignee_id]) x where x is not null loop
    perform public.notify(u, 'task', 'File added to ' || t.title,
      coalesce((select full_name from public.profiles where id = auth.uid()), 'Someone') || ' added ' || p_name, '/tasks?task=' || t.id);
  end loop;
  return v;
end $$;

-- forget a file record (the browser also deletes it from storage)
create or replace function public.delete_task_file(p_id uuid)
returns text language plpgsql security definer set search_path = public as $$
declare f public.task_files;
begin
  select * into f from public.task_files where id = p_id;
  if not found or not (public.is_admin() or f.uploaded_by = auth.uid()) then raise exception 'Only the person who added it can remove this file'; end if;
  delete from public.task_files where id = p_id;
  return f.path;
end $$;

-- ═════════════ conversion report ═════════════
-- Runs with the caller's own permissions: an RM sees their leads, an admin sees everyone's.
create or replace function public.report_conversion(p_from date, p_to date, p_group text, p_rm uuid default null)
returns table (grp text, source_kind text, leads bigint, contacted bigint, met bigint, committed bigint, out_list bigint, still_open bigint)
language sql stable security invoker set search_path = public as $$
  with l as (
    select l.*,
           exists (select 1 from public.lead_entries e where e.lead_id = l.id) as has_entries,
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
         count(*) filter (where l.reached_meeting or l.bucket in ('holding','deferred','converting')) as met,
         count(*) filter (where l.bucket = 'converting' or l.converted_at is not null) as committed,
         count(*) filter (where l.bucket = 'out') as out_list,
         count(*) filter (where l.bucket in ('active_contact','awaiting_meeting','holding','deferred')) as still_open
    from l left join public.lead_sources s on s.name = l.source
   group by 1
   order by committed desc, leads desc;
$$;

-- ═════════════ Gmail ═════════════
alter table public.profiles add column if not exists gmail_address text;
alter table public.profiles add column if not exists gmail_connected_at timestamptz;

create table public.google_connections (       -- server-side only
  user_id       uuid primary key references public.profiles(id) on delete cascade,
  google_email  text not null,
  refresh_token text not null,
  connected_at  timestamptz not null default now(),
  last_sync_at  timestamptz
);
alter table public.google_connections enable row level security;
revoke all on public.google_connections from anon, authenticated;

create table public.gmail_messages (
  message_id text not null,
  user_id    uuid not null references public.profiles(id) on delete cascade,
  lead_id    uuid not null references public.leads(id) on delete cascade,
  thread_id  text,
  direction  text not null check (direction in ('in','out')),
  subject    text,
  sent_at    timestamptz not null,
  primary key (message_id, user_id)
);
create index gmail_messages_lead_idx on public.gmail_messages (lead_id, sent_at desc);
alter table public.gmail_messages enable row level security;
create policy gmail_messages_read on public.gmail_messages for select to authenticated
  using (user_id = auth.uid() or public.can_access_lead(lead_id));
revoke insert, update, delete on public.gmail_messages from anon, authenticated;

-- Called by the gmail edge function. Matches the other party's address to one of the RM's own leads.
-- p: message_id, thread_id, direction (in|out), counterpart (email), subject, body, sent_at
create or replace function public.apply_gmail_message(p_user uuid, p jsonb)
returns uuid language plpgsql security definer set search_path = public as $$
declare l public.leads; v_in boolean := p->>'direction' = 'in'; v_at timestamptz := (p->>'sent_at')::timestamptz;
begin
  if exists (select 1 from public.gmail_messages where message_id = p->>'message_id' and user_id = p_user) then return null; end if;
  select * into l from public.leads
   where email = public.normalize_email(p->>'counterpart') and (rm_id = p_user or nullif(p->>'lead_id','')::uuid = id)
   order by (rm_id = p_user) desc limit 1;
  if not found then return null; end if;

  insert into public.gmail_messages (message_id, user_id, lead_id, thread_id, direction, subject, sent_at)
  values (p->>'message_id', p_user, l.id, p->>'thread_id', p->>'direction', p->>'subject', v_at);

  insert into public.lead_entries (lead_id, kind, occurred_at, outcome, notes, bucket_at, strike_state, created_by)
  values (l.id, 'email', v_at, case when v_in then 'replied' else 'sent' end,
          left(coalesce('Subject: ' || nullif(p->>'subject','') || E'\n\n', '') || coalesce(p->>'body',''), 6000),
          l.bucket,
          case when not v_in and l.bucket = 'active_contact' then 'pending' else 'none' end,
          p_user);

  if v_in then
    update public.leads set last_contact_at = greatest(coalesce(last_contact_at, 'epoch'), v_at), updated_at = now() where id = l.id;
    if l.bucket = 'active_contact' then
      update public.leads set strikes = 0 where id = l.id;
      update public.lead_entries set strike_state = 'none' where lead_id = l.id and strike_state = 'pending';
    end if;
    if v_at > now() - interval '3 days' then
      perform public.notify(l.rm_id, 'email_reply', l.name || ' replied', coalesce(nullif(p->>'subject',''), '(no subject)'),
        '/leads/' || l.id, 'mail:' || (p->>'message_id'));
    end if;
  end if;
  return l.id;
end $$;


-- ═════════════ functions extended from earlier migrations ═════════════

create or replace function public.import_rows(p_batch uuid, p_rows jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  b public.import_batches; r jsonb; rr record; v_id uuid; v_dup uuid; v_dup_rm uuid; v_rm uuid;
  v_payload jsonb; out jsonb := '[]'::jsonb;
  c_ins int := 0; c_mer int := 0; c_skip int := 0; c_fail int := 0;
begin
  select * into b from public.import_batches where id = p_batch;
  if not found or (b.uploaded_by <> auth.uid() and not public.is_admin()) then
    raise exception 'Upload not found';
  end if;

  for r in select * from jsonb_array_elements(p_rows) loop
    begin
      v_payload := r
        || jsonb_build_object(
             'source',   coalesce(nullif(r->>'source',''), b.source),
             'campaign', coalesce(nullif(r->>'campaign',''), b.campaign),
             'product',  coalesce(public.normalize_product(r->>'product'), b.product),
             'import_batch_id', p_batch);

      if coalesce(btrim(v_payload->>'name'),'') = '' then raise exception 'Name is missing'; end if;
      if (v_payload->>'product') is null or (v_payload->>'product') not in ('RIA','PMS','US RIA') then
        raise exception 'Product must be RIA, PMS or US RIA';
      end if;
      if not exists (select 1 from public.lead_sources where name = v_payload->>'source') then
        raise exception 'Unknown source "%"', v_payload->>'source';
      end if;
      if nullif(v_payload->>'phone','') is not null and public.normalize_phone(v_payload->>'phone') is null then
        raise exception 'Phone "%" is not valid', v_payload->>'phone';
      end if;

      select id, rm_id into v_dup, v_dup_rm from public.leads
       where unit = b.unit
         and ( (public.normalize_phone(v_payload->>'phone') is not null and phone = public.normalize_phone(v_payload->>'phone'))
            or (public.normalize_email(v_payload->>'email') is not null and email = public.normalize_email(v_payload->>'email')) )
       limit 1;

      if v_dup is not null then
        if b.dup_mode = 'merge' and (public.is_admin() or v_dup_rm = auth.uid()) then
          perform public.merge_into_lead(v_dup, v_payload, 'Merged from upload ' || b.file_name);
          c_mer := c_mer + 1;
          out := out || jsonb_build_object('row', r->'row', 'status', 'merged', 'lead_id', v_dup);
        else
          c_skip := c_skip + 1;
          out := out || jsonb_build_object('row', r->'row', 'status', 'skipped', 'lead_id', v_dup,
                 'message', 'Already exists' ||
                   coalesce(' (with ' || (select full_name from public.profiles where id = v_dup_rm) || ')', ''));
        end if;
        continue;
      end if;

      -- optional RM column (admins only): match by email
      v_rm := null;
      if public.is_admin() and nullif(r->>'rm_email','') is not null then
        select id into v_rm from public.profiles where email = lower(btrim(r->>'rm_email')) and is_active;
        if v_rm is null then raise exception 'No active RM with email %', r->>'rm_email'; end if;
        v_payload := v_payload || jsonb_build_object('rm_id', v_rm);
      end if;

      v_id := public.create_lead(v_payload);
      c_ins := c_ins + 1;
      out := out || jsonb_build_object('row', r->'row', 'status', 'inserted', 'lead_id', v_id);
    exception when others then
      c_fail := c_fail + 1;
      out := out || jsonb_build_object('row', r->'row', 'status', 'failed', 'message', sqlerrm);
    end;
  end loop;

  update public.import_batches set inserted = inserted + c_ins, merged = merged + c_mer,
         skipped = skipped + c_skip, failed = failed + c_fail
   where id = p_batch;

  -- one notification per RM per upload (updated as more chunks arrive)
  for rr in select rm_id, count(*) as n from public.leads where import_batch_id = p_batch group by rm_id loop
    perform public.notify(rr.rm_id, 'lead_assigned',
      rr.n || ' new lead' || case when rr.n = 1 then '' else 's' end || ' assigned to you',
      'From the upload ' || b.file_name, '/leads', 'import:' || p_batch);
  end loop;
  return out;
end $$;

create or replace function public.run_sweeps()
returns jsonb language plpgsql security definer set search_path = public as $$
declare r record; n_strikes int := 0; n_deferred int := 0;
begin
  -- 1. Messages sent >48h ago with no reply become strikes.
  for r in
    update public.lead_entries e set strike_state = 'counted'
      from public.leads l
     where e.lead_id = l.id and e.strike_state = 'pending'
       and e.occurred_at < now() - interval '48 hours'
       and l.bucket = 'active_contact'
    returning e.lead_id
  loop
    perform public._add_strike(r.lead_id);
    n_strikes := n_strikes + 1;
  end loop;
  -- pending strikes on leads that already moved on are void
  update public.lead_entries e set strike_state = 'none'
    from public.leads l
   where e.lead_id = l.id and e.strike_state = 'pending' and l.bucket <> 'active_contact';

  -- 2. Deferred leads whose date has come return to Holding.
  for r in select id, deferred_until from public.leads
            where bucket = 'deferred' and deferred_until <= public.ist_today()
  loop
    perform public._move(r.id, 'holding', 'Deferred date reached');
    update public.leads set next_follow_up = r.deferred_until where id = r.id;
    n_deferred := n_deferred + 1;
  end loop;

  perform public.run_notification_sweeps();
  return jsonb_build_object('strikes', n_strikes, 'deferred_returned', n_deferred);
end $$;

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
            coalesce(public.normalize_product(p->>'product'), 'RIA'),
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

  perform public.notify(p_rm, 'meeting_booked', 'Meeting booked: ' || (select name from public.leads where id = v_lead),
    v_when || ' IST' || coalesce(' · ' || nullif(p->>'event_name',''), ''), '/leads/' || v_lead, 'cal:' || (p->>'invitee_uri'));
  if (select rm_id from public.leads where id = v_lead) <> p_rm then
    perform public.notify((select rm_id from public.leads where id = v_lead), 'meeting_booked',
      'Meeting booked: ' || (select name from public.leads where id = v_lead),
      v_when || ' IST · on a colleague''s Calendly', '/leads/' || v_lead, 'cal:' || (p->>'invitee_uri'));
  end if;
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
  if not p_rescheduled then
    perform public.notify(l.rm_id, 'meeting_canceled', 'Meeting cancelled: ' || l.name,
      coalesce(nullif(btrim(p_reason),''), 'Cancelled in Calendly'), '/leads/' || l.id, 'calx:' || p_invitee_uri);
  end if;
  -- only clear the meeting if it is still this booking's time (a reschedule may already have set a new one)
  if not p_rescheduled and l.bucket = 'awaiting_meeting' and l.meeting_at = e.start_time then
    update public.leads set meeting_at = null, meeting_url = null, next_follow_up = public.ist_today(), updated_at = now()
     where id = e.lead_id;
  end if;
  return e.lead_id;
end $$;


-- ═════════════ timed notifications (called by run_sweeps every 15 minutes) ═════════════
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
        from public.profiles p where p.is_active
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
end $$;

-- ═════════════ permissions ═════════════
revoke execute on function public.notify(uuid, text, text, text, text, text, boolean),
                           public.apply_gmail_message(uuid, jsonb),
                           public.run_notification_sweeps()
  from anon, authenticated, public;
grant execute on function public.apply_gmail_message(uuid, jsonb) to service_role;
