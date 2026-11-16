\set ON_ERROR_STOP 1
insert into auth.users (id,email,raw_user_meta_data) values ('00000000-0000-0000-0000-00000000000a','shashank@flamebackcapital.com','{"full_name":"Shashank"}');
insert into auth.users (id,email,raw_user_meta_data) values ('00000000-0000-0000-0000-00000000000b','priya@flamebackcapital.com','{"full_name":"Priya"}');
update profiles set is_active = true, approved_at = now(), in_rotation = (email = 'priya@flamebackcapital.com');
set role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-00000000000b',false); -- Priya uploads
create temp table b(id uuid);
insert into b select start_import('list.csv','Meta',null,'RIA','skip',4);
select import_rows((select id from b), '[{"row":2,"name":"A","phone":"9811100001"},{"row":3,"name":"B","phone":"9811100002"},{"row":4,"name":"C","phone":"9811100003"},{"row":5,"name":"D","phone":"9811100004"}]');
select log_entry((select id from leads where phone='9811100001'),'phone_call','no_answer');
do $$ begin
  -- RMs can't delete anything
  begin perform remove_import_leads((select id from b), false); raise exception 'FAIL rm removed from upload';
  exception when others then if sqlerrm like 'FAIL%' then raise; end if; end;
  begin perform delete_leads(array(select id from leads where phone='9811100002')); raise exception 'FAIL rm deleted';
  exception when others then if sqlerrm like 'FAIL%' then raise; end if; end;
  assert (select count(*) from leads) = 4, 'nothing removed by rm';
end $$;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-00000000000a',false); -- admin
do $$ begin
  assert remove_import_leads((select id from b), false) = 3, 'admin removes 3 untouched';
  assert (select count(*) from leads) = 1, 'worked one stays';
  assert remove_import_leads((select id from b), true) = 1, 'admin removes the worked one';
  assert (select count(*) from leads) = 0, 'all gone';
  assert (select undone_count from import_batches) = 4, 'batch count';
end $$;
reset role;
select 'BULK DELETE TESTS PASSED' as result;
