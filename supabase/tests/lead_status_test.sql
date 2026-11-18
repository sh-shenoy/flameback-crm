\set ON_ERROR_STOP 1
insert into auth.users (id,email,raw_user_meta_data) values ('00000000-0000-0000-0000-0000000000ff','boss@flamebackcapital.com','{"full_name":"Boss"}');
insert into auth.users (id,email,raw_user_meta_data) values ('00000000-0000-0000-0000-00000000000b','priya@flamebackcapital.com','{"full_name":"Priya"}');
update profiles set is_active = true, approved_at = now(), in_rotation = true, team = 'Sales';
set role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-00000000000b',false);
create temp table k(n int, id uuid);
insert into k select g, create_lead(jsonb_build_object('name','S'||g,'phone','98117000'||lpad(g::text,2,'0'),'product','RIA','source',
  (array['Cold Lead','DoubleTick','IVR Call','smallcase','Walk-in','Metabase'])[g])) from generate_series(1,6) g;
do $$ declare
  a uuid := (select id from k where n=1); b uuid := (select id from k where n=2); c uuid := (select id from k where n=3);
  d uuid := (select id from k where n=4); e uuid := (select id from k where n=5); f uuid := (select id from k where n=6);
begin
  assert (select count(*) from leads where source in ('Cold Lead','DoubleTick','IVR Call','smallcase','Walk-in','Metabase')) = 6, 'new sources';
  -- DNP = no answer: a strike, Not picked up
  perform log_activity(a, 'phone_call', null, null, null, null, null, null, null, null, 'DNP');
  assert (select outcome from lead_entries where lead_id=a) = 'no_answer' and (select lead_status from lead_entries where lead_id=a) = 'DNP', 'DNP entry';
  assert (select strikes from leads where id=a) = 1 and (select lead_status from leads where id=a) = 'DNP', 'DNP lead';
  assert (select spoke_at is null and first_attempt_at is not null from leads where id=a), 'not picked up';
  -- Demo Required = spoke
  perform log_activity(b, 'phone_call', null, 'Wants a demo of the app', null, ist_today()+2, null, null, null, null, 'Demo Required');
  assert (select outcome from lead_entries where lead_id=b) = 'connected' and (select spoke_at is not null from leads where id=b), 'spoke';
  -- Interested + Wants to meet
  perform log_activity(c, 'phone_call', null, 'Keen', null, null, 'interested', null, null, null, 'Interested');
  assert (select bucket::text from leads where id=c) = 'awaiting_meeting' and (select lead_status from leads where id=c) = 'Interested', 'interested';
  -- Not Interested → Out List
  perform log_activity(d, 'phone_call', null, 'Has an advisor', null, null, null, null, null, null, 'Not Interested');
  assert (select bucket::text from leads where id=d) = 'out', 'not interested';
  -- Invalid Number → Out List with the reason
  perform log_activity(e, 'phone_call', null, null, null, null, null, null, null, null, 'Invalid Number');
  assert (select bucket::text from leads where id=e) = 'out' and (select out_reason from leads where id=e) = 'Invalid number', 'invalid number';
  -- change status without a call
  perform set_lead_status(f, 'Payment Completed');
  assert (select lead_status from leads where id=f) = 'Payment Completed', 'set status';
  assert (select count(*) from lead_events where lead_id=f and kind='status' and to_value='Payment Completed') = 1, 'status event';
  begin perform set_lead_status(f, 'Made up'); raise exception 'FAIL unknown';
  exception when others then if sqlerrm like 'FAIL%' then raise; end if; end;
  begin perform log_activity(f, 'note', null, 'x', null, null, null, null, null, null, 'DNP'); raise exception 'FAIL note';
  exception when others then if sqlerrm like 'FAIL%' then raise; end if; end;
end $$;
-- only admins edit the list
do $$ begin
  insert into lead_statuses (name, outcome) values ('Hack', 'connected'); raise exception 'FAIL rm insert';
exception when others then if sqlerrm like 'FAIL%' then raise; end if; end $$;
reset role;
select 'LEAD STATUS TESTS PASSED' as result;
