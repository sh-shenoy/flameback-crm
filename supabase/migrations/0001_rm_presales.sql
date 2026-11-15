-- Flameback CRM · RM pre-sales (lead → committed) · v1 schema
--
-- Rules implemented here (so they hold no matter which screen calls them):
--   * Every lead sits in exactly one bucket:
--       active_contact → awaiting_meeting → holding / deferred → converting
--     plus `out` (the Out List).
--   * Five strikes in any working bucket moves the lead to the Out List.
--       active_contact   : unanswered attempts (call "No answer"; message/email
--                          "Sent" with no reply in 48h). Connected/Replied resets to 0.
--       awaiting_meeting : every reminder (call / message / email) counts.
--       holding          : every follow-up (call / message / email) counts.
--     The counter resets to 0 whenever the lead changes bucket.
--   * Outcome "Not interested" (or the button) moves the lead to the Out List.
--   * Bring back: needs a follow-up date, resets strikes, returns to the bucket it left.
--   * Deferred leads return to Holding on their date.
--   * New leads are assigned round-robin across RMs in rotation.
--   * RMs see only their own leads; admins see everything.
--   * Leads are only created / moved through the functions below, never by raw
--     table writes, so the rules cannot be bypassed from the browser.

create extension if not exists pg_trgm;

-- ───────────────────────── reference data ─────────────────────────

create table public.business_units (
  code text primary key,
  name text not null
);
insert into public.business_units (code, name) values
  ('IQWM', 'India Quantitative Wealth Management'),
  ('QXF',  'QX Funds'),
  ('USRIA','US RIA');

create table public.lead_sources (
  name       text primary key,
  kind       text not null check (kind in ('cold','warm')),
  is_active  boolean not null default true,
  sort_order int not null default 100
);
insert into public.lead_sources (name, kind, sort_order) values
  ('Meta',               'warm', 10),
  ('Google',             'warm', 20),
  ('LinkedIn',           'warm', 30),
  ('Referral',           'warm', 40),
  ('RCS / SMS',          'warm', 50),
  ('Email marketing',    'warm', 60),
  ('Newsletter',         'warm', 70),
  ('Lead magnet',        'warm', 80),
  ('Distributor',        'warm', 90),
  ('LinkedIn contacts',  'cold', 110),
  ('Alumni list',        'cold', 120),
  ('Phone directory',    'cold', 130),
  ('Profession list',    'cold', 140),
  ('Tracxn',             'cold', 150),
  ('Chamber of commerce','cold', 160),
  ('Other',              'warm', 999);

-- ───────────────────────── people (staff) ─────────────────────────

create table public.profiles (
  id               uuid primary key references auth.users(id) on delete cascade,
  email            text not null unique,
  full_name        text,
  avatar_url       text,
  role             text not null default 'rm' check (role in ('rm','admin')),
  unit             text not null default 'IQWM' references public.business_units(code),
  is_active        boolean not null default true,
  in_rotation      boolean not null default true,   -- receives round-robin leads
  last_assigned_at timestamptz,
  created_at       timestamptz not null default now()
);

-- Only @flamebackcapital.com Google accounts may sign up. The very first
-- person to sign in becomes admin so someone can manage the team.
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if lower(coalesce(new.email,'')) not like '%@flamebackcapital.com' then
    raise exception 'Only flamebackcapital.com accounts can use Flameback CRM';
  end if;
  insert into public.profiles (id, email, full_name, avatar_url, role)
  values (
    new.id,
    lower(new.email),
    coalesce(new.raw_user_meta_data->>'full_name', new.raw_user_meta_data->>'name', split_part(new.email,'@',1)),
    new.raw_user_meta_data->>'avatar_url',
    case when exists (select 1 from public.profiles) then 'rm' else 'admin' end
  );
  return new;
end $$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles where id = auth.uid() and role = 'admin' and is_active);
$$;

create or replace function public.is_staff()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles where id = auth.uid() and is_active);
$$;

-- ───────────────────────── leads ─────────────────────────

create type public.lead_bucket as enum
  ('active_contact','awaiting_meeting','holding','deferred','converting','out');

create table public.import_batches (
  id           uuid primary key default gen_random_uuid(),
  unit         text not null default 'IQWM' references public.business_units(code),
  file_name    text not null,
  source       text not null references public.lead_sources(name) on update cascade,
  campaign     text,
  product      text check (product in ('RIA','PMS')),
  dup_mode     text not null default 'skip' check (dup_mode in ('skip','merge')),
  uploaded_by  uuid not null references public.profiles(id),
  created_at   timestamptz not null default now(),
  total_rows   int not null default 0,
  inserted     int not null default 0,
  merged       int not null default 0,
  skipped      int not null default 0,
  failed       int not null default 0,
  undone_at    timestamptz,
  undone_count int
);

