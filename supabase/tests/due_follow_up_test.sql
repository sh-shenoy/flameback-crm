\set ON_ERROR_STOP 1
insert into auth.users (id,email,raw_user_meta_data) values ('00000000-0000-0000-0000-0000000000ff','boss@flamebackcapital.com','{"full_name":"Boss"}');
insert into auth.users (id,email,raw_user_meta_data) values ('00000000-0000-0000-0000-00000000000b','priya@flamebackcapital.com','{"full_name":"Priya"}');
update profiles set is_active = true, approved_at = now(), in_rotation = true, team = 'Sales';
set role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-00000000000b',false);
create temp table k(n int, id uuid);
insert into k select g, create_lead(jsonb_build_object('name','D'||g,'phone','98118000'||lpad(g::text,2,'0'),'product','RIA','source','Meta')) from generate_series(1,4) g;
do $$ declare
  a uuid := (select id from k where n=1); b uuid := (select id from k where n=2);
  c uuid := (select id from k where n=3); d uuid := (select id from k where n=4);
begin
  -- 1: follow-up was due yesterday; called today, no answer, no new date → the due follow-up is done
  perform log_activity(a, 'phone_call', 'no_answer', null, null, ist_today());
  perform log_activity(a, 'phone_call', 'no_answer');
  assert (select next_follow_up from leads where id=a) is null, 'due follow-up (today) cleared by the call';
  -- 2: a follow-up still to come stays
  perform log_activity(b, 'phone_call', 'no_answer', null, null, ist_today() + 3);
  perform log_activity(b, 'message', 'sent', null, null, null, null, null, null, 'whatsapp');
  assert (select next_follow_up from leads where id=b) = ist_today() + 3, 'future follow-up kept';
  -- 3: a new date from the RM replaces the old one
  perform log_activity(c, 'phone_call', 'no_answer', null, null, ist_today());
  perform log_activity(c, 'phone_call', 'no_answer', null, null, ist_today() + 2);
  assert (select next_follow_up from leads where id=c) = ist_today() + 2, 'new date replaces';
  -- 4: a note is not a follow-up
  perform log_activity(d, 'phone_call', 'no_answer', null, null, ist_today());
  perform log_activity(d, 'note', null, 'Will call after lunch');
  assert (select next_follow_up from leads where id=d) = ist_today(), 'a note leaves the date';
  -- a timed follow-up later today stays when you call about something else earlier
  perform set_follow_up(d, now() + interval '5 hours');
  perform log_activity(d, 'message', 'sent', null, null, null, null, null, null, 'whatsapp');
  assert (select next_follow_up_at from leads where id=d) is not null or (now() + interval '5 hours') at time zone 'Asia/Kolkata' >= (ist_today() + 1)::timestamp,
    'later-today follow-up kept';
end $$;
reset role;
select 'DUE FOLLOW-UP TESTS PASSED' as result;
