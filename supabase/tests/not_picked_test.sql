\set ON_ERROR_STOP 1
insert into auth.users (id,email,raw_user_meta_data) values ('00000000-0000-0000-0000-0000000000ff','boss@flamebackcapital.com','{"full_name":"Boss"}');
insert into auth.users (id,email,raw_user_meta_data) values ('00000000-0000-0000-0000-00000000000b','priya@flamebackcapital.com','{"full_name":"Priya"}');
update profiles set is_active = true, approved_at = now(), in_rotation = true, team = 'Sales';
set role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-00000000000b',false);
create temp table k(n int, id uuid);
insert into k select g, create_lead(jsonb_build_object('name','L'||g,'phone','98116000'||lpad(g::text,2,'0'),'product','RIA','source','Meta')) from generate_series(1,6) g;
do $$ declare
  a uuid := (select id from k where n=1); b uuid := (select id from k where n=2); c uuid := (select id from k where n=3);
  d uuid := (select id from k where n=4); e uuid := (select id from k where n=5); f uuid := (select id from k where n=6);
  st text;
begin
  -- 1: untouched → New
  -- 2: no answer → Not picked up (no date needed)
  perform log_activity(b, 'phone_call', 'no_answer');
  -- 3: message sent, no reply → Not picked up; a note doesn't count
  perform log_activity(c, 'message', 'sent', null, null, null, null, null, null, 'whatsapp');
  perform log_activity(c, 'note', null, 'Try evenings');
  -- 4: picked up → Follow-up
  perform log_activity(d, 'phone_call', 'no_answer');
  perform log_activity(d, 'phone_call', 'connected', 'Spoke about RIA', null, ist_today()+3);
  -- 5: asked to call back → spoke
  perform log_activity(e, 'phone_call', 'call_back', null, null, ist_today()+1);
  -- 6: Wants to meet, then moved back to Follow-up by hand: they engaged
  perform mark_interested(f);
  perform set_bucket(f, 'active_contact', null, ist_today()+2);
  for st in select format('%s:%s', k.n, case when spoke_at is not null then 'follow_up' when first_attempt_at is not null then 'not_picked' else 'new' end)
              from leads l join k on k.id = l.id order by k.n loop raise notice '%', st; end loop;
  assert (select first_attempt_at is null and spoke_at is null from leads where id=a), 'new';
  assert (select first_attempt_at is not null and spoke_at is null from leads where id=b), 'no answer = not picked up';
  assert (select first_attempt_at is not null and spoke_at is null from leads where id=c), 'message sent = not picked up';
  assert (select spoke_at is not null from leads where id=d), 'connected = follow-up';
  assert (select spoke_at is not null from leads where id=e), 'call back = follow-up';
  assert (select spoke_at is not null and bucket::text = 'active_contact' from leads where id=f), 'came back from Awaiting meeting = follow-up';
  assert (select next_follow_up from leads where id=b) is null, 'no automatic date';
end $$;
-- the report counts each
do $$ declare r record; begin
  select * into r from report_conversion(ist_today(), ist_today(), 'rm', '00000000-0000-0000-0000-00000000000b');
  assert r.new_now = 1 and r.not_picked_now = 2 and r.follow_up_now = 3, format('report %s', r);
end $$;
-- deleting the only answered call puts it back to Not picked up
reset role;
delete from lead_entries where lead_id = (select id from k where n=4) and outcome = 'connected';
do $$ begin
  assert (select first_attempt_at is not null and spoke_at is null from leads where id=(select id from k where n=4)), 'recomputed after delete';
end $$;
select 'NOT PICKED UP TESTS PASSED' as result;
