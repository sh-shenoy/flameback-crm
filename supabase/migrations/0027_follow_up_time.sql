-- Argus · 0027: follow-ups have a time, so they go on the calendar
--
--  * leads.next_follow_up_at: the date and time of the next follow-up (IST shown in the app).
--    next_follow_up (the date) stays the one used for "due today / overdue".
--  * set_follow_up(lead, at): the RM schedules a follow-up at a date and time.
--  * If the date is changed any other way (logging without a time, stage moves), the time is cleared,
--    so the two never disagree.

alter table public.leads add column if not exists next_follow_up_at timestamptz;

create or replace function public._leads_follow_up_time()
returns trigger language plpgsql as $$
begin
  if new.next_follow_up is null then
    new.next_follow_up_at := null;
  elsif new.next_follow_up is distinct from old.next_follow_up
        and new.next_follow_up_at is not distinct from old.next_follow_up_at then
    new.next_follow_up_at := null;            -- date moved without a new time
  end if;
  return new;
end $$;
drop trigger if exists leads_follow_up_time on public.leads;
create trigger leads_follow_up_time before update of next_follow_up, next_follow_up_at on public.leads
  for each row execute function public._leads_follow_up_time();

create or replace function public.set_follow_up(p_lead uuid, p_at timestamptz)
returns void language plpgsql security definer set search_path = public as $$
declare l public.leads;
begin
  l := public.assert_lead_access(p_lead);
  if l.bucket::text not in ('active_contact','awaiting_meeting','holding','deferred') then
    raise exception 'This lead has no follow-ups at this stage';
  end if;
  if p_at is null then raise exception 'Pick a date and time'; end if;
  if p_at < now() - interval '1 day' then raise exception 'The follow-up time is in the past'; end if;
  update public.leads set next_follow_up = (p_at at time zone 'Asia/Kolkata')::date, next_follow_up_at = p_at, updated_at = now()
   where id = p_lead;
end $$;
revoke execute on function public.set_follow_up(uuid, timestamptz) from anon, public;
grant execute on function public.set_follow_up(uuid, timestamptz) to authenticated;
