-- Argus · 0021: admins don't own leads; managers; lead routing
--
--  * Admins manage, they don't sell: never in the round-robin, never a lead's owner, and on a lead they
--    can only view, reassign and raise tasks (lead-changing functions refuse them).
--  * Each RM has one manager (an admin): profiles.manager_id.
--  * Routing: each RM can list languages, products and whether they take NRI leads; set a maximum of
--    open leads; or be on leave. A new lead goes to the RM next in turn who fits best, in this order:
--    not on leave → under their limit → handles the product → takes NRI (if NRI) → speaks a language
--    (if known). Someone who listed the product / language comes before someone who takes everything.
--    If nobody fits a rule, that rule is relaxed; a lead is never left unassigned.
--  * hand_over_leads: move all of someone's leads (e.g. an admin's) round-robin or to one RM, without
--    removing their access. remove_access uses it.

alter table public.profiles add column if not exists manager_id uuid references public.profiles(id) on delete set null;
alter table public.profiles add column if not exists route_languages text[] not null default '{}';
alter table public.profiles add column if not exists route_products text[] not null default '{}';   -- empty = all products
alter table public.profiles add column if not exists takes_nri boolean not null default true;
alter table public.profiles add column if not exists max_open_leads int check (max_open_leads is null or max_open_leads > 0);
alter table public.profiles add column if not exists on_leave boolean not null default false;

-- admins never sit in the round-robin; a manager must be an admin
create or replace function public._profiles_role_rules()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.role = 'admin' then new.in_rotation := false; end if;
  if new.manager_id is not null then
    if new.manager_id = new.id then raise exception 'Someone can''t manage themselves'; end if;
    if not exists (select 1 from public.profiles where id = new.manager_id and role = 'admin') then
      raise exception 'A manager must be an admin';
    end if;
  end if;
  return new;
end $$;
drop trigger if exists profiles_role_rules on public.profiles;
create trigger profiles_role_rules before insert or update on public.profiles
  for each row execute function public._profiles_role_rules();
update public.profiles set in_rotation = false where role = 'admin' and in_rotation;

-- ── routing ──
create or replace function public.next_rm_for(p_unit text, p_product text default null, p_languages text default null, p_nri boolean default false)
returns uuid language plpgsql security definer set search_path = public as $$
declare v uuid; langs text[] := case when nullif(btrim(coalesce(p_languages, '')), '') is null then '{}'::text[]
                                     else regexp_split_to_array(public.normalize_languages(p_languages), ', ') end;
begin
  select p.id into v
    from public.profiles p
   where p.is_active and p.in_rotation and p.team = 'Sales' and p.role <> 'admin' and p.unit = p_unit
   order by
     p.on_leave,                                                                   -- not on leave first
     (p.max_open_leads is not null and (select count(*) from public.leads l where l.rm_id = p.id
        and l.bucket::text in ('active_contact','awaiting_meeting','holding','deferred')) >= p.max_open_leads),  -- under limit
     (p_product is not null and cardinality(p.route_products) > 0 and not (p_product = any (p.route_products))), -- product
     (p_nri and not p.takes_nri),                                                  -- NRI
     (cardinality(langs) > 0 and cardinality(p.route_languages) > 0 and not (langs && p.route_languages)),   -- language
     (p_product is not null and cardinality(p.route_products) = 0),               -- then: someone who listed the product
     (cardinality(langs) > 0 and cardinality(p.route_languages) = 0),              --       or the language, over a generalist
     p.last_assigned_at asc nulls first, p.created_at asc
   limit 1
   for update of p skip locked;
  if v is null then
    -- nobody in rotation: keep it with whoever added it, unless that's an admin
    if exists (select 1 from public.profiles where id = auth.uid() and is_active and role <> 'admin') then
      v := auth.uid();
    else
      raise exception 'Nobody is in the round-robin to take this lead. Add an RM to rotation (Admin → Team & rotation) or assign it to someone.';
    end if;
  end if;
  update public.profiles set last_assigned_at = clock_timestamp() where id = v;
  return v;
