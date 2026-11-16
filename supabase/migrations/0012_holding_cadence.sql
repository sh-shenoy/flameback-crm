-- Argus · 0012: "still thinking" follow-up cadence, and deleting leads is admin-only
--
-- Holding period (met, still thinking) no longer uses strikes. Follow-ups are spaced out
-- automatically instead: 7 days after the lead enters Holding, then 14, 28, 56 … days after each
-- follow-up (doubling, never more than 90 days apart). Picking a date by hand still wins.
-- A Holding lead leaves only by a decision: Committed, Will commit later (Deferred) or Not interested.
--
-- Deleting leads (selected, or from an upload) is now for admins only.

alter table public.leads add column if not exists holding_step int not null default 0;

-- gap in days before follow-up number p_step+1 (step 0 = first follow-up after entering Holding)
create or replace function public.holding_gap(p_step int)
returns int language sql immutable as $$
  select least(7 * power(2, greatest(p_step, 0))::int, 90);
$$;

-- existing Holding leads: strikes no longer apply; cadence starts fresh
update public.leads set strikes = 0, holding_step = 0 where bucket = 'holding';
update public.lead_entries e set strike_state = 'none'
  from public.leads l where e.lead_id = l.id and l.bucket = 'holding' and e.bucket_at = 'holding' and e.strike_state = 'counted';

-- moves: entering Holding resets the cadence and sets the first follow-up 7 days out
create or replace function public._move(p_lead uuid, p_to public.lead_bucket, p_reason text default null)
returns void language plpgsql security definer set search_path = public as $$
declare l public.leads;
begin
  select * into l from public.leads where id = p_lead;
  if l.bucket = p_to then return; end if;
  update public.leads set
    bucket          = p_to,
    strikes         = 0,
    holding_step    = 0,
    out_reason      = case when p_to = 'out' then p_reason else null end,
    out_from_bucket = case when p_to = 'out' then l.bucket else null end,
    out_at          = case when p_to = 'out' then now() else null end,
    next_follow_up  = case when p_to in ('out','converting') then null
                           when p_to = 'holding' then public.ist_today() + public.holding_gap(0)
                           else next_follow_up end,
    meeting_at      = case when p_to = 'awaiting_meeting' then meeting_at else null end,
    deferred_until  = case when p_to = 'deferred' then deferred_until else null end,
    converted_at    = case when p_to = 'converting' then now() else converted_at end,
    updated_at      = now()
  where id = p_lead;
  perform public.log_event(p_lead, 'bucket', l.bucket::text, p_to::text,
    case when p_reason is not null then jsonb_build_object('reason', p_reason) end);
end $$;

-- internal: a follow-up happened on a Holding lead → next one further out
create or replace function public._holding_followed_up(p_lead uuid, p_next date default null)
returns void language plpgsql security definer set search_path = public as $$
begin
  update public.leads set
    holding_step   = holding_step + 1,
    next_follow_up = coalesce(p_next, public.ist_today() + public.holding_gap(holding_step + 1)),
    updated_at     = now()
  where id = p_lead and bucket = 'holding';
end $$;

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

-- record_meeting: "met, still deciding" lands in Holding with the first follow-up 7 days out
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
    update public.leads set next_follow_up = coalesce(p_next_follow_up, public.ist_today() + public.holding_gap(0)) where id = p_lead;
  elsif p_result = 'later' then
    perform public._move(p_lead, 'deferred');
    update public.leads set deferred_until = p_deferred_until, next_follow_up = p_deferred_until where id = p_lead;
  else
    raise exception 'Unknown result';
  end if;
end $$;

-- Gmail: an email sent to a Holding lead is a follow-up (no strike), so the cadence moves on
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
               when not v_in and l.bucket = 'awaiting_meeting' then 'counted' else 'none' end,
          p_user);

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

-- deleting leads: admins only
create or replace function public.delete_leads(p_leads uuid[])
returns int language plpgsql security definer set search_path = public as $$
declare n int;
begin
  if not public.is_admin() then raise exception 'Only an admin can delete leads. Mark the lead Not interested instead.'; end if;
  with del as (delete from public.leads where id = any (p_leads) returning 1)
  select count(*) into n from del;
  return n;
end $$;

create or replace function public.remove_import_leads(p_batch uuid, p_include_worked boolean default false)
returns int language plpgsql security definer set search_path = public as $$
declare b public.import_batches; n int;
begin
  if not public.is_admin() then raise exception 'Only an admin can remove leads from an upload'; end if;
  select * into b from public.import_batches where id = p_batch;
  if not found then raise exception 'Upload not found'; end if;
  with del as (
    delete from public.leads l
     where l.import_batch_id = p_batch
       and (p_include_worked or public.lead_is_untouched(l.id))
    returning 1)
  select count(*) into n from del;
  update public.import_batches set undone_at = now(), undone_count = coalesce(undone_count, 0) + n where id = p_batch;
  return n;
end $$;

revoke execute on function public._holding_followed_up(uuid, date) from anon, authenticated, public;
