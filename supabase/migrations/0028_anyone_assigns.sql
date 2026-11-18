-- Argus · 0028: whoever adds or uploads leads can choose who gets them
--
-- Add lead and Upload offer: Round-robin (automatic routing), Me, or any RM by name — for RMs as well
-- as admins. The chosen person must be an active RM (never an admin).

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

  perform public.log_event(v_id, 'created', null, null,
    jsonb_build_object('via', case when p ? 'import_batch_id' then 'upload' else 'manual' end));
  perform public.log_event(v_id, 'assigned', null, v_rm::text);
  return v_id;
end $$;
