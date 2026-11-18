\set ON_ERROR_STOP 1
insert into auth.users (id,email,raw_user_meta_data) values ('00000000-0000-0000-0000-0000000000ff','boss@flamebackcapital.com','{"full_name":"Boss"}');
insert into auth.users (id,email,raw_user_meta_data) values ('00000000-0000-0000-0000-00000000000b','priya@flamebackcapital.com','{"full_name":"Priya"}');
update profiles set is_active = true, approved_at = now(), in_rotation = true, team = 'Sales';
set role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-00000000000b',false);
create temp table k(n text, id uuid);
insert into k select 'a', create_lead('{"name":"A","phone":"9811300001","product":"RIA","source":"Meta"}');
insert into k select 'b', create_lead('{"name":"B","phone":"9811300002","product":"RIA","source":"Meta"}');
insert into k select 'c', create_lead('{"name":"C","phone":"9811300003","product":"RIA","source":"Meta"}');
insert into k select 'd', create_lead('{"name":"D","phone":"9811300004","product":"RIA","source":"Meta","next_follow_up":"2030-01-01"}');
do $$ begin
  assert (select count(*) from leads where next_follow_up is null)=3, 'new leads have no follow-up date';
  assert (select next_follow_up from leads where id=(select id from k where n='d'))='2030-01-01', 'a date set by hand stays';
  -- unanswered call → follow-up tomorrow; message sent → in 2 days; a note doesn't count
  perform log_activity((select id from k where n='a'), 'phone_call', 'no_answer');
  perform log_activity((select id from k where n='b'), 'message', 'sent', 'Hi, this is Priya from Flameback');
  perform log_activity((select id from k where n='c'), 'note', null, 'Looks like a referral from Asha');
  assert (select next_follow_up from leads where id=(select id from k where n='a'))=ist_today()+1, 'call → tomorrow';
  assert (select next_follow_up from leads where id=(select id from k where n='b'))=ist_today()+2, 'message → 2 days';
  assert (select next_follow_up from leads where id=(select id from k where n='c')) is null, 'note is not an attempt';
  -- the RM's own date wins
  perform log_activity((select id from k where n='c'), 'phone_call', 'call_back', null, null, ist_today()+5);
  assert (select next_follow_up from leads where id=(select id from k where n='c'))=ist_today()+5, 'own date';
end $$;
-- an RM can choose who gets a lead: another RM yes, an admin no
reset role;
insert into auth.users (id,email,raw_user_meta_data) values ('00000000-0000-0000-0000-00000000000c','ravi@flamebackcapital.com','{"full_name":"Ravi"}');
update profiles set is_active = true, approved_at = now() where email like 'ravi%';
set role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-00000000000b',false);
do $$ declare v uuid; begin
  v := create_lead('{"name":"For Ravi","phone":"9811300009","product":"RIA","source":"Meta","rm_id":"00000000-0000-0000-0000-00000000000c"}');
  reset role;
  assert (select rm_id from leads where id=v)='00000000-0000-0000-0000-00000000000c', 'RM assigned to another RM';
  set role authenticated;
  begin perform create_lead('{"name":"X","phone":"9811300010","product":"RIA","source":"Meta","rm_id":"00000000-0000-0000-0000-0000000000ff"}'); raise exception 'FAIL to admin';
  exception when others then if sqlerrm like 'FAIL%' then raise; end if; end;
end $$;
reset role;
select 'NEW LEADS TESTS PASSED' as result;
