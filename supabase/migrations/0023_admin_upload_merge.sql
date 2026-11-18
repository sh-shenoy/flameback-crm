-- Argus · 0023: admins can merge duplicates when uploading
--
-- Since 0021 admins can't change leads, which also stopped "merge duplicates" in an admin's upload.
-- Filling a lead's empty fields from an uploaded row is housekeeping, so admins may do it again.

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
