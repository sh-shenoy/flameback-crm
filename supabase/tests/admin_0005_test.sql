-- Tests for 0005: admin stats, nudges, bulk reassign.
\set ON_ERROR_STOP 1
insert into auth.users (id,email,raw_user_meta_data) values ('00000000-0000-0000-0000-00000000000a','shashank@flamebackcapital.com','{"full_name":"Shashank"}');
insert into auth.users (id,email,raw_user_meta_data) values ('00000000-0000-0000-0000-00000000000b','priya@flamebackcapital.com','{"full_name":"Priya"}'),
                                                            ('00000000-0000-0000-0000-00000000000c','arjun@flamebackcapital.com','{"full_name":"Arjun"}');
update profiles set is_active = true, approved_at = now(), in_rotation = (email = 'priya@flamebackcapital.com');

set role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-00000000000b',false); -- Priya
create temp table k(n int, id uuid);
insert into k select g, create_lead(jsonb_build_object('name','L'||g,'phone','98111000'||(10+g),'product','RIA','source','Meta')) from generate_series(1,5) g;
select log_entry((select id from k where n=1),'phone_call','no_answer');
do $$ begin
  begin perform * from admin_team_stats(ist_today()-7, ist_today()); raise exception 'FAIL rm saw stats';
  exception when others then if sqlerrm like 'FAIL%' then raise; end if; end;
  begin perform send_nudge('00000000-0000-0000-0000-00000000000c','hi'); raise exception 'FAIL rm nudged';
  exception when others then if sqlerrm like 'FAIL%' then raise; end if; end;
end $$;
reset role;
update leads set next_follow_up = ist_today() - 2 where id in (select id from k where n in (2,3));
update leads set bucket = 'awaiting_meeting', meeting_at = now() - interval '3 hours' where id = (select id from k where n = 4);
update leads set created_at = now() - interval '10 days' where id = (select id from k where n = 5);

set role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-00000000000a',false); -- admin
do $$ declare r record; begin
  select * into r from admin_team_stats(ist_today()-7, ist_today()) where email='priya@flamebackcapital.com';
  assert r.open_leads=5, 'open ' || r.open_leads;
  assert r.overdue=2, 'overdue ' || r.overdue;
  assert r.meetings_unrecorded=1, 'unrecorded';
  assert r.untouched_7d=1, 'untouched ' || r.untouched_7d;
  assert r.entries=1 and r.calls=1, 'activity';
  assert r.new_leads=4, 'new in period ' || r.new_leads;
  perform send_nudge('00000000-0000-0000-0000-00000000000b','You have 2 overdue follow-ups','/leads?due=overdue');
  assert (select last_nudged_at from admin_team_stats(ist_today()-7, ist_today()) where email='priya@flamebackcapital.com') is not null, 'nudge recorded';
  assert reassign_leads(array(select id from k where n in (1,2,3)), '00000000-0000-0000-0000-00000000000c') = 3, 'reassigned 3';
end $$;
reset role;
do $$ begin
  assert (select count(*) from leads where rm_id='00000000-0000-0000-0000-00000000000c')=3, 'arjun has 3';
  assert (select count(*) from notifications where user_id='00000000-0000-0000-0000-00000000000c' and kind='lead_assigned')=1, 'one batch notification, got ' || (select count(*) from notifications where user_id='00000000-0000-0000-0000-00000000000c' and kind='lead_assigned');
  assert (select count(*) from notifications where user_id='00000000-0000-0000-0000-00000000000b' and kind='nudge')=1, 'nudge notified';
  assert (select count(*) from lead_events where kind='assigned' and to_value='00000000-0000-0000-0000-00000000000c')=3, 'history kept';
end $$;
-- a normal single reassign still notifies
set role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-00000000000a',false);
select reassign_lead((select id from k where n=4), '00000000-0000-0000-0000-00000000000c');
reset role;
do $$ begin assert (select count(*) from notifications where user_id='00000000-0000-0000-0000-00000000000c' and kind='lead_assigned')=2, 'single reassign notifies'; end $$;
select 'ADMIN 0005 TESTS PASSED' as result;
