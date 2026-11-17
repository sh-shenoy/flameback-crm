\set ON_ERROR_STOP 1
insert into auth.users (id,email,raw_user_meta_data) values ('00000000-0000-0000-0000-00000000000b','priya@flamebackcapital.com','{"full_name":"Priya"}');
insert into auth.users (id,email,raw_user_meta_data) values ('00000000-0000-0000-0000-00000000000c','ravi@flamebackcapital.com','{"full_name":"Ravi"}');
update profiles set is_active = true, approved_at = now(), role = 'rm', in_rotation = (email like 'priya%');
set role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-00000000000b',false);
create temp table k(id uuid);
insert into k select create_lead('{"name":"N1","phone":"9833300011","product":"RIA","source":"Meta","language":"hindi/ English"}');
do $$ declare a uuid := (select id from k); t timestamptz; begin
  assert (select language from leads where id=a)='Hindi, English', 'languages tidied';
  assert (select languages from leads where id=a)=array['Hindi','English'], 'array';
  perform update_lead(a, '{"language":"English, Marathi"}');
  assert (select languages from leads where id=a)=array['English','Marathi'], 'update languages';
  t := (select updated_at from leads where id=a);
  perform save_lead_notes(a, '  Son studies in the US; prefers calls after 7pm.  ');
  assert (select general_notes from leads where id=a)='Son studies in the US; prefers calls after 7pm.', 'notes saved';
  assert (select notes_updated_by from leads where id=a)='00000000-0000-0000-0000-00000000000b', 'notes by';
  assert lead_last_activity(a) >= t, 'summary sees notes';
  perform save_lead_notes(a, '');
  assert (select general_notes from leads where id=a) is null, 'cleared';
end $$;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-00000000000c',false);
do $$ begin
  begin perform save_lead_notes((select id from k), 'x'); raise exception 'FAIL other rm';
  exception when others then if sqlerrm like 'FAIL%' then raise; end if; end;
end $$;
reset role;
select 'NOTES & LANGUAGES TESTS PASSED' as result;