create table public.leads (
  id               uuid primary key default gen_random_uuid(),
  unit             text not null default 'IQWM' references public.business_units(code),
  name             text not null check (length(trim(name)) > 0),
  phone            text,           -- normalised: 10 digits for India, or +<digits>
  email            text,           -- lower-case
  city             text,
  age              int check (age is null or age between 16 and 110),
  marital_status   text,
  income_band      text,
  language         text,
  requirement      text,           -- what they want
  budget           text,
  product          text not null check (product in ('RIA','PMS')),
  source           text not null references public.lead_sources(name) on update cascade,
  campaign         text,
  referred_by      text,
  bucket           public.lead_bucket not null default 'active_contact',
  strikes          int not null default 0 check (strikes between 0 and 5),
  next_follow_up   date,
  meeting_at       timestamptz,
  deferred_until   date,
  out_reason       text,
  out_from_bucket  public.lead_bucket,
  out_at           timestamptz,
  converted_at     timestamptz,
  last_contact_at  timestamptz,
  rm_id            uuid not null references public.profiles(id),
  import_batch_id  uuid references public.import_batches(id) on delete set null,
  created_by       uuid references public.profiles(id),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  check (phone is not null or email is not null)
);

create unique index leads_unit_phone_uq on public.leads (unit, phone) where phone is not null;
create unique index leads_unit_email_uq on public.leads (unit, email) where email is not null;
create index leads_rm_bucket_idx on public.leads (rm_id, bucket);
create index leads_follow_up_idx on public.leads (next_follow_up) where bucket not in ('out','converting');
create index leads_name_trgm on public.leads using gin (name gin_trgm_ops);

create table public.lead_entries (
  id           uuid primary key default gen_random_uuid(),
  lead_id      uuid not null references public.leads(id) on delete cascade,
  kind         text not null check (kind in ('meet_call','phone_call','in_person','message','email','note')),
  occurred_at  timestamptz not null default now(),
  outcome      text check (outcome in ('connected','no_answer','call_back','not_interested','sent','replied')),
  notes        text,
  bucket_at    public.lead_bucket not null,     -- bucket the lead was in when logged
  strike_state text not null default 'none' check (strike_state in ('none','counted','pending')),
  created_by   uuid references public.profiles(id),
  created_at   timestamptz not null default now()
);
create index lead_entries_lead_idx on public.lead_entries (lead_id, occurred_at desc);
create index lead_entries_pending_idx on public.lead_entries (occurred_at) where strike_state = 'pending';

create table public.lead_events (
  id         bigint generated always as identity primary key,
  lead_id    uuid not null references public.leads(id) on delete cascade,
  kind       text not null,          -- created, assigned, bucket, strike, merged, edited, meeting
  from_value text,
  to_value   text,
  detail     jsonb,
  actor      uuid references public.profiles(id),
  at         timestamptz not null default now()
);
create index lead_events_lead_idx on public.lead_events (lead_id, at desc);

-- ───────────────────────── helpers ─────────────────────────

create or replace function public.ist_today()
returns date language sql stable as $$ select (now() at time zone 'Asia/Kolkata')::date $$;

-- 98200 12345 / +91-98200-12345 / 098200 12345 → 9820012345 ; other countries keep +<digits>
create or replace function public.normalize_phone(p text)
returns text language plpgsql immutable as $$
declare d text; plus boolean;
begin
  if p is null or btrim(p) = '' then return null; end if;
  plus := btrim(p) like '+%';
  d := regexp_replace(p, '\D', '', 'g');
  if d = '' then return null; end if;
  if length(d) = 12 and left(d,2) = '91' then return right(d,10); end if;
  if length(d) = 11 and left(d,1) = '0'  then return right(d,10); end if;
  if length(d) = 10 and not plus then return d; end if;
  if plus and left(d,2) = '91' and length(d) = 12 then return right(d,10); end if;
  if length(d) between 8 and 15 then return '+' || d; end if;
  return null;  -- unusable
end $$;

create or replace function public.normalize_email(p text)
returns text language sql immutable as $$
  select nullif(lower(btrim(p)), '')
$$;

