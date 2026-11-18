-- Argus · 0030: duplicate leads in an upload go to the manager
--
-- When someone uploads a person who is already another RM's lead, the row is skipped as before, but a
-- conflict is recorded: the uploader is told, and their manager (or the admins, if they have none) gets
-- "Duplicate leads to resolve". On Admin → Duplicates the manager keeps the lead with its current RM
-- or gives it to the uploader; both RMs are told. Duplicate checks also look at secondary numbers.

create table if not exists public.lead_conflicts (
  id           uuid primary key default gen_random_uuid(),
  lead_id      uuid not null references public.leads(id) on delete cascade,
  batch_id     uuid references public.import_batches(id) on delete set null,
  owner_id     uuid references public.profiles(id),            -- held the lead when it was found
  claimant_id  uuid references public.profiles(id),            -- would have got it from the upload
  raised_by    uuid references public.profiles(id),
  row_data     jsonb,
  status       text not null default 'open' check (status in ('open','kept','moved')),
  resolved_by  uuid references public.profiles(id),
  resolved_at  timestamptz,
  created_at   timestamptz not null default now()
);
create unique index if not exists lead_conflicts_open_uq on public.lead_conflicts (lead_id, claimant_id) where status = 'open';
alter table public.lead_conflicts enable row level security;
drop policy if exists lead_conflicts_read on public.lead_conflicts;
create policy lead_conflicts_read on public.lead_conflicts for select to authenticated
  using (public.is_admin() or claimant_id = auth.uid() or owner_id = auth.uid());
revoke insert, update, delete on public.lead_conflicts from anon, authenticated;

