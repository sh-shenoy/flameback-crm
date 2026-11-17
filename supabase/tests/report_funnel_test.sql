\set ON_ERROR_STOP 1
insert into auth.users (id,email,raw_user_meta_data) values ('00000000-0000-0000-0000-00000000000b','priya@flamebackcapital.com','{"full_name":"Priya"}');
update profiles set is_active = true, approved_at = now(), in_rotation = true;
set role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-00000000000b',false);
create temp table k(n int, id uuid);
insert into k select g, create_lead(jsonb_build_object('name','F'||g,'phone','98555000'||(10+g),'product','RIA','source','Meta')) from generate_series(1,6) g;
do $$ declare r record; begin
  -- 1 untouched · 2 contacted only · 3 wants to meet · 4 met · 5 committed · 6 wanted to meet, then Out List
  perform log_activity((select id from k where n=2), 'phone_call', 'no_answer');
  perform log_activity((select id from k where n=3), 'phone_call', 'connected', 'Keen', null, null, 'interested');
  perform log_activity((select id from k where n=4), 'in_person', null, 'Met', null, null, 'met');
  perform log_activity((select id from k where n=5), 'phone_call', 'connected', 'Yes', null, null, 'commits');
  perform log_activity((select id from k where n=6), 'phone_call', 'connected', 'Keen', null, null, 'interested');
  perform mark_not_interested((select id from k where n=6), 'changed mind');
  select * into r from report_conversion(ist_today()-1, ist_today(), 'source') where grp = 'Meta';
  assert r.leads = 6, 'leads';
  assert r.contacted = 5, 'contacted';
  assert r.interested = 4, format('wants to meet %s', r.interested);   -- 3, 4, 5 (later stages count), 6 (reached it before the Out List)
  assert r.met = 2, 'met';                                                -- 4 and 5 (committed counts as met)
  assert r.committed = 1, 'committed';
  assert r.out_list = 1 and r.still_open = 4, 'out / open';
end $$;
reset role;
select 'REPORT FUNNEL TESTS PASSED' as result;
