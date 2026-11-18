\set ON_ERROR_STOP 1
insert into auth.users (id,email,raw_user_meta_data) values ('00000000-0000-0000-0000-0000000000ff','boss@flamebackcapital.com','{"full_name":"Boss"}');
insert into auth.users (id,email,raw_user_meta_data) values ('00000000-0000-0000-0000-00000000000b','priya@flamebackcapital.com','{"full_name":"Priya"}');
update profiles set is_active = true, approved_at = now(), in_rotation = true, team = 'Sales';
set role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-00000000000b',false);
create temp table k(id uuid);
insert into k select create_lead('{"name":"Two Phones","phone":"9811500001","alt_phone":"+91 98115 00002","product":"RIA","source":"Meta"}');
do $$ declare a uuid := (select id from k); begin
  assert (select alt_phone from leads where id=a)='9811500002', 'secondary saved, cleaned';
  -- the secondary number counts for duplicates, both ways
  begin perform create_lead('{"name":"X","phone":"9811500002","product":"RIA","source":"Meta"}'); raise exception 'FAIL dup on secondary';
  exception when others then if sqlerrm like 'FAIL%' then raise; end if; end;
  begin perform create_lead('{"name":"Y","phone":"9811500099","alt_phone":"9811500001","product":"RIA","source":"Meta"}'); raise exception 'FAIL dup via new secondary';
  exception when others then if sqlerrm like 'FAIL%' then raise; end if; end;
  assert (select count(*) from find_duplicates('9811500002', null))=1, 'find_duplicates sees secondary';
  assert (select phone from find_duplicates_bulk(array['9811500002'], array[]::text[]))='9811500002', 'bulk reports the matched number';
  -- edit on the profile
  perform update_lead(a, '{"alt_phone":"09811500003"}');
  assert (select alt_phone from leads where id=a)='9811500003', 'edited';
  perform update_lead(a, '{"alt_phone":""}');
  assert (select alt_phone from leads where id=a) is null, 'cleared';
  begin perform update_lead(a, '{"alt_phone":"123"}'); raise exception 'FAIL bad number';
  exception when others then if sqlerrm like 'FAIL%' then raise; end if; end;
end $$;
reset role;
select 'SECONDARY PHONE TESTS PASSED' as result;