create or replace function public.import_rows(p_batch uuid, p_rows jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  b public.import_batches; r jsonb; rr record; v_id uuid; v_dup uuid; v_dup_rm uuid; v_rm uuid;
  v_payload jsonb; out jsonb := '[]'::jsonb;
  c_ins int := 0; c_mer int := 0; c_skip int := 0; c_fail int := 0;
  v_claim uuid; v_conf boolean; c_conf int := 0; v_mgr uuid;
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
         and ( (public.normalize_phone(v_payload->>'phone') is not null and public.normalize_phone(v_payload->>'phone') in (phone, alt_phone))
            or (public.normalize_phone(v_payload->>'alt_phone') is not null and public.normalize_phone(v_payload->>'alt_phone') in (phone, alt_phone))
            or (public.normalize_email(v_payload->>'email') is not null and email = public.normalize_email(v_payload->>'email')) )
       limit 1;

      if v_dup is not null then
        -- already someone else's lead: the manager decides who keeps it
        v_claim := coalesce(nullif(r->>'rm_id', '')::uuid, b.uploaded_by);
        v_conf := v_dup_rm is distinct from v_claim
                  and exists (select 1 from public.profiles where id = v_claim and role <> 'admin');
        if v_conf then
          insert into public.lead_conflicts (lead_id, batch_id, owner_id, claimant_id, raised_by, row_data)
          values (v_dup, p_batch, v_dup_rm, v_claim, auth.uid(),
                  jsonb_strip_nulls(jsonb_build_object('name', v_payload->>'name', 'phone', v_payload->>'phone', 'email', v_payload->>'email',
                    'source', v_payload->>'source', 'campaign', v_payload->>'campaign', 'product', v_payload->>'product', 'file', b.file_name)))
          on conflict do nothing;
          c_conf := c_conf + 1;
        end if;
        if b.dup_mode = 'merge' and (public.is_admin() or v_dup_rm = auth.uid()) then
          perform public.merge_into_lead(v_dup, v_payload, 'Merged from upload ' || b.file_name);
          c_mer := c_mer + 1;
          out := out || jsonb_build_object('row', r->'row', 'status', 'merged', 'lead_id', v_dup);
        else
          c_skip := c_skip + 1;
          out := out || jsonb_build_object('row', r->'row', 'status', 'skipped', 'lead_id', v_dup,
                 'message', 'Already exists' ||
                   coalesce(' (with ' || (select full_name from public.profiles where id = v_dup_rm) || ')', '') ||
                   case when v_conf then ': sent to the manager to decide who keeps it' else '' end);
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

  -- duplicates held by other RMs: tell the uploader, and the manager(s) who decide
  if c_conf > 0 then
    perform public.notify(b.uploaded_by, 'duplicate',
      c_conf || ' lead' || case when c_conf = 1 then ' in your upload is' else 's in your upload are' end || ' already with another RM',
      'Your manager will decide who keeps ' || case when c_conf = 1 then 'it' else 'them' end || '. Upload: ' || b.file_name, '/upload',
      'conflict-up:' || p_batch, true);
    for v_mgr in
      select distinct coalesce(p.manager_id, a.id) from public.lead_conflicts c
        join public.profiles p on p.id = c.claimant_id
        left join public.profiles a on p.manager_id is null and a.role = 'admin' and a.is_active
       where c.batch_id = p_batch and c.status = 'open'
    loop
      if v_mgr is not null then
        perform public.notify(v_mgr, 'duplicate', 'Duplicate leads to resolve',
          (select count(*) from public.lead_conflicts c where c.batch_id = p_batch and c.status = 'open') || ' from the upload ' || b.file_name || ' are already with other RMs. Decide who keeps them.',
          '/admin?tab=duplicates', 'conflict:' || p_batch, true);
      end if;
    end loop;
  end if;

  -- one notification per RM per upload (updated as more chunks arrive)
  for rr in select rm_id, count(*) as n from public.leads where import_batch_id = p_batch group by rm_id loop
    perform public.notify(rr.rm_id, 'lead_assigned',
      rr.n || ' new lead' || case when rr.n = 1 then '' else 's' end || ' assigned to you',
      'From the upload ' || b.file_name, '/leads', 'import:' || p_batch);
  end loop;
  return out;
end $$;

-- manager: keep the lead with its RM, or give it to someone (normally the uploader)
create or replace function public.resolve_conflict(p_conflict uuid, p_give_to uuid)
returns void language plpgsql security definer set search_path = public as $$
declare c public.lead_conflicts; l public.leads; nm text; who text;
begin
  if not public.is_admin() then raise exception 'Only an admin can resolve duplicates'; end if;
  select * into c from public.lead_conflicts where id = p_conflict for update;
  if not found or c.status <> 'open' then raise exception 'This duplicate is already resolved'; end if;
  select * into l from public.leads where id = c.lead_id;
  if l.rm_id <> p_give_to then perform public.reassign_lead(c.lead_id, p_give_to); end if;
  update public.lead_conflicts set status = case when p_give_to = l.rm_id then 'kept' else 'moved' end,
         resolved_by = auth.uid(), resolved_at = now()
   where id = p_conflict;
  -- other open conflicts on this lead are settled by the same decision
  update public.lead_conflicts set status = 'kept', resolved_by = auth.uid(), resolved_at = now()
   where lead_id = c.lead_id and status = 'open' and id <> p_conflict;
  nm := l.name;
  select full_name into who from public.profiles where id = p_give_to;
  perform public.notify(c.claimant_id, 'duplicate',
    case when p_give_to = c.claimant_id then nm || ' is now yours' else nm || ' stays with ' || coalesce(who, 'its RM') end,
    'Duplicate from your upload, decided by ' || coalesce((select full_name from public.profiles where id = auth.uid()), 'your manager'),
    '/leads/' || c.lead_id, 'conflict-done:' || c.id || ':c', true);
  if c.owner_id is not null and c.owner_id <> c.claimant_id then
    perform public.notify(c.owner_id, 'duplicate',
      case when p_give_to = c.owner_id then nm || ' stays with you' else nm || ' was given to ' || coalesce(who, 'another RM') end,
      'Someone else uploaded this lead; ' || coalesce((select full_name from public.profiles where id = auth.uid()), 'your manager') || ' decided.',
      '/leads/' || c.lead_id, 'conflict-done:' || c.id || ':o', true);
  end if;
end $$;
revoke execute on function public.resolve_conflict(uuid, uuid) from anon, public;
grant execute on function public.resolve_conflict(uuid, uuid) to authenticated;
