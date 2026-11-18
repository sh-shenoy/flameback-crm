-- Argus · 0025: phone numbers written with 0091, 00 or a (0) after +91
--
-- Indian numbers end up as 10 digits; others keep +country code. Newly handled:
--   +91 (0) 98200 11111, +91-098200-11111  → 9820011111   (the 0 trunk prefix after 91)
--   0091 98200 11111                       → 9820011111   (00 = international prefix)
--   00971 50 123 4567                      → +971501234567
--   98200 111 (no + and under 10 digits)   → rejected (too short to be a number)
-- Existing numbers are re-cleaned; a lead whose cleaned number would clash with another lead keeps
-- its current value.

create or replace function public.normalize_phone(p text)
returns text language plpgsql immutable as $$
declare d text; plus boolean;
begin
  if p is null or btrim(p) = '' then return null; end if;
  plus := btrim(p) like '+%';
  d := regexp_replace(p, '\D', '', 'g');
  if d = '' then return null; end if;
  if left(d, 2) = '00' then d := substr(d, 3); plus := true; end if;          -- 00 = international prefix
  if length(d) = 12 and left(d, 2) = '91' then return right(d, 10); end if;   -- 91 + number
  if length(d) = 13 and left(d, 3) = '910' then return right(d, 10); end if;  -- 91 (0) number
  if not plus then
    if length(d) = 11 and left(d, 1) = '0' then return right(d, 10); end if;  -- 0 + number
    if length(d) = 10 then return d; end if;
    if length(d) < 10 then return null; end if;                               -- too short
  end if;
  if length(d) between 8 and 15 then return '+' || d; end if;
  return null;  -- unusable
end $$;

do $$ declare r record; v text; begin
  for r in select id, phone from public.leads where phone is not null loop
    v := public.normalize_phone(r.phone);
    if v is not null and v <> r.phone then
      begin
        update public.leads set phone = v where id = r.id;
      exception when unique_violation then null;   -- another lead already has it; leave this one
      end;
    end if;
  end loop;
end $$;
