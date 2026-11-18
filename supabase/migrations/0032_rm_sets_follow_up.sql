-- Argus · 0032: only the RM puts a lead into Follow-up
--
-- A lead goes to Follow-up only when the RM picks a follow-up date. Nothing sets a date by itself:
--  * logging a call, message or meeting no longer defaults to "tomorrow" / "in 2 days"
--    (the app asks the RM for the date instead)
--  * an email synced from Gmail never sets a date; emails sent before the person became a lead
--    are kept as email history but don't count as contact (no activity entry, no strike)
--  * moving a lead back to Follow-up by hand uses the RM's date only
--  * new leads (added or uploaded) never start with a date
-- The Holding period keeps its automatic 7/14/28-day spacing, and Awaiting meeting its reminders.
-- Existing leads that were never really contacted go back to New, without dates.


create or replace function public.log_entry(
  p_lead uuid, p_kind text, p_outcome text default null, p_notes text default null,
  p_occurred_at timestamptz default null, p_next_follow_up date default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare l public.leads; v_id uuid; v_state text := 'none'; v_outreach boolean;
begin
  l := public.assert_lead_access(p_lead);

  if p_kind in ('phone_call','meet_call') and p_outcome not in ('connected','no_answer','call_back','not_interested') then
    raise exception 'Pick a call outcome';
  end if;
  if p_kind in ('message','email') and p_outcome not in ('sent','replied','not_interested') then
    raise exception 'Pick a message outcome';
  end if;
  if p_kind in ('in_person','note') then p_outcome := case when p_kind = 'in_person' then 'connected' end; end if;
  if (p_outcome = 'connected' or p_kind in ('in_person','note')) and coalesce(btrim(p_notes),'') = '' then
    raise exception 'Notes are required for this entry';
  end if;

  v_outreach := p_kind in ('phone_call','meet_call','message','email');

  if l.bucket = 'active_contact' then
    if p_outcome = 'no_answer' then v_state := 'counted';
    elsif p_outcome = 'sent' then v_state := 'pending';     -- strike after 48h without a reply
    end if;
  elsif l.bucket = 'awaiting_meeting' and v_outreach and p_outcome <> 'not_interested' then
    v_state := 'counted';                                   -- every reminder counts
  end if;
  -- Holding: no strikes; the follow-up cadence moves on instead (below)

  insert into public.lead_entries (lead_id, kind, occurred_at, outcome, notes, bucket_at, strike_state, created_by)
  values (p_lead, p_kind, coalesce(p_occurred_at, now()), p_outcome, nullif(btrim(p_notes),''),
          l.bucket, v_state, auth.uid())
  returning id into v_id;

  update public.leads set
    last_contact_at = case when p_outcome in ('connected','replied') then greatest(coalesce(last_contact_at, 'epoch'), coalesce(p_occurred_at, now())) else last_contact_at end,
    -- only the RM's date makes it a follow-up; nothing is filled in automatically
    next_follow_up  = coalesce(p_next_follow_up, next_follow_up),
    updated_at      = now()
  where id = p_lead;

  if p_outcome = 'not_interested' then
    perform public._move(p_lead, 'out', 'Not interested');
  elsif l.bucket = 'holding' and (v_outreach or p_kind = 'in_person') then
    perform public._holding_followed_up(p_lead, p_next_follow_up);
  elsif l.bucket = 'active_contact' and p_outcome in ('connected','replied') then
    update public.leads set strikes = 0 where id = p_lead and strikes > 0;
    update public.lead_entries set strike_state = 'none'
     where lead_id = p_lead and strike_state = 'pending';
  elsif v_state = 'counted' then
    perform public._add_strike(p_lead);
  end if;
  return v_id;
end $$;

create or replace function public._log_activity_rules(
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
    return public.log_entry(p_lead, p_kind, p_outcome, p_notes, p_occurred_at, p_next_follow_up);
  end if;
  perform public.record_meeting(p_lead, p_result, p_kind, p_notes, p_deferred_until, p_next_follow_up, p_product, p_occurred_at);
  return null;
end $$;

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
  elsif p_to = 'awaiting_meeting' then
    update public.leads set next_follow_up = coalesce(p_next_follow_up, public.ist_today() + 1) where id = p_lead;
  elsif p_to = 'active_contact' then
    update public.leads set next_follow_up = p_next_follow_up where id = p_lead;   -- the RM's date, or none
  end if;
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

  -- written before this person became a lead: email history only, not contact
  if v_at < l.created_at then return l.id; end if;

  insert into public.lead_entries (lead_id, kind, occurred_at, outcome, notes, bucket_at, strike_state, created_by)
  values (l.id, 'email', v_at, case when v_in then 'replied' else 'sent' end,
          left(coalesce('Subject: ' || nullif(p->>'subject','') || E'\n\n', '') || coalesce(p->>'body',''), 6000),
          l.bucket,
          case when not v_in and l.bucket = 'active_contact' then 'pending'
               when not v_in and l.bucket = 'awaiting_meeting' then 'counted' else 'none' end,
          p_user);

  -- no follow-up date from email: the RM sets it
  if not v_in and l.bucket = 'awaiting_meeting' then
    perform public._add_strike(l.id);                -- a reminder, like one logged by hand
  elsif not v_in and l.bucket = 'holding' and v_at > now() - interval '3 days' then
    perform public._holding_followed_up(l.id);       -- a follow-up: next one further out
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

create or replace function public.create_lead(p jsonb)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_rm uuid; v_phone text; v_email text; v_alt text; v_unit text := coalesce(p->>'unit','IQWM');
begin
  if not public.is_staff() then raise exception 'Not signed in'; end if;
  v_phone := public.normalize_phone(p->>'phone');
  v_email := public.normalize_email(p->>'email');
  if nullif(p->>'phone','') is not null and v_phone is null then
    raise exception 'Phone number "%" is not valid', p->>'phone';
  end if;
  if v_phone is null and v_email is null then
    raise exception 'A phone number or email is required';
  end if;
  v_alt := public.normalize_phone(p->>'alt_phone');
  if nullif(p->>'alt_phone','') is not null and v_alt is null then
    raise exception 'Secondary number "%" is not valid', p->>'alt_phone';
  end if;
  if v_alt = v_phone then v_alt := null; end if;
  if exists (select 1 from public.leads where unit = v_unit
               and (phone in (v_phone, v_alt) or alt_phone in (v_phone, v_alt) or email = v_email)) then
    raise exception 'DUPLICATE: a lead with this phone or email already exists';
  end if;

  if nullif(p->>'rm_id','') is not null then                      -- anyone may pick the RM (or round-robin)
    v_rm := (p->>'rm_id')::uuid;
    if not exists (select 1 from public.profiles where id = v_rm and is_active and role <> 'admin') then
      raise exception 'Leads can only be assigned to an active RM, not an admin';
    end if;
  else
    v_rm := public.next_rm_for(v_unit, public.normalize_product(p->>'product'), public.normalize_languages(p->>'language'),
                               coalesce(p->>'residency', '') = 'nri');
  end if;

  insert into public.leads (unit, name, phone, email, city, age, marital_status, income_band, language,
                            requirement, budget, product, source, campaign, referred_by,
                            next_follow_up, rm_id, import_batch_id, created_by)
  values (v_unit, btrim(p->>'name'), v_phone, v_email, nullif(p->>'city',''),
          nullif(p->>'age','')::int, nullif(p->>'marital_status',''), nullif(p->>'income_band',''),
          nullif(p->>'language',''), nullif(p->>'requirement',''), nullif(p->>'budget',''),
          p->>'product', p->>'source', nullif(p->>'campaign',''), nullif(p->>'referred_by',''),
          null::date,                      -- new leads aren't follow-ups yet
          v_rm, nullif(p->>'import_batch_id','')::uuid, auth.uid())
  returning id into v_id;
  if p->>'residency' in ('resident','nri') then update public.leads set residency = p->>'residency' where id = v_id; end if;
  if v_alt is not null then update public.leads set alt_phone = v_alt where id = v_id; end if;

  perform public.log_event(v_id, 'created', null, null,
    jsonb_build_object('via', case when p ? 'import_batch_id' then 'upload' else 'manual' end));
  perform public.log_event(v_id, 'assigned', null, v_rm::text);
  return v_id;
end $$;


-- ── clean-up ──
-- Gmail emails dated before the lead existed are not contact (they stay under the Email tab)
delete from public.lead_entries e using public.leads l
 where l.id = e.lead_id and e.kind = 'email' and e.occurred_at < l.created_at
   and exists (select 1 from public.gmail_messages g where g.lead_id = e.lead_id and g.sent_at = e.occurred_at);

-- leads nobody has called, messaged, emailed or met: back to New, no dates, no strikes
update public.leads l set next_follow_up = null, next_follow_up_at = null, strikes = 0
 where l.bucket::text = 'active_contact'
   and (l.next_follow_up is not null or l.strikes > 0)
   and not exists (select 1 from public.lead_entries e where e.lead_id = l.id
                    and e.kind in ('phone_call','meet_call','message','email','in_person'));