end $$;
revoke execute on function public.next_rm_for(text, text, text, boolean) from anon, authenticated, public;

create or replace function public.next_rm(p_unit text default 'IQWM')
returns uuid language sql security definer set search_path = public as $$
  select public.next_rm_for(p_unit, null, null, false);
$$;
revoke execute on function public.next_rm(text) from anon, authenticated, public;

create or replace function public.create_lead(p jsonb)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_rm uuid; v_phone text; v_email text; v_unit text := coalesce(p->>'unit','IQWM');
begin
  if not public.is_staff() then raise exception 'Not signed in'; end if;
  v_phone := public.normalize_phone(p->>'phone');
  v_email := public.normalize_email(p->>'email');
  if nullif(p->>'phone','') is not null and v_phone is null then
    raise exception 'Phone number "%" is not valid', p->>'phone';
  end if;
  if v_phone is null and v_email is null then
    raise exception 'A phone number or email is required';
  end if;
  if exists (select 1 from public.leads where unit = v_unit and (phone = v_phone or email = v_email)) then
    raise exception 'DUPLICATE: a lead with this phone or email already exists';
  end if;

  if public.is_admin() and nullif(p->>'rm_id','') is not null then
    v_rm := (p->>'rm_id')::uuid;
    if not exists (select 1 from public.profiles where id = v_rm and is_active and role <> 'admin') then
      raise exception 'Leads can only be assigned to an active RM, not an admin';
    end if;
  else
    v_rm := public.next_rm_for(v_unit, public.normalize_product(p->>'product'), public.normalize_languages(p->>'language'),
                               coalesce(p->>'residency', '') = 'nri');
  end if;

  insert into public.leads (unit, name, phone, email, city, age, marital_status, income_band, language,
                            requirement, budget, product, source, campaign, referred_by,
                            next_follow_up, rm_id, import_batch_id, created_by)
  values (v_unit, btrim(p->>'name'), v_phone, v_email, nullif(p->>'city',''),
          nullif(p->>'age','')::int, nullif(p->>'marital_status',''), nullif(p->>'income_band',''),
          nullif(p->>'language',''), nullif(p->>'requirement',''), nullif(p->>'budget',''),
          p->>'product', p->>'source', nullif(p->>'campaign',''), nullif(p->>'referred_by',''),
          coalesce(nullif(p->>'next_follow_up','')::date, public.ist_today()),
          v_rm, nullif(p->>'import_batch_id','')::uuid, auth.uid())
  returning id into v_id;
  if p->>'residency' in ('resident','nri') then update public.leads set residency = p->>'residency' where id = v_id; end if;

  perform public.log_event(v_id, 'created', null, null,
    jsonb_build_object('via', case when p ? 'import_batch_id' then 'upload' else 'manual' end));
  perform public.log_event(v_id, 'assigned', null, v_rm::text);
  return v_id;
end $$;

-- ── admins: view, reassign, raise tasks only ──
create or replace function public.assert_lead_access(p_lead uuid)
returns public.leads language plpgsql security definer set search_path = public as $$
declare l public.leads;
begin
  select * into l from public.leads where id = p_lead for update;
  if not found then raise exception 'Lead not found'; end if;
  if public.is_admin() then
    raise exception 'Admins can view and reassign leads and raise tasks, but changes are made by the lead''s RM';
  end if;
  if l.rm_id <> auth.uid() then raise exception 'You do not have access to this lead'; end if;
  return l;
end $$;

create or replace function public.reassign_lead(p_lead uuid, p_rm uuid)
returns void language plpgsql security definer set search_path = public as $$
declare l public.leads;
begin
  if not public.is_admin() then raise exception 'Only an admin can reassign leads'; end if;
  select * into l from public.leads where id = p_lead for update;
  if not exists (select 1 from public.profiles where id = p_rm and is_active and role <> 'admin') then
    raise exception 'Leads can only be assigned to an active RM, not an admin';
  end if;
  update public.leads set rm_id = p_rm, updated_at = now() where id = p_lead;
  perform public.log_event(p_lead, 'assigned', l.rm_id::text, p_rm::text);
