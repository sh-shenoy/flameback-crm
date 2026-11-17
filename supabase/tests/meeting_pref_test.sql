\set ON_ERROR_STOP 1
insert into auth.users (id,email,raw_user_meta_data) values ('00000000-0000-0000-0000-00000000000b','priya@flamebackcapital.com','{"full_name":"Priya"}');
insert into auth.users (id,email,raw_user_meta_data) values ('00000000-0000-0000-0000-00000000000c','ravi@flamebackcapital.com','{"full_name":"Ravi"}');
update profiles set is_active = true, approved_at = now(), in_rotation = (email like 'priya%');
set role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-00000000000b',false);
create temp table k(id uuid);
insert into k select create_lead('{"name":"Z","phone":"9811177700","product":"RIA","source":"Meta"}');
do $$ begin
  perform set_meeting_pref((select id from k), 'zoom');
  assert (select meeting_pref from leads where id=(select id from k))='zoom', 'saved';
  begin perform set_meeting_pref((select id from k), 'teams'); raise exception 'FAIL bad value';
  exception when others then if sqlerrm like 'FAIL%' then raise; end if; end;
  perform set_meeting_pref((select id from k), null);
  assert (select meeting_pref from leads where id=(select id from k)) is null, 'cleared';
end $$;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-00000000000c',false);
do $$ begin
  begin perform set_meeting_pref((select id from k), 'zoom'); raise exception 'FAIL other rm';
  exception when others then if sqlerrm like 'FAIL%' then raise; end if; end;
end $$;
reset role;
select 'MEETING PREF TESTS PASSED' as result;
