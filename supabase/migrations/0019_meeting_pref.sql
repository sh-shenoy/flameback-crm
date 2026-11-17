-- Argus · 0019: each lead's preferred video app (Google Meet or Zoom)
--
-- Used as the default when an RM books through Cal.com and the meeting type offers both.
-- Booking with a choice also saves it (done by the calcom edge function with the service role).

alter table public.leads add column if not exists meeting_pref text check (meeting_pref in ('google-meet','zoom'));

create or replace function public.set_meeting_pref(p_lead uuid, p_pref text)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform public.assert_lead_access(p_lead);
  if p_pref is not null and p_pref not in ('google-meet','zoom') then raise exception 'Google Meet or Zoom'; end if;
  update public.leads set meeting_pref = p_pref, updated_at = now() where id = p_lead;
end $$;

revoke execute on function public.set_meeting_pref(uuid, text) from anon, public;
grant execute on function public.set_meeting_pref(uuid, text) to authenticated;