create or replace function public.can_access_lead(p_lead uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select public.is_admin()
      or exists (select 1 from public.leads where id = p_lead and rm_id = auth.uid());
$$;

create or replace function public.assert_lead_access(p_lead uuid)
returns public.leads language plpgsql security definer set search_path = public as $$
declare l public.leads;
begin
  select * into l from public.leads where id = p_lead for update;
  if not found then raise exception 'Lead not found'; end if;
  if not (public.is_admin() or l.rm_id = auth.uid()) then
    raise exception 'You do not have access to this lead';
  end if;
  return l;
end $$;

-- Round-robin: the active RM in rotation who was assigned longest ago.
create or replace function public.next_rm(p_unit text default 'IQWM')
returns uuid language plpgsql security definer set search_path = public as $$
declare v uuid;
begin
  select id into v from public.profiles
   where is_active and in_rotation and unit = p_unit
   order by last_assigned_at asc nulls first, created_at asc
   limit 1
   for update skip locked;
  if v is null then
    v := auth.uid();   -- nobody in rotation: keep it with whoever added it
  end if;
  update public.profiles set last_assigned_at = clock_timestamp() where id = v;
  return v;
end $$;

create or replace function public.log_event(p_lead uuid, p_kind text, p_from text, p_to text, p_detail jsonb default null)
returns void language sql security definer set search_path = public as $$
  insert into public.lead_events (lead_id, kind, from_value, to_value, detail, actor)
  values (p_lead, p_kind, p_from, p_to, p_detail, auth.uid());
$$;

-- Internal: move a lead to another bucket, resetting strikes.
create or replace function public._move(p_lead uuid, p_to public.lead_bucket, p_reason text default null)
returns void language plpgsql security definer set search_path = public as $$
declare l public.leads;
begin
  select * into l from public.leads where id = p_lead;
  if l.bucket = p_to then return; end if;
  update public.leads set
    bucket          = p_to,
    strikes         = 0,
    out_reason      = case when p_to = 'out' then p_reason else null end,
    out_from_bucket = case when p_to = 'out' then l.bucket else null end,
    out_at          = case when p_to = 'out' then now() else null end,
    next_follow_up  = case when p_to in ('out','converting') then null else next_follow_up end,
    meeting_at      = case when p_to = 'awaiting_meeting' then meeting_at else null end,
    deferred_until  = case when p_to = 'deferred' then deferred_until else null end,
    converted_at    = case when p_to = 'converting' then now() else converted_at end,
    updated_at      = now()
  where id = p_lead;
  perform public.log_event(p_lead, 'bucket', l.bucket::text, p_to::text,
    case when p_reason is not null then jsonb_build_object('reason', p_reason) end);
end $$;

-- Internal: add one strike; at five the lead goes to the Out List.
create or replace function public._add_strike(p_lead uuid)
returns void language plpgsql security definer set search_path = public as $$
declare n int;
begin
  update public.leads set strikes = least(strikes + 1, 5), updated_at = now()
   where id = p_lead returning strikes into n;
  perform public.log_event(p_lead, 'strike', null, n::text);
  if n >= 5 then
    perform public._move(p_lead, 'out', '5 strikes');
  end if;
end $$;

-- ───────────────────────── duplicate check ─────────────────────────

-- Returns any existing lead in the unit with the same phone or email.
-- Works across RMs (so nobody re-adds a colleague's lead) but only reveals
-- the owner's name and bucket for leads the caller cannot open.
create or replace function public.find_duplicates(p_phone text, p_email text, p_unit text default 'IQWM')
returns table (lead_id uuid, name text, rm_name text, bucket public.lead_bucket, matched_on text, can_open boolean)
language sql stable security definer set search_path = public as $$
  select l.id, l.name, p.full_name, l.bucket,
         case when l.phone = public.normalize_phone(p_phone) then 'phone' else 'email' end,
         (public.is_admin() or l.rm_id = auth.uid())
    from public.leads l join public.profiles p on p.id = l.rm_id
   where public.is_staff() and l.unit = p_unit
     and ( (public.normalize_phone(p_phone) is not null and l.phone = public.normalize_phone(p_phone))
        or (public.normalize_email(p_email) is not null and l.email = public.normalize_email(p_email)) );
$$;

-- Bulk version for the upload preview: which of these phones / emails already exist?
create or replace function public.find_duplicates_bulk(p_phones text[], p_emails text[], p_unit text default 'IQWM')
returns table (phone text, email text, lead_id uuid, name text, rm_name text, can_open boolean)
language sql stable security definer set search_path = public as $$
  select l.phone, l.email, l.id, l.name, p.full_name, (public.is_admin() or l.rm_id = auth.uid())
    from public.leads l join public.profiles p on p.id = l.rm_id
   where public.is_staff() and l.unit = p_unit
     and ( l.phone = any (select public.normalize_phone(x) from unnest(p_phones) x)
        or l.email = any (select public.normalize_email(x) from unnest(p_emails) x) );
$$;

-- ───────────────────────── create / merge ─────────────────────────

-- p jsonb keys: name, phone, email, city, age, marital_status, income_band, language,
--               requirement, budget, product, source, campaign, referred_by, next_follow_up,
--               rm_id (admin only; otherwise round-robin)
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
  else
    v_rm := public.next_rm(v_unit);
  end if;

  insert into public.leads (unit, name, phone, email, city, age, marital_status, income_band, language,
                            requirement, budget, product, source, campaign, referred_by,
                            next_follow_up, rm_id, import_batch_id, created_by)
  values (v_unit, btrim(p->>'name'), v_phone, v_email, nullif(p->>'city',''),
          nullif(p->>'age','')::int, nullif(p->>'marital_status',''), nullif(p->>'income_band',''),
          nullif(p->>'language',''), nullif(p->>'requirement',''), nullif(p->>'budget',''),
          p->>'product', p->>'source', nullif(p->>'campaign',''), nullif(p->>'referred_by',''),
          coalesce(nullif(p->>'next_follow_up','')::date, public.ist_today()),
          v_rm, nullif(p->>'import_batch_id','')::uuid, auth.uid())
  returning id into v_id;

  perform public.log_event(v_id, 'created', null, null,
    jsonb_build_object('via', case when p ? 'import_batch_id' then 'upload' else 'manual' end));
  perform public.log_event(v_id, 'assigned', null, v_rm::text);
  return v_id;
end $$;

-- Fill the existing lead's empty fields from p, and note the merge on its timeline.
create or replace function public.merge_into_lead(p_lead uuid, p jsonb, p_note text default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare l public.leads;
begin
  l := public.assert_lead_access(p_lead);
  update public.leads set
    phone          = coalesce(phone, public.normalize_phone(p->>'phone')),
    email          = coalesce(email, public.normalize_email(p->>'email')),
    city           = coalesce(city, nullif(p->>'city','')),
    age            = coalesce(age, nullif(p->>'age','')::int),
    marital_status = coalesce(marital_status, nullif(p->>'marital_status','')),
    income_band    = coalesce(income_band, nullif(p->>'income_band','')),
    language       = coalesce(language, nullif(p->>'language','')),
    requirement    = coalesce(requirement, nullif(p->>'requirement','')),
    budget         = coalesce(budget, nullif(p->>'budget','')),
    campaign       = coalesce(campaign, nullif(p->>'campaign','')),
    referred_by    = coalesce(referred_by, nullif(p->>'referred_by','')),
    updated_at     = now()
  where id = p_lead;
  insert into public.lead_entries (lead_id, kind, notes, bucket_at, created_by)
  values (p_lead, 'note',
          coalesce(p_note, 'Duplicate merged in') || ' — source: ' || coalesce(p->>'source','?')
            || coalesce(' / ' || nullif(p->>'campaign',''), ''),
          l.bucket, auth.uid());
  perform public.log_event(p_lead, 'merged', null, null, p);
  return p_lead;
end $$;

-- ───────────────────────── edit ─────────────────────────

create or replace function public.update_lead(p_lead uuid, p jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare l public.leads; v_phone text; v_email text;
begin
  l := public.assert_lead_access(p_lead);
  v_phone := case when p ? 'phone' then public.normalize_phone(p->>'phone') else l.phone end;
  v_email := case when p ? 'email' then public.normalize_email(p->>'email') else l.email end;
  if p ? 'phone' and nullif(p->>'phone','') is not null and v_phone is null then
    raise exception 'Phone number "%" is not valid', p->>'phone';
  end if;
  if v_phone is null and v_email is null then raise exception 'A phone number or email is required'; end if;
  if exists (select 1 from public.leads where id <> p_lead and unit = l.unit and (phone = v_phone or email = v_email)) then
    raise exception 'DUPLICATE: another lead already has this phone or email';
  end if;
  update public.leads set
    name           = case when p ? 'name' then btrim(p->>'name') else name end,
    phone          = v_phone,
    email          = v_email,
    city           = case when p ? 'city' then nullif(p->>'city','') else city end,
    age            = case when p ? 'age' then nullif(p->>'age','')::int else age end,
    marital_status = case when p ? 'marital_status' then nullif(p->>'marital_status','') else marital_status end,
    income_band    = case when p ? 'income_band' then nullif(p->>'income_band','') else income_band end,
    language       = case when p ? 'language' then nullif(p->>'language','') else language end,
    requirement    = case when p ? 'requirement' then nullif(p->>'requirement','') else requirement end,
    budget         = case when p ? 'budget' then nullif(p->>'budget','') else budget end,
    product        = case when p ? 'product' then p->>'product' else product end,
    source         = case when p ? 'source' then p->>'source' else source end,
    campaign       = case when p ? 'campaign' then nullif(p->>'campaign','') else campaign end,
    referred_by    = case when p ? 'referred_by' then nullif(p->>'referred_by','') else referred_by end,
    next_follow_up = case when p ? 'next_follow_up' and l.bucket not in ('out','converting')
                          then nullif(p->>'next_follow_up','')::date else next_follow_up end,
    updated_at     = now()
  where id = p_lead;
  if p ? 'product' and p->>'product' is distinct from l.product then
    perform public.log_event(p_lead, 'edited', l.product, p->>'product', jsonb_build_object('field','product'));
  end if;
end $$;

-- ───────────────────────── log an entry (strike engine) ─────────────────────────

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
  elsif l.bucket in ('awaiting_meeting','holding') and v_outreach and p_outcome <> 'not_interested' then
    v_state := 'counted';                                   -- every reminder / follow-up counts
  end if;

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
  elsif l.bucket = 'active_contact' and p_outcome in ('connected','replied') then
    update public.leads set strikes = 0 where id = p_lead and strikes > 0;
    update public.lead_entries set strike_state = 'none'
     where lead_id = p_lead and strike_state = 'pending';
  elsif v_state = 'counted' then
    perform public._add_strike(p_lead);
  end if;
  return v_id;
end $$;

-- Change a message's outcome (e.g. Sent → Replied before the 48h window closes).
create or replace function public.set_entry_outcome(p_entry uuid, p_outcome text)
returns void language plpgsql security definer set search_path = public as $$
declare e public.lead_entries; l public.leads;
begin
  select * into e from public.lead_entries where id = p_entry;
  if not found then raise exception 'Entry not found'; end if;
  l := public.assert_lead_access(e.lead_id);
  if e.kind not in ('message','email') or p_outcome not in ('replied','not_interested') then
    raise exception 'Only a sent message can be changed to Replied or Not interested';
  end if;
  update public.lead_entries set outcome = p_outcome,
         strike_state = case when strike_state = 'pending' then 'none' else strike_state end
   where id = p_entry;
  if p_outcome = 'not_interested' then
    perform public._move(e.lead_id, 'out', 'Not interested');
  elsif l.bucket = 'active_contact' then
    update public.leads set strikes = 0, last_contact_at = now(), updated_at = now() where id = e.lead_id;
    update public.lead_entries set strike_state = 'none' where lead_id = e.lead_id and strike_state = 'pending';
  end if;
end $$;

-- ───────────────────────── bucket moves ─────────────────────────

-- Active contact → Awaiting meeting (lead showed interest). Meeting time optional.
create or replace function public.mark_interested(p_lead uuid, p_meeting_at timestamptz default null, p_next_follow_up date default null)
returns void language plpgsql security definer set search_path = public as $$
declare l public.leads;
begin
  l := public.assert_lead_access(p_lead);
  if l.bucket <> 'active_contact' then raise exception 'Lead is not in Active contact'; end if;
  perform public._move(p_lead, 'awaiting_meeting');
  update public.leads set meeting_at = p_meeting_at,
         next_follow_up = coalesce(p_next_follow_up, (p_meeting_at at time zone 'Asia/Kolkata')::date, public.ist_today() + 1)
   where id = p_lead;
  if p_meeting_at is not null then
    perform public.log_event(p_lead, 'meeting', null, p_meeting_at::text);
  end if;
end $$;

create or replace function public.set_meeting(p_lead uuid, p_meeting_at timestamptz)
returns void language plpgsql security definer set search_path = public as $$
declare l public.leads;
begin
  l := public.assert_lead_access(p_lead);
  if l.bucket <> 'awaiting_meeting' then raise exception 'Lead is not awaiting a meeting'; end if;
  update public.leads set meeting_at = p_meeting_at,
         next_follow_up = (p_meeting_at at time zone 'Asia/Kolkata')::date, updated_at = now()
   where id = p_lead;
  perform public.log_event(p_lead, 'meeting', l.meeting_at::text, p_meeting_at::text);
end $$;

-- First meeting held. p_result: commits | undecided | later
create or replace function public.record_meeting(
  p_lead uuid, p_result text, p_kind text, p_notes text,
  p_deferred_until date default null, p_next_follow_up date default null, p_product text default null)
returns void language plpgsql security definer set search_path = public as $$
declare l public.leads;
begin
  l := public.assert_lead_access(p_lead);
  if l.bucket not in ('awaiting_meeting','holding') then raise exception 'Lead has no meeting to record'; end if;
  if p_kind not in ('meet_call','in_person','phone_call') then raise exception 'Pick how the meeting happened'; end if;
  if coalesce(btrim(p_notes),'') = '' then raise exception 'Meeting notes are required'; end if;
  if p_result = 'later' and p_deferred_until is null then raise exception 'Pick the date they will come back'; end if;

  insert into public.lead_entries (lead_id, kind, outcome, notes, bucket_at, created_by)
  values (p_lead, p_kind, 'connected', btrim(p_notes), l.bucket, auth.uid());
  update public.leads set last_contact_at = now(),
         product = coalesce(p_product, product) where id = p_lead;

  if p_result = 'commits' then
    perform public._move(p_lead, 'converting');
  elsif p_result = 'undecided' then
    perform public._move(p_lead, 'holding');
    update public.leads set next_follow_up = coalesce(p_next_follow_up, public.ist_today() + 3) where id = p_lead;
  elsif p_result = 'later' then
    perform public._move(p_lead, 'deferred');
    update public.leads set deferred_until = p_deferred_until, next_follow_up = p_deferred_until where id = p_lead;
  else
    raise exception 'Unknown meeting result';
  end if;
end $$;

-- Holding → Converting (commits on a follow-up) or Holding → Deferred.
create or replace function public.mark_committed(p_lead uuid, p_product text default null)
returns void language plpgsql security definer set search_path = public as $$
declare l public.leads;
begin
  l := public.assert_lead_access(p_lead);
  if l.bucket not in ('holding','deferred','awaiting_meeting') then raise exception 'Lead cannot be marked committed from here'; end if;
  if p_product is not null then update public.leads set product = p_product where id = p_lead; end if;
  perform public._move(p_lead, 'converting');
end $$;

create or replace function public.defer_lead(p_lead uuid, p_until date)
returns void language plpgsql security definer set search_path = public as $$
declare l public.leads;
begin
  l := public.assert_lead_access(p_lead);
  if l.bucket not in ('holding','awaiting_meeting') then raise exception 'Only met or meeting-pending leads can be deferred'; end if;
  if p_until is null or p_until <= public.ist_today() then raise exception 'Pick a future date'; end if;
  perform public._move(p_lead, 'deferred');
  update public.leads set deferred_until = p_until, next_follow_up = p_until where id = p_lead;
end $$;

create or replace function public.mark_not_interested(p_lead uuid, p_note text default null)
returns void language plpgsql security definer set search_path = public as $$
declare l public.leads;
begin
  l := public.assert_lead_access(p_lead);
  if l.bucket in ('out','converting') then raise exception 'Lead is already closed'; end if;
  if coalesce(btrim(p_note),'') <> '' then
    insert into public.lead_entries (lead_id, kind, notes, bucket_at, created_by)
    values (p_lead, 'note', btrim(p_note), l.bucket, auth.uid());
  end if;
  perform public._move(p_lead, 'out', 'Not interested');
end $$;

-- Out List → back to the bucket it left (Active contact if it left from somewhere final).
create or replace function public.bring_back(p_lead uuid, p_next_follow_up date)
returns void language plpgsql security definer set search_path = public as $$
declare l public.leads; v_to public.lead_bucket;
begin
  l := public.assert_lead_access(p_lead);
  if l.bucket <> 'out' then raise exception 'Lead is not on the Out List'; end if;
  if p_next_follow_up is null then raise exception 'Pick the next follow-up date'; end if;
  v_to := case when l.out_from_bucket in ('active_contact','awaiting_meeting','holding') then l.out_from_bucket
               else 'active_contact' end;
  perform public._move(p_lead, v_to);
  update public.leads set next_follow_up = p_next_follow_up where id = p_lead;
end $$;

-- Converting → back (mistake / client changed mind before onboarding).
create or replace function public.undo_converting(p_lead uuid)
returns void language plpgsql security definer set search_path = public as $$
declare l public.leads;
begin
  l := public.assert_lead_access(p_lead);
  if l.bucket <> 'converting' then raise exception 'Lead is not converting'; end if;
  perform public._move(p_lead, 'holding');
  update public.leads set converted_at = null, next_follow_up = public.ist_today() where id = p_lead;
end $$;

-- Admin: hand a lead to another RM.
create or replace function public.reassign_lead(p_lead uuid, p_rm uuid)
returns void language plpgsql security definer set search_path = public as $$
declare l public.leads;
begin
  if not public.is_admin() then raise exception 'Only an admin can reassign leads'; end if;
  select * into l from public.leads where id = p_lead for update;
  if not exists (select 1 from public.profiles where id = p_rm and is_active) then raise exception 'Unknown RM'; end if;
  update public.leads set rm_id = p_rm, updated_at = now() where id = p_lead;
  perform public.log_event(p_lead, 'assigned', l.rm_id::text, p_rm::text);
end $$;

-- ───────────────────────── timed rules ─────────────────────────
-- Run every 15 minutes by pg_cron (below) and also opportunistically by the app.
create or replace function public.run_sweeps()
returns jsonb language plpgsql security definer set search_path = public as $$
declare r record; n_strikes int := 0; n_deferred int := 0;
begin
  -- 1. Messages sent >48h ago with no reply become strikes.
  for r in
    update public.lead_entries e set strike_state = 'counted'
      from public.leads l
     where e.lead_id = l.id and e.strike_state = 'pending'
       and e.occurred_at < now() - interval '48 hours'
       and l.bucket = 'active_contact'
    returning e.lead_id
  loop
    perform public._add_strike(r.lead_id);
    n_strikes := n_strikes + 1;
  end loop;
  -- pending strikes on leads that already moved on are void
  update public.lead_entries e set strike_state = 'none'
    from public.leads l
   where e.lead_id = l.id and e.strike_state = 'pending' and l.bucket <> 'active_contact';

  -- 2. Deferred leads whose date has come return to Holding.
  for r in select id, deferred_until from public.leads
            where bucket = 'deferred' and deferred_until <= public.ist_today()
  loop
    perform public._move(r.id, 'holding', 'Deferred date reached');
    update public.leads set next_follow_up = r.deferred_until where id = r.id;
    n_deferred := n_deferred + 1;
  end loop;

  return jsonb_build_object('strikes', n_strikes, 'deferred_returned', n_deferred);
end $$;

do $$
begin
  create extension if not exists pg_cron;
  perform cron.schedule('flameback-sweeps', '*/15 * * * *', 'select public.run_sweeps()');
exception when others then
  raise notice 'pg_cron not available (%). Sweeps will run when the app loads.', sqlerrm;
end $$;

-- ───────────────────────── bulk upload ─────────────────────────

create or replace function public.start_import(p_file_name text, p_source text, p_campaign text,
                                              p_product text, p_dup_mode text, p_total int)
returns uuid language plpgsql security definer set search_path = public as $$
declare v uuid;
begin
  if not public.is_staff() then raise exception 'Not signed in'; end if;
  insert into public.import_batches (file_name, source, campaign, product, dup_mode, uploaded_by, total_rows)
  values (p_file_name, p_source, nullif(p_campaign,''), p_product, p_dup_mode, auth.uid(), p_total)
  returning id into v;
  return v;
end $$;

-- p_rows: [{row: <excel row no>, name, phone, email, ..., product?, source?, campaign?, rm_email?}]
-- Returns one result per row: {row, status: inserted|merged|skipped|failed, lead_id?, message?}
create or replace function public.import_rows(p_batch uuid, p_rows jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  b public.import_batches; r jsonb; v_id uuid; v_dup uuid; v_dup_rm uuid; v_rm uuid;
  v_payload jsonb; out jsonb := '[]'::jsonb;
  c_ins int := 0; c_mer int := 0; c_skip int := 0; c_fail int := 0;
begin
  select * into b from public.import_batches where id = p_batch;
  if not found or (b.uploaded_by <> auth.uid() and not public.is_admin()) then
    raise exception 'Upload not found';
  end if;

  for r in select * from jsonb_array_elements(p_rows) loop
    begin
      v_payload := r
        || jsonb_build_object(
             'source',   coalesce(nullif(r->>'source',''), b.source),
             'campaign', coalesce(nullif(r->>'campaign',''), b.campaign),
             'product',  coalesce(nullif(upper(r->>'product'),''), b.product),
             'import_batch_id', p_batch);

      if coalesce(btrim(v_payload->>'name'),'') = '' then raise exception 'Name is missing'; end if;
      if (v_payload->>'product') not in ('RIA','PMS') then raise exception 'Product must be RIA or PMS'; end if;
      if not exists (select 1 from public.lead_sources where name = v_payload->>'source') then
        raise exception 'Unknown source "%"', v_payload->>'source';
      end if;
      if nullif(v_payload->>'phone','') is not null and public.normalize_phone(v_payload->>'phone') is null then
        raise exception 'Phone "%" is not valid', v_payload->>'phone';
      end if;

      select id, rm_id into v_dup, v_dup_rm from public.leads
       where unit = b.unit
         and ( (public.normalize_phone(v_payload->>'phone') is not null and phone = public.normalize_phone(v_payload->>'phone'))
            or (public.normalize_email(v_payload->>'email') is not null and email = public.normalize_email(v_payload->>'email')) )
       limit 1;

      if v_dup is not null then
        if b.dup_mode = 'merge' and (public.is_admin() or v_dup_rm = auth.uid()) then
          perform public.merge_into_lead(v_dup, v_payload, 'Merged from upload ' || b.file_name);
          c_mer := c_mer + 1;
          out := out || jsonb_build_object('row', r->'row', 'status', 'merged', 'lead_id', v_dup);
        else
          c_skip := c_skip + 1;
          out := out || jsonb_build_object('row', r->'row', 'status', 'skipped', 'lead_id', v_dup,
                 'message', 'Already exists' ||
                   coalesce(' (with ' || (select full_name from public.profiles where id = v_dup_rm) || ')', ''));
        end if;
        continue;
      end if;

      -- optional RM column (admins only): match by email
      v_rm := null;
      if public.is_admin() and nullif(r->>'rm_email','') is not null then
        select id into v_rm from public.profiles where email = lower(btrim(r->>'rm_email')) and is_active;
        if v_rm is null then raise exception 'No active RM with email %', r->>'rm_email'; end if;
        v_payload := v_payload || jsonb_build_object('rm_id', v_rm);
      end if;

      v_id := public.create_lead(v_payload);
      c_ins := c_ins + 1;
      out := out || jsonb_build_object('row', r->'row', 'status', 'inserted', 'lead_id', v_id);
    exception when others then
      c_fail := c_fail + 1;
      out := out || jsonb_build_object('row', r->'row', 'status', 'failed', 'message', sqlerrm);
    end;
  end loop;

  update public.import_batches set inserted = inserted + c_ins, merged = merged + c_mer,
         skipped = skipped + c_skip, failed = failed + c_fail
   where id = p_batch;
  return out;
end $$;

-- Undo an upload: deletes the leads it created that nobody has worked yet
-- (still Active contact, no entries logged). Merges are left in place.
create or replace function public.undo_import(p_batch uuid)
returns int language plpgsql security definer set search_path = public as $$
declare b public.import_batches; n int;
begin
  select * into b from public.import_batches where id = p_batch;
  if not found or (b.uploaded_by <> auth.uid() and not public.is_admin()) then raise exception 'Upload not found'; end if;
  if b.undone_at is not null then raise exception 'This upload was already undone'; end if;
  with del as (
    delete from public.leads l
     where l.import_batch_id = p_batch and l.bucket = 'active_contact' and l.strikes = 0
       and not exists (select 1 from public.lead_entries e where e.lead_id = l.id)
    returning 1)
  select count(*) into n from del;
  update public.import_batches set undone_at = now(), undone_count = n where id = p_batch;
  return n;
end $$;

-- ───────────────────────── row-level security ─────────────────────────

alter table public.business_units enable row level security;
alter table public.lead_sources   enable row level security;
alter table public.profiles       enable row level security;
alter table public.leads          enable row level security;
alter table public.lead_entries   enable row level security;
alter table public.lead_events    enable row level security;
alter table public.import_batches enable row level security;

create policy units_read   on public.business_units for select to authenticated using (public.is_staff());
create policy sources_read on public.lead_sources   for select to authenticated using (public.is_staff());
create policy sources_admin on public.lead_sources  for all    to authenticated using (public.is_admin()) with check (public.is_admin());

create policy profiles_read  on public.profiles for select to authenticated using (public.is_staff());
create policy profiles_admin on public.profiles for update to authenticated using (public.is_admin()) with check (public.is_admin());

create policy leads_read on public.leads for select to authenticated
  using (public.is_admin() or rm_id = auth.uid());

create policy entries_read on public.lead_entries for select to authenticated
  using (public.can_access_lead(lead_id));

create policy events_read on public.lead_events for select to authenticated
  using (public.can_access_lead(lead_id));

create policy batches_read on public.import_batches for select to authenticated
  using (public.is_admin() or uploaded_by = auth.uid());

-- No direct writes to leads / entries / events / batches: everything goes through the functions above.
revoke insert, update, delete on public.leads, public.lead_entries, public.lead_events, public.import_batches from anon, authenticated;
revoke all on all functions in schema public from anon;
revoke execute on function public._move(uuid, public.lead_bucket, text), public._add_strike(uuid),
                           public.log_event(uuid, text, text, text, jsonb), public.next_rm(text),
                           public.assert_lead_access(uuid) from authenticated, public;
