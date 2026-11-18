\set ON_ERROR_STOP 1
insert into auth.users (id,email,raw_user_meta_data) values ('00000000-0000-0000-0000-00000000000a','shashank@flamebackcapital.com','{"full_name":"Shashank"}');
insert into auth.users (id,email,raw_user_meta_data) values ('00000000-0000-0000-0000-00000000000b','priya@flamebackcapital.com','{"full_name":"Priya"}');
insert into auth.users (id,email,raw_user_meta_data) values ('00000000-0000-0000-0000-00000000000c','ravi@flamebackcapital.com','{"full_name":"Ravi"}');
insert into auth.users (id,email,raw_user_meta_data) values ('00000000-0000-0000-0000-00000000000d','neha@flamebackcapital.com','{"full_name":"Neha"}');
update profiles set is_active = true, approved_at = now(), team = 'Sales', in_rotation = (email not like 'shashank%'),
       role = case when email like 'shashank%' then 'admin' else 'rm' end;
set role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-00000000000a',false);
-- give Priya 6 leads in different stages
create temp table k(n int, id uuid);
insert into k select g, create_lead(jsonb_build_object('name','R'||g,'phone','98444000'||(10+g),'product','RIA','source','Meta','rm_id','00000000-0000-0000-0000-00000000000b')) from generate_series(1,6) g;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-00000000000b',false);   -- Priya works her leads
do $$ begin
  perform set_bucket((select id from k where n=5), 'out', 'gone cold');
  perform set_bucket((select id from k where n=6), 'converting');
  assert (select count(*) from leads where rm_id='00000000-0000-0000-0000-00000000000b')=6, 'setup';
  -- RMs can't
end $$;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-00000000000c',false);
do $$ begin
  begin perform remove_access('00000000-0000-0000-0000-00000000000b'); raise exception 'FAIL rm removed access';
  exception when others then if sqlerrm like 'FAIL%' then raise; end if; end;
end $$;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-00000000000a',false);
do $$ declare res jsonb; begin
  -- not yourself
  begin perform remove_access('00000000-0000-0000-0000-00000000000a', 'person', '00000000-0000-0000-0000-00000000000c'); raise exception 'FAIL self';
  exception when others then if sqlerrm like 'FAIL%' then raise; end if; end;
  -- round-robin across Ravi and Neha
  res := remove_access('00000000-0000-0000-0000-00000000000b', 'rotation');
  assert (res->>'moved')::int = 6, 'moved all six, any stage';
  assert (select count(*) from leads where rm_id='00000000-0000-0000-0000-00000000000b')=0, 'none left';
  assert (select count(*) from leads where rm_id='00000000-0000-0000-0000-00000000000c')=3
     and (select count(*) from leads where rm_id='00000000-0000-0000-0000-00000000000d')=3, 'split evenly';
  assert not (select is_active from profiles where id='00000000-0000-0000-0000-00000000000b')
     and not (select in_rotation from profiles where id='00000000-0000-0000-0000-00000000000b'), 'access removed';
  assert (select count(*) from lead_events where kind='assigned' and from_value='00000000-0000-0000-0000-00000000000b' and detail->>'reason' = 'Access removed for Priya')=6, 'timeline';
  assert (select bucket from leads where id=(select id from k where n=5))='out', 'stage unchanged';
  -- to one person
  res := remove_access('00000000-0000-0000-0000-00000000000d', 'person', '00000000-0000-0000-0000-00000000000c');
  assert (res->>'moved')::int = 3 and (select count(*) from leads where rm_id='00000000-0000-0000-0000-00000000000c')=6, 'all to Ravi';
  -- nobody left in rotation → refused, nothing changes
  begin perform remove_access('00000000-0000-0000-0000-00000000000c', 'rotation'); raise exception 'FAIL empty rotation';
  exception when others then if sqlerrm like 'FAIL%' then raise; end if; end;
  assert (select is_active from profiles where id='00000000-0000-0000-0000-00000000000c'), 'refused = untouched';
  -- to an inactive person → refused
  begin perform remove_access('00000000-0000-0000-0000-00000000000c', 'person', '00000000-0000-0000-0000-00000000000b'); raise exception 'FAIL inactive target';
  exception when others then if sqlerrm like 'FAIL%' then raise; end if; end;
end $$;
reset role;
do $$ begin
  -- one notification per new owner per hand-over: Ravi + Neha (first), Ravi (second)
  assert (select count(*) from notifications where kind='lead_assigned' and title like '% handed over to you')=3, 'one notification each';
  assert (select count(*) from notifications where title = '3 leads handed over to you')=3, 'counts in titles';
end $$;
select 'REMOVE ACCESS TESTS PASSED' as result;
