\set ON_ERROR_STOP 1
insert into auth.users (id,email,raw_user_meta_data) values ('00000000-0000-0000-0000-0000000000ff','boss@flamebackcapital.com','{"full_name":"Boss"}');
insert into auth.users (id,email,raw_user_meta_data) values ('00000000-0000-0000-0000-00000000000b','priya@flamebackcapital.com','{"full_name":"Priya"}');
update profiles set is_active = true, approved_at = now(), in_rotation = true, team = 'Sales';
set role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-00000000000b',false);
create temp table k(id uuid);
insert into k select create_lead('{"name":"T","phone":"9811400001","product":"RIA","source":"Meta"}');
do $$ declare a uuid := (select id from k); t timestamptz := date_trunc('hour', now()) + interval '1 day 2 hours'; begin
  perform log_activity(a, 'phone_call', 'no_answer');
  perform set_follow_up(a, t);
  assert (select next_follow_up_at from leads where id=a) = t, 'time saved';
  assert (select next_follow_up from leads where id=a) = (t at time zone 'Asia/Kolkata')::date, 'date matches (IST)';
  -- logging with only a date clears the stale time
  perform log_activity(a, 'phone_call', 'no_answer', null, null, ist_today() + 3);
  assert (select next_follow_up_at from leads where id=a) is null and (select next_follow_up from leads where id=a) = ist_today() + 3, 'date only';
  begin perform set_follow_up(a, now() - interval '3 days'); raise exception 'FAIL past';
  exception when others then if sqlerrm like 'FAIL%' then raise; end if; end;
end $$;
reset role;
select 'FOLLOW-UP TIME TESTS PASSED' as result;
