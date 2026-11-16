\set ON_ERROR_STOP 1
insert into auth.users (id,email,raw_user_meta_data) values ('00000000-0000-0000-0000-00000000000a','shashank@flamebackcapital.com','{"full_name":"Shashank"}');
insert into auth.users (id,email,raw_user_meta_data) values ('00000000-0000-0000-0000-00000000000b','priya@flamebackcapital.com','{"full_name":"Priya"}');
update profiles set is_active = true, approved_at = now(), in_rotation = false;
set role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-00000000000a',false);
create temp table k(id uuid);
insert into k select create_lead('{"name":"Asha","phone":"9811100001","product":"RIA","source":"Meta","rm_id":"00000000-0000-0000-0000-00000000000a"}');
reset role;
do $$ declare l uuid := (select id from k); begin
  assert lead_last_activity(l) is not null, 'activity time';
  assert save_lead_summary(l, '{"headline":"v1"}', now(), 'gpt-x', false), 'first save';
  assert save_lead_summary(l, '{"headline":"v2"}', now(), 'gpt-x', false), 'auto refresh over AI version';
end $$;
set role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-00000000000a',false);
select edit_lead_summary((select id from k), '{"headline":"edited by RM"}');
do $$ begin
  begin perform save_lead_summary((select id from k), '{}', now(), 'x', true); raise exception 'FAIL browser saved';
  exception when insufficient_privilege then null; end;
  assert (select summary->>'headline' from lead_summaries)='edited by RM', 'edit saved';
end $$;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-00000000000b',false);
do $$ begin
  assert (select count(*) from lead_summaries)=0, 'other RM cannot read';
  begin perform edit_lead_summary((select id from k), '{"headline":"x"}'); raise exception 'FAIL other RM edited';
  exception when others then if sqlerrm like 'FAIL%' then raise; end if; end;
end $$;
reset role;
do $$ declare l uuid := (select id from k); begin
  assert not save_lead_summary(l, '{"headline":"auto"}', now(), 'gpt-x', false), 'auto refresh must not overwrite RM edit';
  assert save_lead_summary(l, '{"headline":"forced"}', now(), 'gpt-x', true), 'explicit refresh overwrites';
  assert (select edited_at from lead_summaries where lead_id=l) is null, 'edit flag cleared';
end $$;
select 'SUMMARY TESTS PASSED' as result;
