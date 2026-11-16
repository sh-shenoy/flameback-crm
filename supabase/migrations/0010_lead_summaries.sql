-- Argus · 0010: AI conversation summary per lead
--
-- The "summarize" edge function reads everything on a lead (with the caller's own permissions),
-- asks the AI model for a short structured summary and saves it here. An RM can edit it;
-- an edited summary is not overwritten automatically, only when someone clicks Refresh.

create table if not exists public.lead_summaries (
  lead_id      uuid primary key references public.leads(id) on delete cascade,
  summary      jsonb not null,              -- { headline, who, wants, status, concerns[], next_steps[] }
  covers_until timestamptz not null,        -- newest activity included
  model        text,
  generated_at timestamptz not null default now(),
  edited_by    uuid references public.profiles(id),
  edited_at    timestamptz
);
alter table public.lead_summaries enable row level security;
drop policy if exists lead_summaries_read on public.lead_summaries;
create policy lead_summaries_read on public.lead_summaries for select to authenticated
  using (public.can_access_lead(lead_id));
revoke insert, update, delete on public.lead_summaries from anon, authenticated;

-- Newest moment anything happened on a lead (used to decide whether the summary is out of date).
create or replace function public.lead_last_activity(p_lead uuid)
returns timestamptz language sql stable security definer set search_path = public as $$
  -- answers only for leads the caller can open (the service role, used by the edge function, always can)
  select case when public.can_access_lead(p_lead) or coalesce(auth.role(), '') = 'service_role' or auth.uid() is null then greatest(
    (select updated_at from public.leads where id = p_lead),
    (select max(created_at) from public.lead_entries where lead_id = p_lead),
    (select max(at) from public.lead_events where lead_id = p_lead),
    (select max(updated_at) from public.tasks where lead_id = p_lead)
  ) end;
$$;

-- Saved by the edge function (service role only).
create or replace function public.save_lead_summary(p_lead uuid, p_summary jsonb, p_covers_until timestamptz, p_model text, p_force boolean)
returns boolean language plpgsql security definer set search_path = public as $$
declare cur public.lead_summaries;
begin
  select * into cur from public.lead_summaries where lead_id = p_lead;
  -- never overwrite an RM's edit unless someone explicitly asked for a refresh
  if found and cur.edited_at is not null and not p_force then return false; end if;
  insert into public.lead_summaries (lead_id, summary, covers_until, model, generated_at, edited_by, edited_at)
  values (p_lead, p_summary, p_covers_until, p_model, now(), null, null)
  on conflict (lead_id) do update set summary = excluded.summary, covers_until = excluded.covers_until,
         model = excluded.model, generated_at = now(), edited_by = null, edited_at = null;
  return true;
end $$;

-- An RM corrects the summary.
create or replace function public.edit_lead_summary(p_lead uuid, p_summary jsonb)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform public.assert_lead_access(p_lead);
  if p_summary is null or jsonb_typeof(p_summary) <> 'object' then raise exception 'Invalid summary'; end if;
  insert into public.lead_summaries (lead_id, summary, covers_until, model, edited_by, edited_at)
  values (p_lead, p_summary, coalesce(public.lead_last_activity(p_lead), now()), null, auth.uid(), now())
  on conflict (lead_id) do update set summary = excluded.summary, edited_by = auth.uid(), edited_at = now();
end $$;

revoke execute on function public.save_lead_summary(uuid, jsonb, timestamptz, text, boolean) from anon, authenticated, public;
grant execute on function public.save_lead_summary(uuid, jsonb, timestamptz, text, boolean) to service_role;
