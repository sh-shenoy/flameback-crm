-- Argus · 0014: record where a conversation left things from Active contact too
--
-- A lead doesn't need a booked meeting first. After a call, a chat or meeting them anywhere, an RM can
-- record the outcome straight from Active contact:
--   'interested' → wants to meet, time not fixed → Awaiting meeting (next follow-up tomorrow)
--   'met'        → met / discussed properly, still thinking → Holding period (7, 14, 28… day follow-ups)
--   'commits'    → Converting      'later' → Deferred until a date
-- (No result = just a conversation: stays in Active contact, strikes reset, as before.)

create or replace function public.record_meeting(
  p_lead uuid, p_result text, p_kind text, p_notes text,
  p_deferred_until date default null, p_next_follow_up date default null, p_product text default null,
  p_occurred_at timestamptz default null)
returns void language plpgsql security definer set search_path = public as $$
declare l public.leads;
begin
  l := public.assert_lead_access(p_lead);
  if l.bucket not in ('active_contact','awaiting_meeting','holding','deferred') then raise exception 'This lead is closed; bring it back first'; end if;
  if p_kind not in ('meet_call','in_person','phone_call','message','email') then raise exception 'Pick how you spoke'; end if;
  if coalesce(btrim(p_notes),'') = '' then raise exception 'Notes are required'; end if;
  if p_result = 'later' and p_deferred_until is null then raise exception 'Pick the date they will come back'; end if;

  insert into public.lead_entries (lead_id, kind, occurred_at, outcome, notes, bucket_at, created_by)
  values (p_lead, p_kind, coalesce(p_occurred_at, now()),
          case when p_kind in ('message','email') then 'replied' else 'connected' end,
          btrim(p_notes), l.bucket, auth.uid());
  update public.leads set last_contact_at = greatest(coalesce(last_contact_at, 'epoch'), coalesce(p_occurred_at, now())),
         product = coalesce(public.normalize_product(p_product), product) where id = p_lead;

  if p_result = 'commits' then
    perform public._move(p_lead, 'converting');
  elsif p_result in ('undecided','met') then
    perform public._move(p_lead, 'holding');
    update public.leads set next_follow_up = coalesce(p_next_follow_up, public.ist_today() + public.holding_gap(0)) where id = p_lead;
  elsif p_result = 'later' then
    perform public._move(p_lead, 'deferred');
    update public.leads set deferred_until = p_deferred_until, next_follow_up = p_deferred_until where id = p_lead;
  else
    raise exception 'Unknown result';
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
  if p_result is null or l.bucket not in ('active_contact','awaiting_meeting','holding','deferred') then
    return public.log_entry(p_lead, p_kind, p_outcome, p_notes, p_occurred_at, p_next_follow_up);
  end if;
  if p_result not in ('met','commits','later','contact','interested') then raise exception 'Unknown result'; end if;
  if l.bucket = 'active_contact' and p_result = 'contact' then
    return public.log_entry(p_lead, p_kind, p_outcome, p_notes, p_occurred_at, p_next_follow_up);   -- already there
  end if;
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
  if p_result = 'interested' then
    -- spoke, they want to meet (time not fixed yet): log it, then Awaiting meeting
    if l.bucket <> 'active_contact' then raise exception 'Only for leads in Active contact'; end if;
    perform public.log_entry(p_lead, p_kind, p_outcome, p_notes, p_occurred_at, null);
    perform public._move(p_lead, 'awaiting_meeting');
    update public.leads set next_follow_up = coalesce(p_next_follow_up, public.ist_today() + 1) where id = p_lead;
    return null;
  end if;
  if p_result = 'contact' then
    -- spoke, but no meeting fixed: back to Active contact, then log it there (a conversation resets strikes)
    perform public._move(p_lead, 'active_contact', 'Spoke, no meeting fixed');
    return public.log_entry(p_lead, p_kind, p_outcome, p_notes, p_occurred_at, coalesce(p_next_follow_up, public.ist_today() + 2));
  end if;
  perform public.record_meeting(p_lead, p_result, p_kind, p_notes, p_deferred_until, p_next_follow_up, p_product, p_occurred_at);
  return null;
end $$;
