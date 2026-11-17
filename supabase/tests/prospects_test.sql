\set ON_ERROR_STOP 1
insert into auth.users (id,email,raw_user_meta_data) values ('00000000-0000-0000-0000-00000000000a','shashank@flamebackcapital.com','{"full_name":"Shashank"}');
insert into auth.users (id,email,raw_user_meta_data) values ('00000000-0000-0000-0000-00000000000b','priya@flamebackcapital.com','{"full_name":"Priya"}');
insert into auth.users (id,email,raw_user_meta_data) values ('00000000-0000-0000-0000-00000000000e','ops@flamebackcapital.com','{"full_name":"Om Ops"}');
update profiles set is_active = true, approved_at = now(), in_rotation = (email like 'priya%'),
       role = case when email like 'shashank%' then 'admin' else 'rm' end,
       team = case when email like 'ops%' then 'Operations' else 'Sales' end;
set role authenticated;
-- admin sets up the NRI PMS checklist
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-00000000000a',false);
do $$ begin
  perform save_onboarding_template(null, '{"product":"PMS","residency":"nri","title":"PAN & passport","per_holder":true}');
  perform save_onboarding_template(null, '{"product":"PMS","residency":"nri","title":"NRE/NRO account","owner":"ops"}');
  perform save_onboarding_template(null, '{"product":"PMS","residency":"nri","title":"Agreement signed"}');
  perform save_onboarding_template(null, '{"product":"PMS","residency":"resident","title":"Resident-only item"}');
end $$;
-- RMs can't edit templates
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-00000000000b',false);
do $$ begin
  begin perform save_onboarding_template(null, '{"product":"PMS","residency":"nri","title":"x"}'); raise exception 'FAIL rm template';
  exception when others then if sqlerrm like 'FAIL%' then raise; end if; end;
end $$;
create temp table k(id uuid);
insert into k select create_lead('{"name":"Mehta couple","phone":"9876500011","product":"PMS","source":"Referral","referred_by":"Colleague"}');
do $$ declare a uuid := (select id from k); wife uuid; it uuid; t uuid; begin
  perform set_residency(a, 'nri');
  wife := add_holder(a, 'Nisha Mehta', 'Spouse');
  -- agreed to join → prospect, checklist created
  perform log_activity(a, 'phone_call', 'connected', 'They will join', null, null, 'commits');
  assert (select bucket::text from leads where id=a)='converting', 'prospect';
  assert (select next_follow_up from leads where id=a) is null, 'no follow-up date';
  assert (select count(*) from onboarding_items where lead_id=a)=4, format('3 items + per-person for wife, got %s', (select count(*) from onboarding_items where lead_id=a));
  assert (select count(*) from onboarding_items where lead_id=a and holder_id=wife and title='PAN & passport')=1, 'wife KYC';
  assert not exists (select 1 from onboarding_items where lead_id=a and title='Resident-only item'), 'right template';
  -- a holder added later gets their per-person items too
  perform add_holder(a, 'Son', 'Child');
  assert (select count(*) from onboarding_items where lead_id=a)=5, 'son KYC';
  -- loading again adds nothing new
  assert load_onboarding_checklist(a) = 0, 'nothing missing';
  -- RM adds an item and moves statuses
  it := add_onboarding_item(a, 'OCI card copy', 'rm', wife);
  perform update_onboarding_item(it, '{"status":"waiting"}');
  begin perform update_onboarding_item(it, '{"status":"blocked"}'); raise exception 'FAIL blocked without reason';
  exception when others then if sqlerrm like 'FAIL%' then raise; end if; end;
  perform update_onboarding_item(it, '{"status":"blocked","blocked_reason":"Client travelling"}');
  perform update_onboarding_item(it, '{"status":"done"}');
  assert (select done_at from onboarding_items where id=it) is not null and (select blocked_reason from onboarding_items where id=it) is null, 'done';
  -- Ask Ops raises a task; Ops finishing it ticks the item
  it := (select id from onboarding_items where lead_id=a and title='NRE/NRO account');
  t := ask_ops(it, 'Please open with HDFC');
  assert (select to_team from tasks where id=t)='Operations' and (select lead_id from tasks where id=t)=a, 'task raised';
  assert (select status from onboarding_items where id=it)='submitted', 'submitted';
  begin perform ask_ops(it); raise exception 'FAIL double ask';
  exception when others then if sqlerrm like 'FAIL%' then raise; end if; end;
end $$;
create temp table tk as select task_id from onboarding_items where title='NRE/NRO account';
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-00000000000e',false);   -- Ops person
do $$ begin
  assert not exists (select 1 from onboarding_items), 'Ops cannot see the RM''s checklist';
  perform set_task_status((select task_id from tk), 'done');
end $$;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-00000000000b',false);
do $$ declare a uuid := (select id from k); begin
  assert (select status from onboarding_items where title='NRE/NRO account')='done', 'ticked by task';
  -- can't jump to Client without funding; can't fund in the future
  perform set_bucket(a, 'holding');
  begin perform set_bucket(a, 'client'); raise exception 'FAIL skipped funding';
  exception when others then if sqlerrm like 'FAIL%' then raise; end if; end;
  assert (select bucket::text from leads where id=a)='holding', 'still holding';
  perform set_bucket(a, 'converting');
  assert (select count(*) from onboarding_items where lead_id=a)=6, 'checklist kept, not duplicated';
  begin perform mark_funded(a, ist_today() + 1, 1000000); raise exception 'FAIL future';
  exception when others then if sqlerrm like 'FAIL%' then raise; end if; end;
  perform mark_funded(a, ist_today(), 2500000);
  assert (select bucket::text from leads where id=a)='client' and (select funded_amount from leads where id=a)=2500000, 'client';
  assert (select clients from report_conversion(ist_today()-1, ist_today(), 'source') where grp='Referral')=1, 'report clients';
  assert (select funded_amount from report_conversion(ist_today()-1, ist_today(), 'source') where grp='Referral')=2500000, 'report amount';
  assert (select committed from report_conversion(ist_today()-1, ist_today(), 'source') where grp='Referral')=1, 'still counted as prospect';
  perform undo_funded(a);
  assert (select bucket::text from leads where id=a)='converting' and (select funded_at from leads where id=a) is null, 'undo';
end $$;
-- another RM can't touch it
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-00000000000e',false);
do $$ begin
  begin perform add_onboarding_item((select id from k), 'x'); raise exception 'FAIL other user';
  exception when others then if sqlerrm like 'FAIL%' then raise; end if; end;
end $$;
reset role;
select 'PROSPECT TESTS PASSED' as result;
