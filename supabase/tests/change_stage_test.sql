\set ON_ERROR_STOP 1
insert into auth.users (id,email,raw_user_meta_data) values ('00000000-0000-0000-0000-0000000000ff','boss@flamebackcapital.com','{"full_name":"Boss"}');  -- first sign-in = admin; Argus always keeps one
insert into auth.users (id,email,raw_user_meta_data) values ('00000000-0000-0000-0000-00000000000a','shashank@flamebackcapital.com','{"full_name":"Shashank"}');
insert into auth.users (id,email,raw_user_meta_data) values ('00000000-0000-0000-0000-00000000000b','priya@flamebackcapital.com','{"full_name":"Priya"}');
update profiles set is_active = true, approved_at = now(), in_rotation = (email = 'priya@flamebackcapital.com');
set role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-00000000000b',false); -- Priya (RM)
create temp table k(n int, id uuid);
insert into k select g, create_lead(jsonb_build_object('name','S'||g,'phone','98111000'||(10+g),'product','RIA','source','Meta')) from generate_series(1,3) g;
do $$ declare a uuid := (select id from k where n=1); b uuid := (select id from k where n=2); c uuid := (select id from k where n=3); begin
  -- awaiting meeting, spoke but no meeting fixed → back to active contact, no strike
  perform mark_interested(a);
  perform log_activity(a, 'phone_call', 'no_answer');
  assert (select strikes from leads where id=a)=1, 'reminder strike';
  perform log_activity(a, 'phone_call', 'connected', 'Busy this month, call in two weeks', null, null, 'contact');
  assert (select bucket from leads where id=a)='active_contact' and (select strikes from leads where id=a)=0, 'contact -> active, no strike';
  assert (select next_follow_up from leads where id=a)=ist_today()+2, 'default follow-up 2d';
  assert (select count(*) from lead_entries where lead_id=a and outcome='connected' and notes like 'Busy%')=1, 'conversation logged';
  begin perform log_activity(a, 'phone_call', 'connected', 'x', null, null, 'contact'); exception when others then raise; end; -- in active contact: plain log
  -- manual stage changes
  perform set_bucket(b, 'awaiting_meeting', 'Agreed to meet, date tbc');
  assert (select bucket from leads where id=b)='awaiting_meeting' and (select next_follow_up from leads where id=b)=ist_today()+1, 'to awaiting';
  perform set_bucket(b, 'active_contact', null, ist_today()+5);
  assert (select bucket from leads where id=b)='active_contact' and (select next_follow_up from leads where id=b)=ist_today()+5, 'back to active';
  perform set_bucket(b, 'holding');
  assert (select next_follow_up from leads where id=b)=ist_today()+7, 'holding cadence';
  begin perform set_bucket(b, 'deferred'); raise exception 'FAIL deferred without date';
  exception when others then if sqlerrm like 'FAIL%' then raise; end if; end;
  perform set_bucket(b, 'deferred', null, null, ist_today()+30);
  assert (select deferred_until from leads where id=b)=ist_today()+30, 'deferred';
  perform set_bucket(b, 'converting', null, null, null, 'pms');
  assert (select bucket from leads where id=b)='converting' and (select product from leads where id=b)='PMS', 'converting';
  perform set_bucket(c, 'out', 'Wrong number');
  assert (select out_reason from leads where id=c)='Moved by hand', 'out';
  assert (select count(*) from lead_entries where lead_id=c and kind='note' and notes='Wrong number')=1, 'note kept';
  begin perform set_bucket(c, 'out'); raise exception 'FAIL same stage';
  exception when others then if sqlerrm like 'FAIL%' then raise; end if; end;
end $$;
-- another RM can't move someone else's lead
reset role;
update profiles set role='rm' where id='00000000-0000-0000-0000-00000000000a';
set role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-00000000000a',false);
do $$ begin
  begin perform set_bucket((select id from k where n=1), 'out'); raise exception 'FAIL other rm';
  exception when others then if sqlerrm like 'FAIL%' then raise; end if; end;
end $$;
reset role;
select 'CHANGE STAGE TESTS PASSED' as result;
