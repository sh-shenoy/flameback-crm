\set ON_ERROR_STOP 1
insert into auth.users (id,email,raw_user_meta_data) values ('00000000-0000-0000-0000-0000000000ff','boss@flamebackcapital.com','{"full_name":"Boss"}');
insert into auth.users (id,email,raw_user_meta_data) values ('00000000-0000-0000-0000-00000000000b','priya@flamebackcapital.com','{"full_name":"Priya"}');
update profiles set is_active = true, approved_at = now(), in_rotation = true, team = 'Sales';
set role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-00000000000b',false);
create temp table k(n int, id uuid);
insert into k select 1, create_lead('{"name":"A","phone":"9811500001","product":"RIA","source":"Meta"}');
insert into k select 2, create_lead('{"name":"B","phone":"9811500002","product":"RIA","source":"Meta"}');
insert into k select 3, create_lead('{"name":"C","phone":"9811500003","product":"RIA","source":"Meta"}');
do $$ declare a uuid := (select id from k where n=1); b uuid := (select id from k where n=2); begin
  perform log_activity(a, 'meet_call', 'connected', 'Talked plans', null, null, null, null, null, 'zoom');
  assert (select platform from lead_entries where lead_id=a) = 'zoom', 'zoom saved';
  perform log_activity(a, 'message', 'sent', null, null, null, null, null, null, 'whatsapp');
  assert (select platform from lead_entries where lead_id=a and kind='message') = 'whatsapp', 'whatsapp saved';
  assert (select platform from lead_entries where lead_id=a and kind='meet_call') = 'zoom', 'older entry untouched';
  perform log_activity(b, 'phone_call', 'no_answer', null, null, null, null, null, null, 'zoom');
  assert (select platform from lead_entries where lead_id=b) is null, 'phone calls have no platform';
  begin perform log_activity(b, 'meet_call', 'connected', 'x', null, null, null, null, null, 'whatsapp'); raise exception 'FAIL bad platform';
  exception when others then if sqlerrm like 'FAIL%' then raise; end if; end;
  -- the old 9-argument call still works
  perform log_activity(b, 'phone_call', 'connected', 'Wants to meet', null, null, 'interested');
  assert (select bucket::text from leads where id=b) = 'awaiting_meeting', 'rules still apply';
end $$;
-- funnel: spoke, new, follow-up
do $$ declare r record; begin
  select * into r from report_conversion(ist_today(), ist_today(), 'rm', '00000000-0000-0000-0000-00000000000b');
  assert r.leads = 3 and r.contacted = 2 and r.spoke = 2 and r.interested = 1, format('funnel %s', r);
  assert r.new_now = 1 and r.follow_up_now = 1, format('now %s', r);
end $$;
-- analytics: admins only
do $$ begin perform activity_analytics(ist_today(), ist_today()); raise exception 'FAIL rm';
exception when others then if sqlerrm like 'FAIL%' then raise; end if; end $$;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-0000000000ff',false);
do $$ declare j jsonb := activity_analytics(ist_today() - 6, ist_today()); r jsonb; begin
  assert (j->'totals'->>'activities')::int = 4, format('activities %s', j->'totals');
  assert (j->'totals'->>'clients')::int = 2 and (j->'totals'->>'calls')::int = 3 and (j->'totals'->>'connected')::int = 2, format('totals %s', j->'totals');
  assert (j->'totals'->>'meetings')::int = 1 and (j->'totals'->>'new_leads')::int = 3 and (j->'totals'->>'new_reached')::int = 2, format('t2 %s', j->'totals');
  assert jsonb_array_length(j->'daily') = 7, 'seven days';
  assert (j->'meetings'->'logged'->>'zoom')::int = 1, format('meetings %s', j->'meetings');
  assert (j->'messages'->'by_platform'->>'whatsapp')::int = 1, 'messages';
  assert (select (c->>'n')::int from jsonb_array_elements(j->'channels') c where c->>'key'='zoom') = 1, format('channels %s', j->'channels');
  assert (j->'outcomes'->>'no_answer')::int = 1, 'outcomes';
  assert (j->'moves'->>'awaiting_meeting')::int = 1, format('moves %s', j->'moves');
  select x into r from jsonb_array_elements(j->'by_rm') x where x->>'name' = 'Priya';
  assert (r->>'activities')::int = 4 and (r->>'connected')::int = 2, format('rm %s', r);
  assert jsonb_array_length(j->'by_rm') = 1, 'admins are not listed';
  assert (select sum((x->>'n')::int) from jsonb_array_elements(j->'hours') x) = 4, 'hours';
end $$;
reset role;
select 'ANALYTICS TESTS PASSED' as result;
