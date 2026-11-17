-- Argus · 0018: prospects (agreed to join, being onboarded) and clients (funded)
--
--  Lead → Prospect → Client
--   * The stage that was "Converting" is now shown as Prospect: they agreed to join; onboarding runs here.
--   * New stage 'client': the prospect has funded their account (Mark as funded, with date and amount).
--   * leads.residency: Resident or NRI (decides which onboarding checklist applies).
--   * Joint holders: a prospect can have more people (e.g. a couple). Per-person checklist items repeat
--     for each holder.
--   * Onboarding checklist per prospect, created from admin-managed templates (product × residency)
--     when the lead becomes a prospect. The RM drives it and can add items; an item can be handed to
--     Operations ("Ask Ops"), which raises a task; when that task is done the item ticks itself.
--
-- Note: the new enum value can't be used inside this same transaction, so SQL here compares
-- bucket::text = 'client'; PL/pgSQL bodies only use it when they run, later.

alter type public.lead_bucket add value if not exists 'client';

alter table public.leads add column if not exists residency text check (residency in ('resident','nri'));
alter table public.leads add column if not exists funded_at date;
alter table public.leads add column if not exists funded_amount numeric(16,2) check (funded_amount is null or funded_amount >= 0);

-- ── joint holders ──
create table if not exists public.lead_holders (
  id         uuid primary key default gen_random_uuid(),
  lead_id    uuid not null references public.leads(id) on delete cascade,
  name       text not null,
  relation   text,
  created_at timestamptz not null default now()
);
create index if not exists lead_holders_lead_idx on public.lead_holders (lead_id);
alter table public.lead_holders enable row level security;
drop policy if exists lead_holders_read on public.lead_holders;
create policy lead_holders_read on public.lead_holders for select to authenticated using (public.can_access_lead(lead_id));
revoke insert, update, delete on public.lead_holders from anon, authenticated;

-- ── checklist templates (admins edit; the real lists come from Ops) ──
create table if not exists public.onboarding_templates (
  id         uuid primary key default gen_random_uuid(),
  product    text not null,                                   -- RIA | PMS | US RIA
  residency  text not null check (residency in ('resident','nri')),
  title      text not null,
  owner      text not null default 'rm' check (owner in ('rm','ops')),
  per_holder boolean not null default false,                  -- repeat for each joint holder (KYC etc.)
  sort_order int not null default 0,
  is_active  boolean not null default true,
  created_at timestamptz not null default now()
);
alter table public.onboarding_templates enable row level security;
drop policy if exists onboarding_templates_read on public.onboarding_templates;
create policy onboarding_templates_read on public.onboarding_templates for select to authenticated using (public.is_staff());
revoke insert, update, delete on public.onboarding_templates from anon, authenticated;

