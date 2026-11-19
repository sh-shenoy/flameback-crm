-- Argus · 0038: logging a call clears the follow-up it fulfils
--
-- An RM calls a lead whose follow-up was due (today or earlier) and logs it without picking a new date.
-- Before, the old date stayed, so the lead showed as overdue although it had just been called.
-- Now a follow-up that was due is cleared when a call, message, email or meeting is logged
-- (New / Not picked up / Follow-up and Awaiting meeting). A follow-up still to come stays; a new date
-- picked by the RM replaces it. Holding keeps its own 7/14/28-day spacing.
--
-- Existing leads: a follow-up date on or before the day of the latest logged call/message/meeting
-- was already done, so it's cleared.

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
    -- the RM's new date wins; without one, a follow-up that was already due (today or earlier) has
    -- just been done, so it's cleared. A follow-up still to come (a later date, or later today) stays.
    next_follow_up  = case
      when p_next_follow_up is not null then p_next_follow_up
      when (v_outreach or p_kind = 'in_person') and l.bucket::text in ('active_contact','awaiting_meeting')
           and next_follow_up <= public.ist_today()
           and (next_follow_up_at is null or next_follow_up_at <= now() + interval '1 hour') then null
      else next_follow_up end,
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

update public.leads l set next_follow_up = null
 where l.bucket::text in ('active_contact','awaiting_meeting')
   and l.next_follow_up is not null
   and l.next_follow_up <= public.ist_today()
   and l.next_follow_up <= (select max((e.occurred_at at time zone 'Asia/Kolkata')::date) from public.lead_entries e
                             where e.lead_id = l.id and e.kind in ('phone_call','meet_call','message','email','in_person'))
   and (l.next_follow_up_at is null or l.next_follow_up_at <= (select max(e.occurred_at) from public.lead_entries e
                             where e.lead_id = l.id and e.kind in ('phone_call','meet_call','message','email','in_person')) + interval '1 hour');
