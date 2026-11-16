-- Flameback CRM · 0009: Log activity also decides for Deferred leads
--
-- A Deferred lead who gets in touch early can now be moved from Log activity:
--   'met'     → ready to discuss again → Holding period
--   'commits' → Converting
--   'later'   → stays Deferred with a new return date
-- (The separate Defer / Commits buttons are gone from the lead page; Log activity covers them.)

create or replace function public.record_meeting(
  p_lead uuid, p_result text, p_kind text, p_notes text,
  p_deferred_until date default null, p_next_follow_up date default null, p_product text default null,
  p_occurred_at timestamptz default null)
returns void language plpgsql security definer set search_path = public as $$
declare l public.leads;
begin
  l := public.assert_lead_access(p_lead);
  if l.bucket not in ('awaiting_meeting','holding','deferred') then raise exception 'Lead has no meeting to record'; end if;
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
    update public.leads set next_follow_up = coalesce(p_next_follow_up, public.ist_today() + 3) where id = p_lead;
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
  -- plain logging: a reminder, a follow-up, a note, no answer… (all the usual strike rules)
  if p_result is null or l.bucket not in ('awaiting_meeting','holding','deferred') then
    return public.log_entry(p_lead, p_kind, p_outcome, p_notes, p_occurred_at, p_next_follow_up);
  end if;
  if p_result not in ('met','commits','later') then raise exception 'Unknown result'; end if;
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
  perform public.record_meeting(p_lead, p_result, p_kind, p_notes, p_deferred_until, p_next_follow_up, p_product, p_occurred_at);
  return null;
end $$;
