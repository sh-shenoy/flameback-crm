\set ON_ERROR_STOP 1
insert into auth.users (id,email,raw_user_meta_data) values ('00000000-0000-0000-0000-0000000000ff','boss@flamebackcapital.com','{"full_name":"Boss"}');
insert into auth.users (id,email,raw_user_meta_data) values ('00000000-0000-0000-0000-0000000000fe','boss2@flamebackcapital.com','{"full_name":"Other Boss"}');
insert into auth.users (id,email,raw_user_meta_data) values ('00000000-0000-0000-0000-00000000000b','priya@flamebackcapital.com','{"full_name":"Priya"}');
insert into auth.users (id,email,raw_user_meta_data) values ('00000000-0000-0000-0000-00000000000c','ravi@flamebackcapital.com','{"full_name":"Ravi"}');
update profiles set is_active = true, approved_at = now(), team = 'Sales', in_rotation = true;
update profiles set role = 'admin' where email like 'boss2%';
update profiles set manager_id = '00000000-0000-0000-0000-0000000000ff' where email like 'priya%';
update profiles set manager_id = '00000000-0000-0000-0000-0000000000fe' where email like 'ravi%';
set role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-0000000000ff',false);
create temp table k(n text, id uuid);
insert into k select 'p1', create_lead('{"name":"A","phone":"9811200001","product":"RIA","source":"Meta","rm_id":"00000000-0000-0000-0000-00000000000b"}');
insert into k select 'p2', create_lead('{"name":"B","phone":"9811200002","product":"RIA","source":"Meta","rm_id":"00000000-0000-0000-0000-00000000000b"}');
insert into k select 'r1', create_lead('{"name":"C","phone":"9811200003","product":"RIA","source":"Meta","rm_id":"00000000-0000-0000-0000-00000000000c"}');
-- Priya: works one lead (thin notes), the other stays untouched for 2 days
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-00000000000b',false);
select log_activity((select id from k where n='p1'), 'phone_call', 'connected', 'ok', null, null, 'commits', null, 'RIA');
reset role;
update leads set created_at = now() - interval '2 days' where id = (select id from k where n='p2');
update leads set created_at = now() - interval '3 hours' where id = (select id from k where n='p1');
set role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-0000000000ff',false);
do $$ declare r record; begin
  -- my team = Priya only
  assert (select count(*) from manager_dashboard(ist_today()-7, ist_today(), 'team'))=1, 'team scope';
  assert (select count(*) from manager_dashboard(ist_today()-7, ist_today(), 'all'))=2, 'all scope (no admins)';
  select * into r from manager_dashboard(ist_today()-7, ist_today(), 'team');
  assert r.full_name='Priya', 'Priya row';
  assert r.new_leads=2 and r.prospects=1 and r.open_leads=1, format('counts %s', row_to_json(r));
  assert r.untouched_24h=1, 'untouched new lead';
  assert r.thin_notes_7d=1, 'thin notes flagged';
  assert r.first_response_hours between 2 and 4, format('first response %s', r.first_response_hours);
  assert r.activity_7d=1, 'activity';
  assert r.upload_backlog=0 and r.first_contacts_7d=1, format('backlog %s', row_to_json(r));
end $$;
-- an uploaded batch waiting 2 days is a backlog, not "untouched in 24h"
reset role;
insert into import_batches (id, file_name, source, product, uploaded_by) values ('00000000-0000-0000-0000-0000000000b1', 'x.csv', 'Meta', 'RIA', '00000000-0000-0000-0000-0000000000ff');
insert into leads (name, phone, product, source, rm_id, bucket, unit, created_at, import_batch_id)
select 'U'||g, '98112100'||lpad(g::text,2,'0'), 'RIA', 'Meta', '00000000-0000-0000-0000-00000000000b', 'active_contact', 'IQWM', now() - interval '2 days', '00000000-0000-0000-0000-0000000000b1'
  from generate_series(1,30) g;
set role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-0000000000ff',false);
do $$ declare r record; begin
  select * into r from manager_dashboard(ist_today()-7, ist_today(), 'team');
  assert r.untouched_24h=1, format('uploads are not untouched-24h %s', r.untouched_24h);
  assert r.upload_backlog=30, format('backlog %s', r.upload_backlog);
end $$;
-- RMs can't see it
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-00000000000b',false);
do $$ begin
  begin perform manager_dashboard(ist_today()-7, ist_today(), 'all'); raise exception 'FAIL rm saw dashboard';
  exception when others then if sqlerrm like 'FAIL%' then raise; end if; end;
end $$;
reset role;
-- team digest goes to admins, not as an RM digest
select run_notification_sweeps();
do $$ begin
  if extract(hour from now() at time zone 'Asia/Kolkata') >= 9 then
    assert (select title from notifications where user_id='00000000-0000-0000-0000-0000000000ff' and kind='digest') like 'Team today:%', 'admin team digest';
    assert (select body from notifications where user_id='00000000-0000-0000-0000-0000000000ff' and kind='digest') like 'Yesterday:%', 'digest body';
  end if;
end $$;
select 'MANAGER DASHBOARD TESTS PASSED' as result;
