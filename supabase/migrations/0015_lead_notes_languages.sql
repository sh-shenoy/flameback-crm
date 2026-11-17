-- Argus · 0015: general notes on each lead, and more than one language
--
--  * leads.general_notes: a free notes box per lead (anything the RM wants to keep). Saved with
--    save_lead_notes; the AI summary reads it (saving bumps updated_at, so the summary refreshes).
--  * languages: a lead can speak several. leads.language keeps a tidy comma-separated list
--    ("Hindi, English"), so manual add, upload and the profile form work unchanged; leads.languages
--    is the same as an array for filtering.

alter table public.leads add column if not exists general_notes text;
alter table public.leads add column if not exists notes_updated_at timestamptz;
alter table public.leads add column if not exists notes_updated_by uuid references public.profiles(id);

create or replace function public.save_lead_notes(p_lead uuid, p_notes text)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform public.assert_lead_access(p_lead);
  if length(coalesce(p_notes, '')) > 20000 then raise exception 'Notes are too long (20,000 characters max)'; end if;
  update public.leads set general_notes = nullif(btrim(coalesce(p_notes, '')), ''),
         notes_updated_at = now(), notes_updated_by = auth.uid(), updated_at = now()
   where id = p_lead;
end $$;

revoke execute on function public.save_lead_notes(uuid, text) from anon, public;
grant execute on function public.save_lead_notes(uuid, text) to authenticated;

-- languages: "hindi / english; Hindi" → "Hindi, English"
create or replace function public.normalize_languages(p text)
returns text language sql immutable as $$
  select nullif(string_agg(l, ', ' order by first_pos), '')
  from (
    select initcap(btrim(x)) as l, min(ord) as first_pos
    from unnest(regexp_split_to_array(coalesce(p, ''), '\s*[,;/|&]\s*|\s+and\s+')) with ordinality as t(x, ord)
    where btrim(x) <> ''
    group by initcap(btrim(x))
  ) s;
$$;

create or replace function public._leads_languages()
returns trigger language plpgsql as $$
begin
  new.language := public.normalize_languages(new.language);
  return new;
end $$;

drop trigger if exists leads_languages on public.leads;
create trigger leads_languages before insert or update of language on public.leads
  for each row execute function public._leads_languages();

update public.leads set language = language where language is not null;   -- tidy existing values

alter table public.leads add column if not exists languages text[]
  generated always as (case when language is null then null else regexp_split_to_array(language, ', ') end) stored;