-- ── checklist items per prospect ──
create table if not exists public.onboarding_items (
  id             uuid primary key default gen_random_uuid(),
  lead_id        uuid not null references public.leads(id) on delete cascade,
  holder_id      uuid references public.lead_holders(id) on delete cascade,   -- null = main applicant / shared
  title          text not null,
  owner          text not null default 'rm' check (owner in ('rm','ops')),
  status         text not null default 'todo' check (status in ('todo','waiting','submitted','done','blocked')),
  blocked_reason text,
  due_date       date,
  notes          text,
  task_id        uuid references public.tasks(id) on delete set null,
  template_id    uuid references public.onboarding_templates(id) on delete set null,
  sort_order     int not null default 0,
  done_at        timestamptz,
  created_by     uuid references public.profiles(id),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create index if not exists onboarding_items_lead_idx on public.onboarding_items (lead_id, sort_order);
create index if not exists onboarding_items_task_idx on public.onboarding_items (task_id);
alter table public.onboarding_items enable row level security;
drop policy if exists onboarding_items_read on public.onboarding_items;
create policy onboarding_items_read on public.onboarding_items for select to authenticated using (public.can_access_lead(lead_id));
revoke insert, update, delete on public.onboarding_items from anon, authenticated;

-- ── stage moves: Prospect and Client have no follow-up date ──
create or replace function public._move(p_lead uuid, p_to public.lead_bucket, p_reason text default null)
returns void language plpgsql security definer set search_path = public as $$
declare l public.leads;
begin
  select * into l from public.leads where id = p_lead;
  if l.bucket = p_to then return; end if;
  update public.leads set
    bucket          = p_to,
    strikes         = 0,
    holding_step    = 0,
    out_reason      = case when p_to = 'out' then p_reason else null end,
    out_from_bucket = case when p_to = 'out' then l.bucket else null end,
    out_at          = case when p_to = 'out' then now() else null end,
    next_follow_up  = case when p_to::text in ('out','converting','client') then null
                           when p_to = 'holding' then public.ist_today() + public.holding_gap(0)
                           else next_follow_up end,
    meeting_at      = case when p_to = 'awaiting_meeting' then meeting_at else null end,
    deferred_until  = case when p_to = 'deferred' then deferred_until else null end,
    converted_at    = case when p_to = 'converting' then coalesce(converted_at, now())
                           when p_to::text = 'client' then coalesce(converted_at, now())
                           else converted_at end,
    funded_at       = case when p_to::text = 'client' then funded_at else null end,
    funded_amount   = case when p_to::text = 'client' then funded_amount else null end,
    updated_at      = now()
  where id = p_lead;
  perform public.log_event(p_lead, 'bucket', l.bucket::text, p_to::text,
    case when p_reason is not null then jsonb_build_object('reason', p_reason) end);
end $$;

-- ── create the checklist from templates ──
create or replace function public._seed_onboarding(p_lead uuid)
returns void language plpgsql security definer set search_path = public as $$
declare l public.leads; h record;
begin
  select * into l from public.leads where id = p_lead;
  if exists (select 1 from public.onboarding_items where lead_id = p_lead) then return; end if;
  -- main applicant (and shared items)
  insert into public.onboarding_items (lead_id, title, owner, template_id, sort_order, created_by)
  select p_lead, t.title, t.owner, t.id, t.sort_order, auth.uid()
    from public.onboarding_templates t
   where t.is_active and t.product = l.product and t.residency = coalesce(l.residency, 'resident');
  -- per-person items for each joint holder
  for h in select id from public.lead_holders where lead_id = p_lead loop
    perform public._seed_holder(p_lead, h.id);
  end loop;
end $$;

create or replace function public._seed_holder(p_lead uuid, p_holder uuid)
returns void language plpgsql security definer set search_path = public as $$
declare l public.leads;
begin
  select * into l from public.leads where id = p_lead;
  insert into public.onboarding_items (lead_id, holder_id, title, owner, template_id, sort_order, created_by)
  select p_lead, p_holder, t.title, t.owner, t.id, t.sort_order, auth.uid()
    from public.onboarding_templates t
   where t.is_active and t.per_holder and t.product = l.product and t.residency = coalesce(l.residency, 'resident')
     and not exists (select 1 from public.onboarding_items i where i.holder_id = p_holder and i.template_id = t.id);
end $$;

create or replace function public._leads_seed_onboarding()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.bucket::text = 'converting' and old.bucket::text is distinct from 'converting' then
    perform public._seed_onboarding(new.id);
  end if;
  return new;
end $$;
drop trigger if exists leads_seed_onboarding on public.leads;
create trigger leads_seed_onboarding after update of bucket on public.leads
  for each row execute function public._leads_seed_onboarding();

-- ── RM actions ──
-- add any checklist items from the current templates that this prospect doesn't have yet
-- (residency set later, or templates added after they became a prospect)
create or replace function public.load_onboarding_checklist(p_lead uuid)
returns int language plpgsql security definer set search_path = public as $$
declare l public.leads; n int; h record; before int;
begin
  l := public.assert_lead_access(p_lead);
  if l.bucket::text not in ('converting','client') then raise exception 'Only prospects have an onboarding checklist'; end if;
  select count(*) into before from public.onboarding_items where lead_id = p_lead;
  insert into public.onboarding_items (lead_id, title, owner, template_id, sort_order, created_by)
  select p_lead, t.title, t.owner, t.id, t.sort_order, auth.uid()
    from public.onboarding_templates t
   where t.is_active and t.product = l.product and t.residency = coalesce(l.residency, 'resident')
     and not exists (select 1 from public.onboarding_items i where i.lead_id = p_lead and i.holder_id is null and i.template_id = t.id);
  for h in select id from public.lead_holders where lead_id = p_lead loop
    perform public._seed_holder(p_lead, h.id);
  end loop;
  select count(*) - before into n from public.onboarding_items where lead_id = p_lead;
  return n;
end $$;

create or replace function public.set_residency(p_lead uuid, p_residency text)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform public.assert_lead_access(p_lead);
  if p_residency is not null and p_residency not in ('resident','nri') then raise exception 'Resident or NRI'; end if;
  update public.leads set residency = p_residency, updated_at = now() where id = p_lead;
end $$;

create or replace function public.add_holder(p_lead uuid, p_name text, p_relation text default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare v uuid; l public.leads;
begin
  l := public.assert_lead_access(p_lead);
  if coalesce(btrim(p_name), '') = '' then raise exception 'Give the holder a name'; end if;
  insert into public.lead_holders (lead_id, name, relation) values (p_lead, btrim(p_name), nullif(btrim(coalesce(p_relation, '')), ''))
  returning id into v;
  if l.bucket::text = 'converting' then perform public._seed_holder(p_lead, v); end if;
  return v;
end $$;

create or replace function public.remove_holder(p_holder uuid)
returns void language plpgsql security definer set search_path = public as $$
declare h public.lead_holders;
begin
  select * into h from public.lead_holders where id = p_holder;
  if not found then raise exception 'Holder not found'; end if;
  perform public.assert_lead_access(h.lead_id);
  delete from public.lead_holders where id = p_holder;           -- their checklist items go with them
end $$;

create or replace function public._onboarding_item_for_update(p_item uuid)
returns public.onboarding_items language plpgsql security definer set search_path = public as $$
declare i public.onboarding_items;
begin
  select * into i from public.onboarding_items where id = p_item;
  if not found then raise exception 'Checklist item not found'; end if;
  perform public.assert_lead_access(i.lead_id);
  return i;
end $$;

create or replace function public.add_onboarding_item(p_lead uuid, p_title text, p_owner text default 'rm', p_holder uuid default null, p_due date default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare v uuid;
begin
  perform public.assert_lead_access(p_lead);
  if coalesce(btrim(p_title), '') = '' then raise exception 'Name the item'; end if;
  if p_owner not in ('rm','ops') then raise exception 'Owner is RM or Ops'; end if;
  if p_holder is not null and not exists (select 1 from public.lead_holders where id = p_holder and lead_id = p_lead) then
    raise exception 'Unknown holder';
  end if;
  insert into public.onboarding_items (lead_id, holder_id, title, owner, due_date, sort_order, created_by)
  values (p_lead, p_holder, btrim(p_title), p_owner, p_due,
          coalesce((select max(sort_order) + 1 from public.onboarding_items where lead_id = p_lead), 0), auth.uid())
  returning id into v;
  return v;
end $$;

-- p keys: title, status, blocked_reason, due_date, notes, owner
create or replace function public.update_onboarding_item(p_item uuid, p jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare i public.onboarding_items; v_status text;
begin
  i := public._onboarding_item_for_update(p_item);
  v_status := coalesce(p->>'status', i.status);
  if v_status not in ('todo','waiting','submitted','done','blocked') then raise exception 'Unknown status'; end if;
  if v_status = 'blocked' and coalesce(btrim(coalesce(p->>'blocked_reason', i.blocked_reason)), '') = '' then
    raise exception 'Say what it is blocked on';
  end if;
  if p ? 'title' and coalesce(btrim(p->>'title'), '') = '' then raise exception 'Name the item'; end if;
  if p ? 'owner' and p->>'owner' not in ('rm','ops') then raise exception 'Owner is RM or Ops'; end if;
  update public.onboarding_items set
    title          = case when p ? 'title' then btrim(p->>'title') else title end,
    status         = v_status,
    blocked_reason = case when v_status = 'blocked' then btrim(coalesce(p->>'blocked_reason', blocked_reason)) else null end,
    due_date       = case when p ? 'due_date' then nullif(p->>'due_date', '')::date else due_date end,
    notes          = case when p ? 'notes' then nullif(btrim(p->>'notes'), '') else notes end,
    owner          = case when p ? 'owner' then p->>'owner' else owner end,
    done_at        = case when v_status = 'done' then coalesce(done_at, now()) else null end,
    updated_at     = now()
  where id = p_item;
end $$;

create or replace function public.delete_onboarding_item(p_item uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform public._onboarding_item_for_update(p_item);
  delete from public.onboarding_items where id = p_item;
end $$;

-- Hand an item to Operations: raises a task linked to the lead; the item follows the task.
create or replace function public.ask_ops(p_item uuid, p_details text default null, p_due date default null, p_assignee uuid default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare i public.onboarding_items; l public.leads; who text; v uuid;
begin
  i := public._onboarding_item_for_update(p_item);
  if i.task_id is not null and exists (select 1 from public.tasks where id = i.task_id and status <> 'done') then
    raise exception 'Operations already has a task for this item';
  end if;
  select * into l from public.leads where id = i.lead_id;
  select name into who from public.lead_holders where id = i.holder_id;
  v := public.create_task(jsonb_build_object(
    'title', i.title || ' · ' || coalesce(who, l.name),
    'details', concat_ws(E'\n\n', 'Onboarding for ' || l.name || ' (' || l.product || coalesce(', ' || upper(l.residency), '') || ').',
                         nullif(btrim(coalesce(p_details, '')), ''), i.notes),
    'to_team', 'Operations',
    'assignee_id', p_assignee,
    'lead_id', i.lead_id,
    'due_date', coalesce(p_due, i.due_date),
    'priority', 'medium'));
  update public.onboarding_items set owner = 'ops', task_id = v,
         status = case when status in ('todo','blocked') then 'submitted' else status end,
         blocked_reason = null, updated_at = now()
   where id = p_item;
  return v;
end $$;

-- when Ops finishes (or reopens) the task, the checklist item follows
create or replace function public._tasks_onboarding_sync()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.status = 'done' and old.status <> 'done' then
    update public.onboarding_items set status = 'done', done_at = now(), blocked_reason = null, updated_at = now()
     where task_id = new.id and status <> 'done';
  elsif old.status = 'done' and new.status <> 'done' then
    update public.onboarding_items set status = 'submitted', done_at = null, updated_at = now()
     where task_id = new.id and status = 'done';
  end if;
  return new;
end $$;
drop trigger if exists tasks_onboarding_sync on public.tasks;
create trigger tasks_onboarding_sync after update of status on public.tasks
  for each row execute function public._tasks_onboarding_sync();

-- ── funded → Client ──
create or replace function public.mark_funded(p_lead uuid, p_date date, p_amount numeric default null)
returns void language plpgsql security definer set search_path = public as $$
declare l public.leads;
begin
  l := public.assert_lead_access(p_lead);
  if l.bucket::text <> 'converting' then raise exception 'Only a prospect can be marked as funded'; end if;
  if p_date is null then raise exception 'When did the funds arrive?'; end if;
  if p_date > public.ist_today() then raise exception 'The funding date can''t be in the future'; end if;
  if p_amount is not null and p_amount < 0 then raise exception 'Amount can''t be negative'; end if;
  perform public._move(p_lead, 'client', 'Funded');
  update public.leads set funded_at = p_date, funded_amount = p_amount where id = p_lead;
end $$;

create or replace function public.undo_funded(p_lead uuid)
returns void language plpgsql security definer set search_path = public as $$
declare l public.leads;
begin
  l := public.assert_lead_access(p_lead);
  if l.bucket::text <> 'client' then raise exception 'This lead isn''t a client'; end if;
  perform public._move(p_lead, 'converting', 'Funding undone');
end $$;

-- ── templates (admins) ──
-- p keys: product, residency, title, owner, per_holder, sort_order, is_active
create or replace function public.save_onboarding_template(p_id uuid, p jsonb)
returns uuid language plpgsql security definer set search_path = public as $$
declare v uuid := p_id;
begin
  if not public.is_admin() then raise exception 'Only an admin can edit checklists'; end if;
  if v is null then
    if coalesce(btrim(p->>'title'), '') = '' then raise exception 'Name the item'; end if;
    insert into public.onboarding_templates (product, residency, title, owner, per_holder, sort_order)
    values (public.normalize_product(p->>'product'), p->>'residency', btrim(p->>'title'), coalesce(p->>'owner', 'rm'),
            coalesce((p->>'per_holder')::boolean, false),
            coalesce((p->>'sort_order')::int, (select coalesce(max(sort_order) + 1, 0) from public.onboarding_templates
                                                where product = public.normalize_product(p->>'product') and residency = p->>'residency')))
    returning id into v;
  else
    update public.onboarding_templates set
      title      = case when p ? 'title' then btrim(p->>'title') else title end,
      owner      = coalesce(p->>'owner', owner),
      per_holder = coalesce((p->>'per_holder')::boolean, per_holder),
      sort_order = coalesce((p->>'sort_order')::int, sort_order),
      is_active  = coalesce((p->>'is_active')::boolean, is_active)
    where id = v;
    if not found then raise exception 'Checklist item not found'; end if;
  end if;
  return v;
end $$;

create or replace function public.delete_onboarding_template(p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'Only an admin can edit checklists'; end if;
  delete from public.onboarding_templates where id = p_id;    -- items already on prospects stay
end $$;

-- ── Change stage can't skip funding ──
create or replace function public._guard_client_stage()
returns trigger language plpgsql as $$
begin
  if new.bucket::text = 'client' and old.bucket::text <> 'client' and old.bucket::text <> 'converting' then
    raise exception 'Only a prospect can become a client (Mark as funded)';
  end if;
  return new;
end $$;
drop trigger if exists leads_guard_client on public.leads;
create trigger leads_guard_client before update of bucket on public.leads
  for each row execute function public._guard_client_stage();

-- ── report: Prospect and Client stages ──
drop function if exists public.report_conversion(date, date, text, uuid);
create or replace function public.report_conversion(p_from date, p_to date, p_group text, p_rm uuid default null)
returns table (grp text, source_kind text, leads bigint, contacted bigint, interested bigint, met bigint,
               committed bigint, clients bigint, funded_amount numeric, out_list bigint, still_open bigint)
language sql stable security invoker set search_path = public as $$
  with l as (
    select l.*,
           exists (select 1 from public.lead_entries e where e.lead_id = l.id) as has_entries,
           exists (select 1 from public.lead_events v where v.lead_id = l.id and v.kind = 'bucket'
                     and v.to_value in ('awaiting_meeting','holding','deferred','converting','client')) as reached_interest,
           exists (select 1 from public.lead_events v where v.lead_id = l.id and v.kind = 'bucket'
                     and v.to_value in ('holding','deferred','converting','client')) as reached_meeting
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
         count(*) filter (where l.has_entries or l.bucket::text <> 'active_contact') as contacted,
         count(*) filter (where l.reached_interest or l.reached_meeting or l.bucket::text in ('awaiting_meeting','holding','deferred','converting','client')) as interested,
         count(*) filter (where l.reached_meeting or l.bucket::text in ('holding','deferred','converting','client')) as met,
         count(*) filter (where l.bucket::text in ('converting','client') or l.converted_at is not null) as committed,
         count(*) filter (where l.bucket::text = 'client') as clients,
         coalesce(sum(l.funded_amount) filter (where l.bucket::text = 'client'), 0) as funded_amount,
         count(*) filter (where l.bucket::text = 'out') as out_list,
         count(*) filter (where l.bucket::text in ('active_contact','awaiting_meeting','holding','deferred')) as still_open
    from l left join public.lead_sources s on s.name = l.source
   group by 1
   order by committed desc, leads desc;
$$;

revoke execute on function public._seed_onboarding(uuid), public._seed_holder(uuid, uuid),
  public._onboarding_item_for_update(uuid) from anon, authenticated, public;
