-- Argus · 0016: removing someone's access hands their leads over
--
-- remove_access(person, mode, to):
--   mode 'rotation' → each lead goes round-robin to the Sales RMs in rotation (like new leads)
--   mode 'person'   → every lead goes to one active person
-- All their leads move, whatever the stage (Out List and Converting too), so nothing is left with
-- someone who has gone. The person loses access and leaves the rotation in the same step; if the
-- hand-over can't be done, nothing changes. Each lead's timeline records the reassignment, and each
-- new owner gets one notification with their count.

create or replace function public.remove_access(p_user uuid, p_mode text default 'rotation', p_to uuid default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare who text; r record; v uuid; n int := 0; counts jsonb := '{}'::jsonb; k text;
begin
  if not public.is_admin() then raise exception 'Only an admin can remove access'; end if;
  if p_user = auth.uid() then raise exception 'You can''t remove your own access'; end if;
  select full_name into who from public.profiles where id = p_user;
  if not found then raise exception 'Unknown person'; end if;
  if p_mode not in ('rotation','person') then raise exception 'Choose how to hand over their leads'; end if;

  -- out first, so the round-robin can never pick them
  update public.profiles set is_active = false, in_rotation = false where id = p_user;

  if p_mode = 'person' then
    if p_to is null or p_to = p_user or not exists (select 1 from public.profiles where id = p_to and is_active) then
      raise exception 'Pick an active person to take over the leads';
    end if;
  elsif exists (
    select 1 from public.leads l
     where l.rm_id = p_user
       and not exists (select 1 from public.profiles p
                        where p.is_active and p.in_rotation and p.team = 'Sales' and p.unit = l.unit)) then
    raise exception 'Nobody else is in the round-robin to take these leads. Add someone to rotation, or give them all to one person.';
  end if;

  perform set_config('crm.bulk_reassign', 'on', true);       -- one notification per person, not per lead
  for r in select id, unit from public.leads where rm_id = p_user order by created_at loop
    v := case when p_mode = 'person' then p_to else public.next_rm(r.unit) end;
    insert into public.lead_events (lead_id, kind, from_value, to_value, detail, actor)
    values (r.id, 'assigned', p_user::text, v::text, jsonb_build_object('reason', 'Access removed for ' || coalesce(who, 'a former RM')), auth.uid());
    update public.leads set rm_id = v, updated_at = now() where id = r.id;
    counts := jsonb_set(counts, array[v::text], to_jsonb(coalesce((counts->>v::text)::int, 0) + 1));
    n := n + 1;
  end loop;
  perform set_config('crm.bulk_reassign', 'off', true);

  for k in select jsonb_object_keys(counts) loop
    perform public.notify(k::uuid, 'lead_assigned',
      (counts->>k) || ' lead' || case when (counts->>k)::int = 1 then '' else 's' end || ' handed over to you',
      'From ' || coalesce(who, 'a former RM') || ', whose access was removed', '/leads');
  end loop;

  return jsonb_build_object('moved', n, 'by_person', counts);
end $$;

revoke execute on function public.remove_access(uuid, text, uuid) from anon, public;
grant execute on function public.remove_access(uuid, text, uuid) to authenticated;
