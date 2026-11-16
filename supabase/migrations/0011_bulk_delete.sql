-- Argus · 0011: remove leads in bulk
--
--  * remove_import_leads: remove the leads an upload created.
--      only untouched ones (no activity, still Active contact)  → the uploader or an admin
--      all of them, including worked ones                        → admins only
--  * delete_leads: delete selected leads.
--      admins: any lead · RMs: only their own leads that nobody has worked yet
-- Deleting a lead removes its activity, notes, stage history, emails and summary; tasks about it
-- stay (with the lead name they already carry) but lose the link.

create or replace function public.lead_is_untouched(p_lead uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.leads l where l.id = p_lead and l.bucket = 'active_contact' and l.strikes = 0)
     and not exists (select 1 from public.lead_entries e where e.lead_id = p_lead);
$$;

create or replace function public.remove_import_leads(p_batch uuid, p_include_worked boolean default false)
returns int language plpgsql security definer set search_path = public as $$
declare b public.import_batches; n int;
begin
  select * into b from public.import_batches where id = p_batch;
  if not found or (b.uploaded_by <> auth.uid() and not public.is_admin()) then raise exception 'Upload not found'; end if;
  if p_include_worked and not public.is_admin() then raise exception 'Only an admin can remove leads that have already been worked'; end if;
  with del as (
    delete from public.leads l
     where l.import_batch_id = p_batch
       and (p_include_worked or public.lead_is_untouched(l.id))
    returning 1)
  select count(*) into n from del;
  update public.import_batches set undone_at = now(), undone_count = coalesce(undone_count, 0) + n where id = p_batch;
  return n;
end $$;

create or replace function public.delete_leads(p_leads uuid[])
returns int language plpgsql security definer set search_path = public as $$
declare n int; blocked int;
begin
  if not public.is_staff() then raise exception 'Not signed in'; end if;
  if not public.is_admin() then
    select count(*) into blocked from public.leads l
     where l.id = any (p_leads) and (l.rm_id <> auth.uid() or not public.lead_is_untouched(l.id));
    if blocked > 0 then
      raise exception '% of the selected leads have been worked or belong to someone else. RMs can only delete their own untouched leads; ask an admin.', blocked;
    end if;
  end if;
  with del as (delete from public.leads where id = any (p_leads) returning 1)
  select count(*) into n from del;
  return n;
end $$;

revoke execute on function public.lead_is_untouched(uuid) from anon, public;
