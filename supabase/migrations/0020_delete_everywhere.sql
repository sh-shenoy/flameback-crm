-- Argus · 0020: deleting a lead removes it from everything
--
-- Activity, notes, emails, summary, holders and the onboarding checklist already went with the lead.
-- Now also removed: its meetings (calendar, reminders), tasks raised about it (with their comments and
-- files), and notifications pointing at the lead or those tasks. An upload whose leads are all gone
-- disappears from Upload history. Admins only (unchanged).

create or replace function public._purge_leads(p_leads uuid[])
returns int language plpgsql security definer set search_path = public as $$
declare n int; v_tasks uuid[]; v_batches uuid[];
begin
  select coalesce(array_agg(id), '{}') into v_tasks from public.tasks where lead_id = any (p_leads);
  select coalesce(array_agg(distinct import_batch_id) filter (where import_batch_id is not null), '{}')
    into v_batches from public.leads where id = any (p_leads);

  delete from public.notifications
   where link = any (select '/leads/' || x::text from unnest(p_leads) x)
      or link = any (select '/tasks?task=' || x::text from unnest(v_tasks) x);
  delete from public.meetings where lead_id = any (p_leads);
  delete from public.calendly_events where lead_id = any (p_leads);
  delete from public.tasks where id = any (v_tasks);                 -- comments, events, files cascade

  with del as (delete from public.leads where id = any (p_leads) returning 1)
  select count(*) into n from del;

  -- uploads with nothing left
  delete from public.import_batches b
   where b.id = any (v_batches) and not exists (select 1 from public.leads l where l.import_batch_id = b.id);
  return n;
end $$;
revoke execute on function public._purge_leads(uuid[]) from anon, authenticated, public;

create or replace function public.delete_leads(p_leads uuid[])
returns int language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'Only an admin can delete leads. Mark the lead Not interested instead.'; end if;
  return public._purge_leads(p_leads);
end $$;

create or replace function public.remove_import_leads(p_batch uuid, p_include_worked boolean default false)
returns int language plpgsql security definer set search_path = public as $$
declare b public.import_batches; n int; v uuid[];
begin
  if not public.is_admin() then raise exception 'Only an admin can remove leads from an upload'; end if;
  select * into b from public.import_batches where id = p_batch;
  if not found then raise exception 'Upload not found'; end if;
  select coalesce(array_agg(l.id), '{}') into v from public.leads l
   where l.import_batch_id = p_batch and (p_include_worked or public.lead_is_untouched(l.id));
  n := public._purge_leads(v);
  -- the upload row is gone if nothing is left; otherwise record what was removed
  update public.import_batches set undone_at = now(), undone_count = coalesce(undone_count, 0) + n where id = p_batch;
  return n;
end $$;
