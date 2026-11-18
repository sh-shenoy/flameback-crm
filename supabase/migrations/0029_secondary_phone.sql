-- Argus · 0029: a second phone number per lead
--
-- leads.alt_phone (cleaned like the main number). Shown and edited on the profile, set from Add lead
-- and Upload, matched by search, and part of the duplicate check: a number that is anyone's main or
-- secondary number counts as the same person.

alter table public.leads add column if not exists alt_phone text;
create index if not exists leads_alt_phone_idx on public.leads (unit, alt_phone) where alt_phone is not null;

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
          nullif(p->>'next_follow_up','')::date,                      -- new leads aren't follow-ups yet
          v_rm, nullif(p->>'import_batch_id','')::uuid, auth.uid())
  returning id into v_id;
  if p->>'residency' in ('resident','nri') then update public.leads set residency = p->>'residency' where id = v_id; end if;
  if v_alt is not null then update public.leads set alt_phone = v_alt where id = v_id; end if;

  perform public.log_event(v_id, 'created', null, null,
    jsonb_build_object('via', case when p ? 'import_batch_id' then 'upload' else 'manual' end));
  perform public.log_event(v_id, 'assigned', null, v_rm::text);
  return v_id;
end $$;

create or replace function public.update_lead(p_lead uuid, p jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare l public.leads; v_phone text; v_email text; v_alt text;
begin
  l := public.assert_lead_access(p_lead);
  v_phone := case when p ? 'phone' then public.normalize_phone(p->>'phone') else l.phone end;
  v_email := case when p ? 'email' then public.normalize_email(p->>'email') else l.email end;
  if p ? 'phone' and nullif(p->>'phone','') is not null and v_phone is null then
    raise exception 'Phone number "%" is not valid', p->>'phone';
  end if;
  if v_phone is null and v_email is null then raise exception 'A phone number or email is required'; end if;
  v_alt := case when p ? 'alt_phone' then public.normalize_phone(p->>'alt_phone') else l.alt_phone end;
  if p ? 'alt_phone' and nullif(p->>'alt_phone','') is not null and v_alt is null then
    raise exception 'Secondary number "%" is not valid', p->>'alt_phone';
  end if;
  if v_alt = v_phone then v_alt := null; end if;
  if exists (select 1 from public.leads where id <> p_lead and unit = l.unit
               and (phone in (v_phone, v_alt) or alt_phone in (v_phone, v_alt) or email = v_email)) then
    raise exception 'DUPLICATE: another lead already has this phone or email';
  end if;
  update public.leads set
    name           = case when p ? 'name' then btrim(p->>'name') else name end,
    phone          = v_phone,
    email          = v_email,
    alt_phone      = v_alt,
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

create or replace function public.find_duplicates(p_phone text, p_email text, p_unit text default 'IQWM')
returns table (lead_id uuid, name text, rm_name text, bucket public.lead_bucket, matched_on text, can_open boolean)
language sql stable security definer set search_path = public as $$
  select l.id, l.name, p.full_name, l.bucket,
         case when l.phone = public.normalize_phone(p_phone) or l.alt_phone = public.normalize_phone(p_phone) then 'phone' else 'email' end,
         (public.is_admin() or l.rm_id = auth.uid())
    from public.leads l join public.profiles p on p.id = l.rm_id
   where public.is_staff() and l.unit = p_unit
     and ( (public.normalize_phone(p_phone) is not null and public.normalize_phone(p_phone) in (l.phone, l.alt_phone))
        or (public.normalize_email(p_email) is not null and l.email = public.normalize_email(p_email)) );
$$;


create or replace function public.find_duplicates_bulk(p_phones text[], p_emails text[], p_unit text default 'IQWM')
returns table (phone text, email text, lead_id uuid, name text, rm_name text, can_open boolean)
language sql stable security definer set search_path = public as $$
  select case when l.alt_phone = any (select public.normalize_phone(x) from unnest(p_phones) x) then l.alt_phone else l.phone end,
         l.email, l.id, l.name, p.full_name, (public.is_admin() or l.rm_id = auth.uid())
    from public.leads l join public.profiles p on p.id = l.rm_id
   where public.is_staff() and l.unit = p_unit
     and ( l.phone = any (select public.normalize_phone(x) from unnest(p_phones) x)
        or l.alt_phone = any (select public.normalize_phone(x) from unnest(p_phones) x)
        or l.email = any (select public.normalize_email(x) from unnest(p_emails) x) );
$$;


create or replace function public.merge_into_lead(p_lead uuid, p jsonb, p_note text default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare l public.leads;
begin
  -- merging upload data into an existing lead is housekeeping: the lead's RM or an admin
  select * into l from public.leads where id = p_lead for update;
  if not found then raise exception 'Lead not found'; end if;
  if not (public.is_admin() or l.rm_id = auth.uid()) then raise exception 'You do not have access to this lead'; end if;
  update public.leads set
    phone          = coalesce(phone, public.normalize_phone(p->>'phone')),
    email          = coalesce(email, public.normalize_email(p->>'email')),
    alt_phone      = coalesce(alt_phone, nullif(public.normalize_phone(p->>'alt_phone'), phone)),
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
