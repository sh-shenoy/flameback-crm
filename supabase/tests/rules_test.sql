-- Behavioural tests for the RM pre-sales rules. Run after supabase_stub.sql + migrations.
\set ON_ERROR_STOP 1
-- three staff: first = admin, then two RMs
insert into auth.users (id,email,raw_user_meta_data) values
 ('00000000-0000-0000-0000-00000000000a','shashank@flamebackcapital.com','{"full_name":"Shashank"}'),
 ('00000000-0000-0000-0000-00000000000b','priya@flamebackcapital.com','{"full_name":"Priya"}'),
 ('00000000-0000-0000-0000-00000000000c','arjun@flamebackcapital.com','{"full_name":"Arjun"}');
do $$ begin
  begin insert into auth.users (email) values ('x@gmail.com'); raise exception 'FAIL outsider signed up';
  exception when others then if sqlerrm like 'FAIL%' then raise; end if; end;
  assert (select role from profiles where email='shashank@flamebackcapital.com')='admin', 'first user admin';
  assert (select role from profiles where email='priya@flamebackcapital.com')='rm', 'second user rm';
end $$;
-- (0004+) sign-ups wait for approval; approve everyone for these tests
update profiles set is_active = true, approved_at = coalesce(approved_at, now());
update profiles set in_rotation = (email <> 'shashank@flamebackcapital.com');

set role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-00000000000b',false); -- Priya

-- round robin between Priya and Arjun
create temp table ids(n int, id uuid);
insert into ids select 1, create_lead('{"name":"Lead One","phone":"+91 98200 11111","product":"RIA","source":"Meta","campaign":"Diwali"}');
insert into ids select 2, create_lead('{"name":"Lead Two","phone":"098200 22222","product":"PMS","source":"Google"}');
insert into ids select 3, create_lead('{"name":"Lead Three","email":"Three@X.com","product":"PMS","source":"Referral"}');
do $$ declare a uuid; b uuid; c uuid; begin
  select rm_id into a from leads where name='Lead One';
  -- Priya can only see her own; check via count across RMs as admin later
end $$;
reset role;
do $$ begin
  assert (select count(distinct rm_id) from leads) = 2, 'round robin used both RMs';
  assert (select phone from leads where name='Lead One')='9820011111', 'phone normalised +91';
  assert (select phone from leads where name='Lead Two')='9820022222', 'phone normalised 0';
  assert (select email from leads where name='Lead Three')='three@x.com', 'email lowercased';
end $$;
-- give all three to Priya for the rest
update leads set rm_id='00000000-0000-0000-0000-00000000000b';
set role authenticated;

-- RLS: Arjun sees nothing now
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-00000000000c',false);
do $$ begin assert (select count(*) from leads)=0, 'arjun cannot see priya leads'; end $$;
do $$ begin
  begin perform log_entry((select id from ids where n=1),'note',null,'hi'); raise exception 'FAIL arjun logged';
  exception when others then if sqlerrm like 'FAIL%' then raise; end if; end;
  begin update leads set bucket='converting'; exception when insufficient_privilege then null; end;
end $$;
-- duplicates are visible across RMs, without access
do $$ begin
  assert (select can_open from find_duplicates('9820011111',null))=false, 'dup found but not openable';
  begin perform create_lead('{"name":"Dup","phone":"9820011111","product":"RIA","source":"Meta"}'); raise exception 'FAIL dup created';
  exception when others then if sqlerrm like 'FAIL%' then raise; end if; end;
end $$;

select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-00000000000b',false); -- Priya
do $$ declare l uuid := (select id from ids where n=1); e uuid; begin
  assert (select count(*) from leads)=3, 'priya sees 3';
  -- 4 no-answers then connected resets
  for i in 1..4 loop perform log_entry(l,'phone_call','no_answer'); end loop;
  assert (select strikes from leads where id=l)=4, '4 strikes';
  perform log_entry(l,'phone_call','connected','Spoke, interested in RIA');
  assert (select strikes from leads where id=l)=0, 'connected resets';
  -- connected without notes rejected
  begin perform log_entry(l,'phone_call','connected',''); raise exception 'FAIL no notes';
  exception when others then if sqlerrm like 'FAIL%' then raise; end if; end;
  -- 5 no-answers → out
  for i in 1..5 loop perform log_entry(l,'phone_call','no_answer'); end loop;
  assert (select bucket from leads where id=l)='out', 'five strikes out';
  assert (select out_reason from leads where id=l)='5 strikes', 'reason';
  assert (select next_follow_up from leads where id=l) is null, 'follow-up cleared';
  perform bring_back(l, ist_today()+2);
  assert (select bucket from leads where id=l)='active_contact' and (select strikes from leads where id=l)=0, 'brought back';
  -- message pending, then sweep after 48h
  e := log_entry(l,'message','sent');
  assert (select strikes from leads where id=l)=0, 'sent not yet a strike';
