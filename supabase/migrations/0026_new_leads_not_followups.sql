-- Argus · 0026: a new lead is a lead, not a follow-up
--
-- New leads (added or uploaded) no longer get a follow-up date of "today". They wait in "New: to
-- contact" until the RM reaches out. The first attempt (call, even unanswered; message; email; meeting)
-- makes it a follow-up: on the date the RM picks, or tomorrow (two days after a message that wasn't
-- answered yet). A follow-up date can still be set by hand when adding a lead.
-- Existing leads nobody has contacted lose their automatic date.

create or replace function public.create_lead(p jsonb)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_rm uuid; v_phone text; v_email text; v_unit text := coalesce(p->>'unit','IQWM');
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
  if exists (select 1 from public.leads where unit = v_unit and (phone = v_phone or email = v_email)) then
    raise exception 'DUPLICATE: a lead with this phone or email already exists';
  end if;

  if public.is_admin() and nullif(p->>'rm_id','') is not null then
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
          nullif(p->>'next_follow_up','')::date,                      -- new leads aren't follow-ups yet
          v_rm, nullif(p->>'import_batch_id','')::uuid, auth.uid())
  returning id into v_id;
  if p->>'residency' in ('resident','nri') then update public.leads set residency = p->>'residency' where id = v_id; end if;

  perform public.log_event(v_id, 'created', null, null,
    jsonb_build_object('via', case when p ? 'import_batch_id' then 'upload' else 'manual' end));
  perform public.log_event(v_id, 'assigned', null, v_rm::text);
  return v_id;
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
    -- the first attempt on a new lead makes it a follow-up: the RM's date, else tomorrow (2 days after a message)
    next_follow_up  = coalesce(p_next_follow_up, next_follow_up,
                        case when v_outreach or p_kind = 'in_person' then public.ist_today() + case when p_outcome = 'sent' then 2 else 1 end end),
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

  -- an email to a new lead is the first attempt: follow up in 2 days unless a date is already set
  if not v_in and l.next_follow_up is null and l.bucket::text in ('active_contact','awaiting_meeting','holding','deferred') then
    update public.leads set next_follow_up = public.ist_today() + 2 where id = l.id;
  end if;
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

create or replace function public.run_notification_sweeps()
returns void language plpgsql security definer set search_path = public as $$
declare r record; v_today date := public.ist_today();
begin
  -- daily digest from 9 am IST
  if extract(hour from now() at time zone 'Asia/Kolkata') >= 9 then
    for r in
      select p.id,
             (select count(*) from public.leads l where l.rm_id = p.id and l.bucket in ('active_contact','awaiting_meeting','holding','deferred') and l.next_follow_up = v_today) as due,
             (select count(*) from public.leads l where l.rm_id = p.id and l.bucket in ('active_contact','awaiting_meeting','holding','deferred') and l.next_follow_up < v_today) as overdue,
             (select count(*) from public.tasks t where (t.assignee_id = p.id or (t.assignee_id is null and t.to_team = p.team)) and t.status <> 'done' and t.due_date <= v_today) as tasks,
             (select count(*) from public.leads l where l.rm_id = p.id and l.bucket = 'active_contact' and l.next_follow_up is null) as fresh
        from public.profiles p where p.is_active and p.role <> 'admin'
    loop
      if r.due + r.overdue + r.tasks + r.fresh > 0 then
        perform public.notify(r.id, 'digest', 'Today: ' || r.due || ' follow-up' || case when r.due = 1 then '' else 's' end || ' due'
                    || case when r.overdue > 0 then ', ' || r.overdue || ' overdue' else '' end
                    || case when r.fresh > 0 then ', ' || r.fresh || ' new lead' || case when r.fresh = 1 then '' else 's' end || ' to contact' else '' end,
          case when r.tasks > 0 then r.tasks || ' task' || case when r.tasks = 1 then '' else 's' end || ' due or overdue' else 'Open your dashboard to start' end,
          '/', 'digest:' || v_today, true);
      end if;
    end loop;
  end if;

  -- meetings starting within ~35 minutes
  for r in select id, name, rm_id, meeting_at from public.leads
            where bucket = 'awaiting_meeting' and meeting_at > now() and meeting_at <= now() + interval '35 minutes'
  loop
    perform public.notify(r.rm_id, 'meeting_soon', 'Meeting in ' || greatest(1, ceil(extract(epoch from r.meeting_at - now()) / 60))::int || ' min: ' || r.name,
      to_char(r.meeting_at at time zone 'Asia/Kolkata', 'HH12:MI am') || ' IST', '/leads/' || r.id, 'meet:' || r.id || ':' || r.meeting_at, true);
  end loop;

  -- admins: one team digest from 9 am IST
  if extract(hour from now() at time zone 'Asia/Kolkata') >= 9 then
    for r in
      select a.id,
             (select count(*) from public.leads l join public.profiles p on p.id = l.rm_id
               where (p.manager_id = a.id or not exists (select 1 from public.profiles x where x.manager_id = a.id))
                 and l.bucket::text in ('active_contact','awaiting_meeting','holding','deferred') and l.next_follow_up < v_today) as overdue,
             (select count(*) from public.leads l join public.profiles p on p.id = l.rm_id
               where (p.manager_id = a.id or not exists (select 1 from public.profiles x where x.manager_id = a.id))
                 and l.bucket::text = 'active_contact' and l.created_at < now() - interval '24 hours'
                 and not exists (select 1 from public.lead_entries e where e.lead_id = l.id)) as untouched,
             (select count(*) from public.lead_entries e join public.profiles p on p.id = e.created_by
               where (p.manager_id = a.id or not exists (select 1 from public.profiles x where x.manager_id = a.id))
                 and e.occurred_at >= ((v_today - 1)::timestamp at time zone 'Asia/Kolkata') and e.occurred_at < (v_today::timestamp at time zone 'Asia/Kolkata')) as yesterday,
             (select count(*) from public.leads l join public.profiles p on p.id = l.rm_id
               where (p.manager_id = a.id or not exists (select 1 from public.profiles x where x.manager_id = a.id))
                 and l.converted_at >= ((v_today - 1)::timestamp at time zone 'Asia/Kolkata') and l.converted_at < (v_today::timestamp at time zone 'Asia/Kolkata')) as new_prospects
        from public.profiles a where a.is_active and a.role = 'admin'
    loop
      perform public.notify(r.id, 'digest', 'Team today: ' || r.overdue || ' overdue follow-up' || case when r.overdue = 1 then '' else 's' end
                  || case when r.untouched > 0 then ', ' || r.untouched || ' new lead' || case when r.untouched = 1 then '' else 's' end || ' untouched' else '' end,
        'Yesterday: ' || r.yesterday || ' activit' || case when r.yesterday = 1 then 'y' else 'ies' end || ' logged'
          || case when r.new_prospects > 0 then ', ' || r.new_prospects || ' new prospect' || case when r.new_prospects = 1 then '' else 's' end else '' end,
        '/', 'digest:' || v_today, true);
    end loop;
  end if;
end $$;

-- existing untouched leads: back to "new"
update public.leads l set next_follow_up = null
 where l.bucket = 'active_contact' and l.strikes = 0 and l.next_follow_up is not null
   and not exists (select 1 from public.lead_entries e where e.lead_id = l.id);
