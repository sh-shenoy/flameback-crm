\set ON_ERROR_STOP 1
insert into auth.users (id,email,raw_user_meta_data) values ('00000000-0000-0000-0000-00000000000b','priya@flamebackcapital.com','{"full_name":"Priya"}');
update profiles set is_active = true, approved_at = now(), in_rotation = true;
set role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-00000000000b',false);
create temp table k(n int, id uuid);
insert into k select g, create_lead(jsonb_build_object('name','O'||g,'phone','98222000'||(10+g),'product','RIA','source','Meta')) from generate_series(1,5) g;
do $$ declare a uuid := (select id from k where n=1); b uuid := (select id from k where n=2); c uuid := (select id from k where n=3);
              d uuid := (select id from k where n=4); e uuid := (select id from k where n=5); begin
  perform log_activity(a, 'phone_call', 'no_answer');
  -- wants to meet, no time yet
  perform log_activity(a, 'phone_call', 'connected', 'Keen, will confirm a slot', null, null, 'interested');
  assert (select bucket from leads where id=a)='awaiting_meeting' and (select strikes from leads where id=a)=0, 'interested -> awaiting';
  assert (select next_follow_up from leads where id=a)=ist_today()+1, 'follow-up tomorrow';
  assert (select count(*) from lead_entries where lead_id=a and outcome='connected')=1, 'conversation logged';
  -- met somewhere, still thinking
  perform log_activity(b, 'in_person', null, 'Met at the club, discussed PMS', null, null, 'met');
  assert (select bucket from leads where id=b)='holding' and (select next_follow_up from leads where id=b)=ist_today()+7, 'met -> holding';
  -- committed on the first call
  perform log_activity(c, 'phone_call', 'connected', 'Ready to go', null, null, 'commits', null, 'PMS');
  assert (select bucket from leads where id=c)='converting' and (select product from leads where id=c)='PMS', 'commits';
  -- later
  perform log_activity(d, 'message', 'replied', 'After Diwali', null, null, 'later', ist_today()+25);
  assert (select bucket from leads where id=d)='deferred', 'later';
  -- just a chat
  perform log_activity(e, 'phone_call', 'connected', 'Intro chat');
  assert (select bucket from leads where id=e)='active_contact', 'stays';
  -- a decision needs them to have picked up
  begin perform log_activity(e, 'phone_call', 'no_answer', null, null, null, 'met'); raise exception 'FAIL no answer';
  exception when others then if sqlerrm like 'FAIL%' then raise; end if; end;
  -- 'interested' only from active contact
  begin perform log_activity(a, 'phone_call', 'connected', 'x', null, null, 'interested'); raise exception 'FAIL interested twice';
  exception when others then if sqlerrm like 'FAIL%' then raise; end if; end;
end $$;
reset role;
select 'OUTCOME FROM ACTIVE CONTACT TESTS PASSED' as result;
