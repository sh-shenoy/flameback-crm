-- Flameback CRM · 0008: one "Log activity" for everything
--
--  * log_activity: log any call / message / email / meeting / note. When the client was actually reached
--    in Awaiting meeting or Holding, p_result says where it left things:
--      null       → just a reminder / still deciding (counts as a reminder / follow-up, as before)
--      'met'      → (Awaiting meeting) the meeting happened, still deciding → Holding
--      'commits'  → Converting
--      'later'    → Deferred until p_deferred_until
--  * record_meeting now accepts messages and emails too (a client may commit on WhatsApp) and a time.
--  * Gmail emails you send in Awaiting meeting / Holding count as a reminder / follow-up.

-- replaces the earlier 7-argument version (adding a parameter would otherwise create a second one)
drop function if exists public.record_meeting(uuid, text, text, text, date, date, text);

create or replace function public.record_meeting(
  p_lead uuid, p_result text, p_kind text, p_notes text,
  p_deferred_until date default null, p_next_follow_up date default null, p_product text default null,
  p_occurred_at timestamptz default null)
returns void language plpgsql security definer set search_path = public as $$
declare l public.leads;
begin
  l := public.assert_lead_access(p_lead);
  if l.bucket not in ('awaiting_meeting','holding') then raise exception 'Lead has no meeting to record'; end if;
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
  if p_result is null or l.bucket not in ('awaiting_meeting','holding') then
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

create or replace function public.apply_gmail_message(p_user uuid, p jsonb)
returns uuid language plpgsql security definer set search_path = public as $$
declare l public.leads; v_in boolean := p->>'direction' = 'in'; v_at timestamptz := (p->>'sent_at')::timestamptz;
begin
  if exists (select 1 from public.gmail_messages where message_id = p->>'message_id' and user_id = p_user) then return null; end if;
  select * into l from public.leads
   where email = public.normalize_email(p->>'counterpart') and (rm_id = p_user or nullif(p->>'lead_id','')::uuid = id)
   order by (rm_id = p_user) desc limit 1;
  if not found then return null; end if;

  insert into public.gmail_messages (message_id, user_id, lead_id, thread_id, direction, subject, sent_at)
  values (p->>'message_id', p_user, l.id, p->>'thread_id', p->>'direction', p->>'subject', v_at);

  insert into public.lead_entries (lead_id, kind, occurred_at, outcome, notes, bucket_at, strike_state, created_by)
  values (l.id, 'email', v_at, case when v_in then 'replied' else 'sent' end,
          left(coalesce('Subject: ' || nullif(p->>'subject','') || E'\n\n', '') || coalesce(p->>'body',''), 6000),
          l.bucket,
          case when not v_in and l.bucket = 'active_contact' then 'pending'
               when not v_in and l.bucket in ('awaiting_meeting','holding') then 'counted' else 'none' end,
          p_user);

  -- an email you send in Awaiting meeting / Holding is a reminder / follow-up, like one logged by hand
  if not v_in and l.bucket in ('awaiting_meeting','holding') then
    perform public._add_strike(l.id);
  end if;

  if v_in then
    update public.leads set last_contact_at = greatest(coalesce(last_contact_at, 'epoch'), v_at), updated_at = now() where id = l.id;
    if l.bucket = 'active_contact' then
      update public.leads set strikes = 0 where id = l.id;
      update public.lead_entries set strike_state = 'none' where lead_id = l.id and strike_state = 'pending';
    end if;
    if v_at > now() - interval '3 days' then
      perform public.notify(l.rm_id, 'email_reply', l.name || ' replied', coalesce(nullif(p->>'subject',''), '(no subject)'),
        '/leads/' || l.id, 'mail:' || (p->>'message_id'));
    end if;
  end if;
  return l.id;
end $$;
