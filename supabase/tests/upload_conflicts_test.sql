\set ON_ERROR_STOP 1
insert into auth.users (id,email,raw_user_meta_data) values ('00000000-0000-0000-0000-0000000000ff','boss@flamebackcapital.com','{"full_name":"Boss"}');
insert into auth.users (id,email,raw_user_meta_data) values ('00000000-0000-0000-0000-00000000000b','priya@flamebackcapital.com','{"full_name":"Priya"}');
insert into auth.users (id,email,raw_user_meta_data) values ('00000000-0000-0000-0000-00000000000c','ravi@flamebackcapital.com','{"full_name":"Ravi"}');
update profiles set is_active = true, approved_at = now(), in_rotation = false, team = 'Sales';
update profiles set manager_id = '00000000-0000-0000-0000-0000000000ff' where email like 'ravi%';
set role authenticated;
-- Priya already has Asha
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-00000000000b',false);
create temp table k(id uuid);
insert into k select create_lead('{"name":"Asha","phone":"9811600001","alt_phone":"9811600002","product":"RIA","source":"Meta","rm_id":"00000000-0000-0000-0000-00000000000b"}');
-- Ravi uploads Asha (by her secondary number) plus someone new, assigning to himself
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-00000000000c',false);
create temp table bt(id uuid);
insert into bt select start_import('ravi.csv','Meta',null,'RIA','merge',2);
do $$ declare res jsonb; begin
  res := import_rows((select id from bt), '[{"row":2,"name":"Asha R","phone":"9811600002","rm_id":"00000000-0000-0000-0000-00000000000c"},{"row":3,"name":"Neel","phone":"9811600003","rm_id":"00000000-0000-0000-0000-00000000000c"}]');
  assert res->0->>'status'='skipped' and res->0->>'message' like '%sent to the manager%', format('dup row %s', res->0);
  assert res->1->>'status'='inserted', 'new row';
  assert (select count(*) from lead_conflicts where status='open')=1, 'conflict visible to the uploader';
  begin perform resolve_conflict((select id from lead_conflicts limit 1), '00000000-0000-0000-0000-00000000000c'); raise exception 'FAIL rm resolved';
  exception when others then if sqlerrm like 'FAIL%' then raise; end if; end;
end $$;
reset role;
do $$ begin
  assert (select count(*) from notifications where user_id='00000000-0000-0000-0000-00000000000c' and kind='duplicate')=1, 'uploader told';
  assert (select count(*) from notifications where user_id='00000000-0000-0000-0000-0000000000ff' and kind='duplicate' and title='Duplicate leads to resolve')=1, 'manager told';
  assert (select count(*) from notifications where user_id='00000000-0000-0000-0000-00000000000b' and kind='duplicate')=0, 'owner not bothered yet';
end $$;
-- the manager gives Asha to Ravi
set role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-0000000000ff',false);
select resolve_conflict((select id from lead_conflicts limit 1), '00000000-0000-0000-0000-00000000000c');
reset role;
do $$ begin
  assert (select rm_id from leads where name='Asha')='00000000-0000-0000-0000-00000000000c', 'moved to Ravi';
  assert (select status from lead_conflicts limit 1)='moved', 'resolved';
  assert (select count(*) from notifications where user_id='00000000-0000-0000-0000-00000000000b' and kind='duplicate' and title like 'Asha was given to Ravi%')=1, 'Priya told';
  assert (select count(*) from notifications where user_id='00000000-0000-0000-0000-00000000000c' and kind='duplicate' and title='Asha is now yours')=1, 'Ravi told';
end $$;
select 'UPLOAD CONFLICT TESTS PASSED' as result;
