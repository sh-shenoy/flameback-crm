-- Argus · 0013: change a lead's stage by hand, and log a conversation without a meeting
--
--  * set_bucket: move a lead to any stage, with an optional note (shown on the timeline).
--      Awaiting meeting / Active contact → next follow-up (default tomorrow)
--      Holding → follow-up cadence starts (7 days)      Deferred → return date required
--      Converting → committed (product optional)          Out List → reason "Moved by hand"
--  * log_activity result 'contact': spoke to a lead in Awaiting meeting / Holding / Deferred but
--    no meeting is fixed → back to Active contact, logged as a connected conversation (no strike).

create or replace function public.set_bucket(
  p_lead uuid, p_to public.lead_bucket, p_note text default null,
  p_next_follow_up date default null, p_deferred_until date default null, p_product text default null)
returns void language plpgsql security definer set search_path = public as $$
declare l public.leads; v_note text := nullif(btrim(coalesce(p_note, '')), '');
begin
  l := public.assert_lead_access(p_lead);
  if l.bucket = p_to then raise exception 'The lead is already in that stage'; end if;
  if p_to = 'deferred' and p_deferred_until is null then raise exception 'Pick the date they will come back'; end if;
  if p_to = 'deferred' and p_deferred_until <= public.ist_today() then raise exception 'The return date must be in the future'; end if;

  if v_note is not null then
    insert into public.lead_entries (lead_id, kind, notes, bucket_at, created_by)
    values (p_lead, 'note', v_note, l.bucket, auth.uid());
  end if;

  if p_to = 'converting' and p_product is not null then
    update public.leads set product = coalesce(public.normalize_product(p_product), product) where id = p_lead;
  end if;
  perform public._move(p_lead, p_to, case when p_to = 'out' then 'Moved by hand' else 'Changed by hand' end);

  if p_to = 'deferred' then
    update public.leads set deferred_until = p_deferred_until, next_follow_up = p_deferred_until where id = p_lead;
  elsif p_to = 'holding' then
    if p_next_follow_up is not null then update public.leads set next_follow_up = p_next_follow_up where id = p_lead; end if;
  elsif p_to in ('active_contact','awaiting_meeting') then
    update public.leads set next_follow_up = coalesce(p_next_follow_up, public.ist_today() + 1) where id = p_lead;
  end if;
end $$;

create or replace function public.log_activity(
  p_lead uuid, p_kind text, p_outcome text default null, p_notes text default null,
  p_occurred_at timestamptz default null, p_next_follow_up date default null,
  p_result text default null, p_deferred_until date default null, p_product text default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare l public.leads;
begin
  l := public.assert_lead_access(p_lead);
  -- plain logging: a reminder, a follow-up, a note, no answer… (all the usual rules)
  if p_result is null or l.bucket not in ('awaiting_meeting','holding','deferred') then
    return public.log_entry(p_lead, p_kind, p_outcome, p_notes, p_occurred_at, p_next_follow_up);
  end if;
  if p_result not in ('met','commits','later','contact') then raise exception 'Unknown result'; end if;
  if p_result = 'met' and l.bucket = 'holding' then
    -- already met: another conversation without a decision is simply a follow-up
    return public.log_entry(p_lead, p_kind, p_outcome, p_notes, p_occurred_at, p_next_follow_up);
  end if;
  if p_kind in ('phone_call','meet_call') and p_outcome is distinct from 'connected' then
    raise exception 'They need to have picked up to record a decision';
  end if;
  if p_kind in ('message','email') and p_outcome is distinct from 'replied' then
    raise exception 'They need to have replied to record a decision';
  end if;
  if p_result = 'contact' then
    -- spoke, but no meeting fixed: back to Active contact, then log it there (a conversation resets strikes)
    perform public._move(p_lead, 'active_contact', 'Spoke, no meeting fixed');
    return public.log_entry(p_lead, p_kind, p_outcome, p_notes, p_occurred_at, coalesce(p_next_follow_up, public.ist_today() + 2));
  end if;
  perform public.record_meeting(p_lead, p_result, p_kind, p_notes, p_deferred_until, p_next_follow_up, p_product, p_occurred_at);
  return null;
end $$;

revoke execute on function public.set_bucket(uuid, public.lead_bucket, text, date, date, text) from anon, public;
grant execute on function public.set_bucket(uuid, public.lead_bucket, text, date, date, text) to authenticated;
