-- Behavioural tests for Tasks. Run after supabase_stub.sql + all migrations.
\set ON_ERROR_STOP 1
insert into auth.users (id,email,raw_user_meta_data) values
 ('00000000-0000-0000-0000-00000000000a','shashank@flamebackcapital.com','{"full_name":"Shashank"}'),
 ('00000000-0000-0000-0000-00000000000b','priya@flamebackcapital.com','{"full_name":"Priya"}'),
 ('00000000-0000-0000-0000-00000000000c','ravi@flamebackcapital.com','{"full_name":"Ravi"}'),
 ('00000000-0000-0000-0000-00000000000d','neha@flamebackcapital.com','{"full_name":"Neha"}');
-- (0004+) sign-ups wait for approval; approve everyone for these tests
update profiles set is_active = true, approved_at = coalesce(approved_at, now());
update profiles set team='Operations' where email='ravi@flamebackcapital.com';
update profiles set team='Compliance' where email='neha@flamebackcapital.com';
update profiles set in_rotation = (email='priya@flamebackcapital.com');

set role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-00000000000b',false); -- Priya (RM, Sales)
create temp table t(k text, id uuid);
insert into t select 'lead', create_lead('{"name":"Asha Rao","phone":"9811100001","product":"RIA","source":"Meta"}');
insert into t select 'task', create_task(jsonb_build_object('title','Open demat for Asha','to_team','Operations','priority','high',
                                                         'lead_id',(select id from t where k='lead'),'due_date',ist_today()-1));
do $$ begin
  assert (select lead_name from tasks)='Asha Rao', 'lead name copied';
  assert (select from_team from tasks)='Sales', 'from team';
  begin perform create_task('{"title":"x","to_team":"Operations","status":"blocked"}'); raise exception 'FAIL blocked create';
  exception when others then if sqlerrm like 'FAIL%' then raise; end if; end;
end $$;

-- Ravi (Operations) sees it via team, can move it; Neha (Compliance) can't see it
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-00000000000c',false);
do $$ declare tid uuid := (select id from t where k='task'); begin
  assert (select count(*) from tasks)=1, 'ops sees team task';
  assert (select count(*) from leads)=0, 'ops cannot see the lead itself';
  begin perform set_task_status(tid,'blocked',''); raise exception 'FAIL blocked without reason';
  exception when others then if sqlerrm like 'FAIL%' then raise; end if; end;
  perform set_task_status(tid,'blocked','Waiting for PAN copy');
  assert (select blocked_reason from tasks where id=tid)='Waiting for PAN copy', 'reason saved';
  perform update_task(tid, jsonb_build_object('assignee_id','00000000-0000-0000-0000-00000000000c'));
  perform add_task_comment(tid,'Asked the client for PAN');
  perform set_task_status(tid,'done');
  assert (select done_at from tasks where id=tid) is not null and (select blocked_reason from tasks where id=tid) is null, 'done clears reason';
end $$;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-00000000000d',false);
do $$ declare tid uuid := (select id from t where k='task'); begin
  assert (select count(*) from tasks)=0, 'compliance cannot see ops task';
  begin perform add_task_comment(tid,'hi'); raise exception 'FAIL compliance commented';
  exception when others then if sqlerrm like 'FAIL%' then raise; end if; end;
  begin perform create_task(jsonb_build_object('title','x','to_team','Operations','lead_id',(select id from t where k='lead'))); raise exception 'FAIL linked foreign lead';
  exception when others then if sqlerrm like 'FAIL%' then raise; end if; end;
  begin perform delete_task(tid); raise exception 'FAIL deleted others task';
  exception when others then if sqlerrm like 'FAIL%' then raise; end if; end;
end $$;
-- Priya (raiser) sees comments + events, can reopen and delete
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-00000000000b',false);
do $$ declare tid uuid := (select id from t where k='task'); begin
  assert (select count(*) from task_comments where task_id=tid)=1, 'raiser sees comment';
  assert (select count(*) from task_events where task_id=tid and kind='status')=2, 'status history';
  perform set_task_status(tid,'open');
  assert (select done_at from tasks where id=tid) is null, 'reopen clears done';
  begin update tasks set status='done'; exception when insufficient_privilege then null; end;
  perform delete_task(tid);
  assert (select count(*) from tasks)=0, 'deleted';
end $$;
reset role;
select 'TASK TESTS PASSED' as result;
-- round-robin never picks a non-Sales person, and new sign-ups start out of rotation
update profiles set in_rotation = true;
insert into auth.users (id,email) values ('00000000-0000-0000-0000-00000000000e','new@flamebackcapital.com');
do $$ begin assert (select in_rotation from profiles where email='new@flamebackcapital.com') = false, 'new user out of rotation'; end $$;
set role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-00000000000b',false);
do $$ begin
  for i in 1..6 loop perform create_lead(jsonb_build_object('name','RR '||i,'phone','98111000'||(10+i),'product','RIA','source','Meta')); end loop;
end $$;
reset role;
do $$ begin
  assert not exists (select 1 from leads l join profiles p on p.id=l.rm_id where p.team <> 'Sales'), 'only Sales get leads';
end $$;
select 'ROTATION TESTS PASSED' as result;
