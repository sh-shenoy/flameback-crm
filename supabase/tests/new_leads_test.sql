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
reset role;
select 'NEW LEADS TESTS PASSED' as result;