end $$;
reset role;
update lead_entries set occurred_at = now()-interval '49 hours' where strike_state='pending';
select run_sweeps();
set role authenticated;
do $$ declare l uuid := (select id from ids where n=1); e uuid; begin
  assert (select strikes from leads where id=l)=1, 'sweep counted sent strike';
  e := log_entry(l,'message','sent');
  perform set_entry_outcome(e,'replied');
  assert (select strikes from leads where id=l)=0, 'replied resets';

  -- interested → awaiting meeting; reminders count
  perform mark_interested(l, now()+interval '2 days');
  assert (select bucket from leads where id=l)='awaiting_meeting', 'awaiting';
  perform log_entry(l,'message','sent','reminder');
  perform log_entry(l,'phone_call','connected','confirmed time');
  assert (select strikes from leads where id=l)=2, 'reminders count';
  -- meeting: undecided → holding, strikes reset
  perform record_meeting(l,'undecided','meet_call','Walked through RIA, thinking');
  assert (select bucket from leads where id=l)='holding' and (select strikes from leads where id=l)=0, 'holding';
  -- defer then sweep returns to holding
  perform defer_lead(l, ist_today()+30);
  assert (select bucket from leads where id=l)='deferred', 'deferred';
end $$;
reset role;
update leads set deferred_until = ist_today() where name='Lead One';
select run_sweeps();
set role authenticated;
do $$ declare l uuid := (select id from ids where n=1); begin
  assert (select bucket from leads where id=l)='holding', 'deferred returned to holding';
  perform mark_committed(l,'PMS');
  assert (select bucket from leads where id=l)='converting' and (select product from leads where id=l)='PMS', 'converting';
  -- not interested via outcome
  perform log_entry((select id from ids where n=2),'phone_call','not_interested');
  assert (select out_reason from leads where id=(select id from ids where n=2))='Not interested', 'NI out';
  -- holding (still thinking): no strikes; follow-ups spaced 7, 14, 28, 56 … days (max 90)
  perform mark_interested((select id from ids where n=3));
  perform record_meeting((select id from ids where n=3),'undecided','in_person','met at office');
  assert (select next_follow_up from leads where id=(select id from ids where n=3))=ist_today()+7, 'first follow-up in 7d';
  perform log_entry((select id from ids where n=3),'phone_call','no_answer');
  assert (select next_follow_up from leads where id=(select id from ids where n=3))=ist_today()+14, 'then 14d';
  perform log_entry((select id from ids where n=3),'message','sent');
  assert (select next_follow_up from leads where id=(select id from ids where n=3))=ist_today()+28, 'then 28d';
  perform log_entry((select id from ids where n=3),'note',null,'just a note');
  assert (select next_follow_up from leads where id=(select id from ids where n=3))=ist_today()+28, 'note does not move cadence';
  perform log_entry((select id from ids where n=3),'phone_call','connected','still thinking', null, ist_today()+3);
  assert (select next_follow_up from leads where id=(select id from ids where n=3))=ist_today()+3, 'manual date wins';
  for i in 1..4 loop perform log_entry((select id from ids where n=3),'phone_call','connected','still thinking'); end loop;
  assert (select bucket from leads where id=(select id from ids where n=3))='holding', 'holding never strikes out';
  assert (select strikes from leads where id=(select id from ids where n=3))=0, 'no strikes in holding';
  assert (select next_follow_up from leads where id=(select id from ids where n=3))=ist_today()+90, 'capped at 90d';
  perform mark_not_interested((select id from ids where n=3), 'not now');
  perform bring_back((select id from ids where n=3), ist_today()+1);
  assert (select bucket from leads where id=(select id from ids where n=3))='holding', 'returns to holding';
end $$;

-- bulk upload (Arjun out of rotation so Priya receives these)
reset role;
update profiles set in_rotation=false where email='arjun@flamebackcapital.com';
set role authenticated;
do $$ declare b uuid; res jsonb; n int; begin
  b := start_import('meta_nov.xlsx','Meta','Nov push','RIA','skip',5);
  res := import_rows(b, '[
    {"row":2,"name":"Up A","phone":"9811100001"},
    {"row":3,"name":"Up B","phone":"9811100002","product":"pms"},
    {"row":4,"name":"","phone":"9811100003"},
    {"row":5,"name":"Up D","phone":"12"},
    {"row":6,"name":"Dup of one","phone":"+919820011111"},
    {"row":7,"name":"Bad src","phone":"9811100007","source":"Snapchat"}]'::jsonb);
  assert (select count(*) from jsonb_array_elements(res) x where x->>'status'='inserted')=2, 'two inserted';
  assert (select count(*) from jsonb_array_elements(res) x where x->>'status'='skipped')=1, 'one skipped';
  assert (select count(*) from jsonb_array_elements(res) x where x->>'status'='failed')=3, 'three failed';
  assert (select product from leads where name='Up B')='PMS', 'row product override';
  perform log_entry((select id from leads where name='Up A'),'phone_call','no_answer');
  n := undo_import(b);
  assert n=1, 'undo removes only untouched lead, got '||n;
  assert exists(select 1 from leads where name='Up A'), 'worked lead kept';
  -- merge mode
  b := start_import('referrals.csv','Referral',null,'RIA','merge',1);
  res := import_rows(b,'[{"row":2,"name":"Lead Three again","email":"three@x.com","city":"Pune"}]');
  assert res->0->>'status'='merged', 'merged';
  assert (select city from leads where email='three@x.com')='Pune', 'merge filled city';
end $$;
reset role;
select 'ALL TESTS PASSED' as result;