end $$;

create or replace function public.reassign_leads(p_leads uuid[], p_rm uuid)
returns int language plpgsql security definer set search_path = public as $$
declare n int;
begin
  if not public.is_admin() then raise exception 'Only an admin can reassign leads'; end if;
  if not exists (select 1 from public.profiles where id = p_rm and is_active and role <> 'admin') then
    raise exception 'Leads can only be assigned to an active RM, not an admin';
  end if;
  insert into public.lead_events (lead_id, kind, from_value, to_value, actor)
  select id, 'assigned', rm_id::text, p_rm::text, auth.uid() from public.leads where id = any (p_leads) and rm_id <> p_rm;
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

-- ── hand over all of someone's leads (without removing access) ──
create or replace function public.hand_over_leads(p_user uuid, p_mode text default 'rotation', p_to uuid default null, p_reason text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare who text; r record; v uuid; n int := 0; counts jsonb := '{}'::jsonb; k text;
begin
  if not public.is_admin() then raise exception 'Only an admin can hand over leads'; end if;
  select full_name into who from public.profiles where id = p_user;
  if not found then raise exception 'Unknown person'; end if;
  if p_mode not in ('rotation','person') then raise exception 'Choose how to hand over the leads'; end if;
  if p_mode = 'person' then
    if p_to is null or p_to = p_user or not exists (select 1 from public.profiles where id = p_to and is_active and role <> 'admin') then
      raise exception 'Pick an active RM to take over the leads';
    end if;
  elsif exists (
    select 1 from public.leads l
     where l.rm_id = p_user
       and not exists (select 1 from public.profiles p
                        where p.id <> p_user and p.is_active and p.in_rotation and p.team = 'Sales' and p.role <> 'admin' and p.unit = l.unit)) then
    raise exception 'Nobody else is in the round-robin to take these leads. Add someone to rotation, or give them all to one person.';
  end if;

  perform set_config('crm.bulk_reassign', 'on', true);
  for r in select id, unit, product, language, residency from public.leads where rm_id = p_user order by created_at loop
    v := case when p_mode = 'person' then p_to else public.next_rm_for(r.unit, r.product, r.language, r.residency = 'nri') end;
    insert into public.lead_events (lead_id, kind, from_value, to_value, detail, actor)
    values (r.id, 'assigned', p_user::text, v::text, jsonb_build_object('reason', coalesce(p_reason, 'Handed over from ' || coalesce(who, 'a colleague'))), auth.uid());
    update public.leads set rm_id = v, updated_at = now() where id = r.id;
    counts := jsonb_set(counts, array[v::text], to_jsonb(coalesce((counts->>v::text)::int, 0) + 1));
    n := n + 1;
  end loop;
  perform set_config('crm.bulk_reassign', 'off', true);

  for k in select jsonb_object_keys(counts) loop
    perform public.notify(k::uuid, 'lead_assigned',
      (counts->>k) || ' lead' || case when (counts->>k)::int = 1 then '' else 's' end || ' handed over to you',
      'From ' || coalesce(who, 'a colleague'), '/leads');
  end loop;
  return jsonb_build_object('moved', n, 'by_person', counts);
end $$;
revoke execute on function public.hand_over_leads(uuid, text, uuid, text) from anon, public;
grant execute on function public.hand_over_leads(uuid, text, uuid, text) to authenticated;

create or replace function public.remove_access(p_user uuid, p_mode text default 'rotation', p_to uuid default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare who text;
begin
  if not public.is_admin() then raise exception 'Only an admin can remove access'; end if;
  if p_user = auth.uid() then raise exception 'You can''t remove your own access'; end if;
  select full_name into who from public.profiles where id = p_user;
  if not found then raise exception 'Unknown person'; end if;
  -- out first, so the round-robin can never pick them
  update public.profiles set is_active = false, in_rotation = false where id = p_user;
  return public.hand_over_leads(p_user, p_mode, p_to, 'Access removed for ' || coalesce(who, 'a former RM'));
end $$;
