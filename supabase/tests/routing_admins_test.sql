\set ON_ERROR_STOP 1
insert into auth.users (id,email,raw_user_meta_data) values ('00000000-0000-0000-0000-0000000000ff','boss@flamebackcapital.com','{"full_name":"Boss"}');
insert into auth.users (id,email,raw_user_meta_data) values ('00000000-0000-0000-0000-00000000000b','priya@flamebackcapital.com','{"full_name":"Priya"}');
insert into auth.users (id,email,raw_user_meta_data) values ('00000000-0000-0000-0000-00000000000c','ravi@flamebackcapital.com','{"full_name":"Ravi"}');
insert into auth.users (id,email,raw_user_meta_data) values ('00000000-0000-0000-0000-00000000000d','neha@flamebackcapital.com','{"full_name":"Neha"}');
update profiles set is_active = true, approved_at = now(), team = 'Sales', in_rotation = true;
-- admins never sit in the rotation
do $$ begin assert not (select in_rotation from profiles where email like 'boss%'), 'admin out of rotation'; end $$;
-- Priya: Gujarati, RIA only · Ravi: PMS, no NRI · Neha: anything, NRI
update profiles set route_languages = '{Gujarati}', route_products = '{RIA}', manager_id = '00000000-0000-0000-0000-0000000000ff' where email like 'priya%';
update profiles set route_products = '{PMS}', takes_nri = false, manager_id = '00000000-0000-0000-0000-0000000000ff' where email like 'ravi%';
-- a manager must be an admin
do $$ begin
  begin update profiles set manager_id = '00000000-0000-0000-0000-00000000000c' where email like 'neha%'; raise exception 'FAIL rm as manager';
  exception when others then if sqlerrm like 'FAIL%' then raise; end if; end;
end $$;
set role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-0000000000ff',false);
create temp table k(n text, id uuid);
insert into k select 'guj', create_lead('{"name":"G","phone":"9811000001","product":"RIA","source":"Meta","language":"gujarati, english"}');
insert into k select 'pms', create_lead('{"name":"P","phone":"9811000002","product":"PMS","source":"Meta"}');
insert into k select 'nri', create_lead('{"name":"N","phone":"9811000003","product":"PMS","source":"Meta","residency":"nri"}');
do $$ begin
  assert (select rm_id from leads where id=(select id from k where n='guj'))='00000000-0000-0000-0000-00000000000b', 'Gujarati RIA → Priya';
  assert (select rm_id from leads where id=(select id from k where n='pms'))='00000000-0000-0000-0000-00000000000c', 'PMS → Ravi';
  assert (select rm_id from leads where id=(select id from k where n='nri'))='00000000-0000-0000-0000-00000000000d', 'NRI PMS → Neha (Ravi takes no NRI)';
  assert (select residency from leads where id=(select id from k where n='nri'))='nri', 'residency stored';
  -- admins can't own leads
  begin perform create_lead('{"name":"X","phone":"9811000004","product":"RIA","source":"Meta","rm_id":"00000000-0000-0000-0000-0000000000ff"}'); raise exception 'FAIL admin owner';
  exception when others then if sqlerrm like 'FAIL%' then raise; end if; end;
  begin perform reassign_lead((select id from k where n='guj'), '00000000-0000-0000-0000-0000000000ff'); raise exception 'FAIL reassign to admin';
  exception when others then if sqlerrm like 'FAIL%' then raise; end if; end;
  -- admins view, reassign, raise tasks; they don't change leads
  begin perform log_activity((select id from k where n='guj'), 'phone_call', 'no_answer'); raise exception 'FAIL admin logged';
  exception when others then if sqlerrm like 'FAIL%' then raise; end if; end;
  begin perform set_bucket((select id from k where n='guj'), 'out'); raise exception 'FAIL admin moved';
  exception when others then if sqlerrm like 'FAIL%' then raise; end if; end;
  perform reassign_lead((select id from k where n='guj'), '00000000-0000-0000-0000-00000000000d');
  perform create_task(jsonb_build_object('title','Check KYC','to_team','Operations','lead_id',(select id from k where n='guj')));
  assert (select count(*) from leads)=3, 'admin sees all';
end $$;
reset role;
-- on leave and over the limit are skipped while someone else is free
update profiles set on_leave = true where email like 'priya%';
update profiles set max_open_leads = 1 where email like 'neha%';     -- Neha already holds 2
set role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-0000000000ff',false);
insert into k select 'guj2', create_lead('{"name":"G2","phone":"9811000005","product":"RIA","source":"Meta","language":"Gujarati"}');
do $$ begin
  assert (select rm_id from leads where id=(select id from k where n='guj2'))='00000000-0000-0000-0000-00000000000c',
    'Priya on leave, Neha full → Ravi (relaxed product and language)';
end $$;
-- hand over an RM's leads without removing access
do $$ declare res jsonb; begin
  res := hand_over_leads('00000000-0000-0000-0000-00000000000c', 'person', '00000000-0000-0000-0000-00000000000d');
  assert (res->>'moved')::int = 2 and (select is_active from profiles where email like 'ravi%'), 'handed over, still active';
  begin perform hand_over_leads('00000000-0000-0000-0000-00000000000d', 'person', '00000000-0000-0000-0000-0000000000ff'); raise exception 'FAIL to admin';
  exception when others then if sqlerrm like 'FAIL%' then raise; end if; end;
end $$;
-- an admin's upload can merge into an existing lead (housekeeping), but still can't log activity
do $$ declare b uuid; res jsonb; begin
  b := start_import('fix.csv','Meta',null,'RIA','merge',1);
  res := import_rows(b, '[{"row":2,"name":"G","phone":"9811000001","city":"Surat"}]');
  assert res->0->>'status' = 'merged', format('admin merge %s', res);
  assert (select city from leads where phone='9811000001')='Surat', 'merged field';
end $$;
-- nobody in rotation: an admin's new lead is refused, not kept
reset role;
update profiles set in_rotation = false;
set role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-0000000000ff',false);
do $$ begin
  begin perform create_lead('{"name":"Z","phone":"9811000009","product":"RIA","source":"Meta"}'); raise exception 'FAIL kept by admin';
  exception when others then if sqlerrm like 'FAIL%' then raise; end if; end;
end $$;
-- …but an RM's own lead stays with them
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-00000000000c',false);
do $$ declare v uuid; begin
  v := create_lead('{"name":"Own","phone":"9811000010","product":"RIA","source":"Referral"}');
  assert (select rm_id from leads where id=v)='00000000-0000-0000-0000-00000000000c', 'RM keeps own lead when nobody in rotation';
end $$;
reset role;
select 'ROUTING & ADMIN TESTS PASSED' as result;
