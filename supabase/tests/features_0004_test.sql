-- Tests for 0004: access requests, notifications, US RIA, task files, conversion report, Gmail.
\set ON_ERROR_STOP 1
insert into auth.users (id,email,raw_user_meta_data) values
 ('00000000-0000-0000-0000-00000000000a','shashank@flamebackcapital.com','{"full_name":"Shashank"}');
insert into auth.users (id,email,raw_user_meta_data) values
 ('00000000-0000-0000-0000-00000000000b','priya@flamebackcapital.com','{"full_name":"Priya"}'),
 ('00000000-0000-0000-0000-00000000000c','ravi@flamebackcapital.com','{"full_name":"Ravi"}');

-- ── access requests ──
do $$ begin
  assert (select is_active from profiles where email='shashank@flamebackcapital.com'), 'first user active admin';
  assert not (select is_active from profiles where email='priya@flamebackcapital.com'), 'new sign-up pending';
  assert (select count(*) from notifications where user_id='00000000-0000-0000-0000-00000000000a' and kind='access_request')=2, 'admin notified of 2 requests';
end $$;
set role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-00000000000b',false); -- pending Priya
do $$ begin
  assert (select count(*) from profiles)=1, 'pending sees only own profile';
  begin perform create_lead('{"name":"x","phone":"9811100001","product":"RIA","source":"Meta"}'); raise exception 'FAIL pending created lead';
  exception when others then if sqlerrm like 'FAIL%' then raise; end if; end;
  begin perform approve_user('00000000-0000-0000-0000-00000000000b','admin'); raise exception 'FAIL self-approve';
  exception when others then if sqlerrm like 'FAIL%' then raise; end if; end;
end $$;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-00000000000a',false); -- admin
select approve_user('00000000-0000-0000-0000-00000000000b','rm', true);
select reject_user('00000000-0000-0000-0000-00000000000c');
do $$ begin
  assert (select is_active and in_rotation and role='rm' from profiles where email='priya@flamebackcapital.com'), 'priya approved RM in rotation';
  assert (select rejected_at is not null and not is_active from profiles where email='ravi@flamebackcapital.com'), 'ravi rejected';
end $$;
reset role;
do $$ begin assert (select count(*) from notifications where user_id='00000000-0000-0000-0000-00000000000b' and kind='access_approved')=1, 'priya told'; end $$;

-- ── leads: US RIA + assignment notifications ──
-- Dev: an approved RM outside the rotation (admins don't own leads)
insert into auth.users (id,email,raw_user_meta_data) values ('00000000-0000-0000-0000-00000000000d','dev@flamebackcapital.com','{"full_name":"Dev"}');
update profiles set is_active = true, approved_at = now(), role = 'rm', in_rotation = false where email = 'dev@flamebackcapital.com';
set role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-00000000000a',false);
create temp table k(n text, id uuid);
insert into k select 'us', create_lead('{"name":"Rohan Desai","email":"rohan@x.com","product":"US RIA","source":"Referral","referred_by":"Asha","rm_id":"00000000-0000-0000-0000-00000000000d"}');
do $$ begin
  assert (select product from leads where id=(select id from k where n='us'))='US RIA', 'US RIA product';
  begin perform create_lead('{"name":"Bad","phone":"9811100009","product":"AIF","source":"Meta"}'); raise exception 'FAIL AIF accepted';
  exception when others then if sqlerrm like 'FAIL%' then raise; end if; end;
end $$;
-- upload with product "us-ria" row → normalised; one notification per RM per upload
do $$ declare b uuid; res jsonb; begin
  b := start_import('list.csv','Alumni list',null,'RIA','skip',3);
  res := import_rows(b,'[{"row":2,"name":"A","phone":"9811100011","product":"us-ria"},{"row":3,"name":"B","phone":"9811100012"},{"row":4,"name":"C","phone":"9811100013"}]');
  assert (select count(*) from jsonb_array_elements(res) x where x->>'status'='inserted')=3, 'imported';
  assert (select product from leads where phone='9811100011')='US RIA', 'row product normalised';
end $$;
reset role;
do $$ begin
  -- round-robin: Priya is the only Sales RM in rotation → the 3 uploaded leads are hers, as ONE notification
  assert (select count(*) from notifications where user_id='00000000-0000-0000-0000-00000000000b' and kind='lead_assigned')=1, 'priya lead notifications: ' || (select count(*) from notifications where user_id='00000000-0000-0000-0000-00000000000b' and kind='lead_assigned');
  assert (select title from notifications where user_id='00000000-0000-0000-0000-00000000000b' and ref_key like 'import:%') like '3 new leads%', 'upload count';
end $$;

-- ── tasks: notifications + files ──
update profiles set team='Operations' where email='shashank@flamebackcapital.com'; -- admin acts as Ops for this test
set role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-00000000000b',false); -- Priya raises to Operations (Shashank)
create temp table tk(id uuid);
insert into tk select create_task('{"title":"Open demat","to_team":"Operations","assignee_id":"00000000-0000-0000-0000-00000000000a"}');
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-00000000000a',false);
select set_task_status((select id from tk),'in_progress');
select add_task_comment((select id from tk),'On it');
-- file upload: storage policy allows a path under the task id; record it
insert into storage.objects (bucket_id, name, owner) values ('task-files', (select id from tk)::text || '/abc-pan.pdf', '00000000-0000-0000-0000-00000000000a');
select add_task_file((select id from tk), (select id from tk)::text || '/abc-pan.pdf', 'pan.pdf', 1234, 'application/pdf');
do $$ begin
  begin perform add_task_file((select id from tk), 'other/x.pdf', 'x', 1, null); raise exception 'FAIL bad path';
  exception when others then if sqlerrm like 'FAIL%' then raise; end if; end;
end $$;
reset role;
do $$ begin
  assert (select count(*) from notifications where user_id='00000000-0000-0000-0000-00000000000a' and kind='task')=1, 'assignee got exactly one "new task"';
  assert (select count(*) from notifications where user_id='00000000-0000-0000-0000-00000000000b' and kind='task')=3, 'raiser: status + comment + file = ' || (select count(*) from notifications where user_id='00000000-0000-0000-0000-00000000000b' and kind='task');
end $$;
set role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-00000000000b',false); -- Priya can see the file record but not delete it
do $$ begin
  assert (select count(*) from task_files)=1, 'priya sees file';
  begin insert into storage.objects (bucket_id, name) values ('task-files', '00000000-0000-0000-0000-000000000099/x.pdf'); raise exception 'FAIL rm wrote to unknown task';
  exception when insufficient_privilege then null; end;

  begin perform delete_task_file((select id from task_files limit 1)); raise exception 'FAIL priya deleted';
  exception when others then if sqlerrm like 'FAIL%' then raise; end if; end;
  -- notifications are private and can be marked read
  assert (select count(*) from notifications where user_id <> auth.uid())=0, 'only own notifications';
  perform mark_notifications_read();
  assert (select count(*) from notifications where read_at is null)=0, 'all read';
end $$;
reset role;

-- ── timed notifications: digest + meeting reminder (sweep run by Priya's browser still reaches Priya) ──
update leads set next_follow_up = ist_today() - 1 where phone='9811100011';
update leads set bucket='awaiting_meeting', meeting_at = now() + interval '20 minutes' where phone='9811100012';
set role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-00000000000b',false);
select run_sweeps();
reset role;
do $$ begin
  assert (select count(*) from notifications where user_id='00000000-0000-0000-0000-00000000000b' and kind='meeting_soon')=1, 'meeting reminder';
  if extract(hour from now() at time zone 'Asia/Kolkata') >= 9 then
    assert (select count(*) from notifications where user_id='00000000-0000-0000-0000-00000000000b' and kind='digest')=1, 'digest';
  end if;
end $$;
select run_sweeps();
do $$ begin assert (select count(*) from notifications where user_id='00000000-0000-0000-0000-00000000000b' and kind='meeting_soon')=1, 'reminder not duplicated'; end $$;

-- ── conversion report ──
update leads set bucket='converting', converted_at=now() where phone='9811100013';
set role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-00000000000b',false);
do $$ declare r record; begin
  select * into r from report_conversion(ist_today()-30, ist_today(), 'source') where grp='Alumni list';
  assert r.leads=3 and r.committed=1 and r.met=1 and r.source_kind='cold', 'source report: ' || row_to_json(r)::text;
  assert (select count(*) from report_conversion(ist_today()-30, ist_today(), 'referrer') where grp='Asha')=0, 'RM sees only own leads (Asha referral is Dev''s)';
end $$;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-00000000000a',false);
do $$ begin
  assert (select leads from report_conversion(ist_today()-30, ist_today(), 'referrer') where grp='Asha')=1, 'admin sees referrer';
  assert (select sum(leads) from report_conversion(ist_today()-30, ist_today(), 'product'))=4, 'product totals';
end $$;
reset role;

-- ── Gmail ──
update leads set email='a@client.com', bucket='active_contact', strikes=2 where phone='9811100011';
do $$ declare v uuid; begin
  v := apply_gmail_message('00000000-0000-0000-0000-00000000000b', jsonb_build_object('message_id','m1','thread_id','t1','direction','out',
        'counterpart','A@Client.com','subject','Intro','body','Hello','sent_at',now()::text));
  assert v is not null, 'outbound matched';
  assert (select strike_state from lead_entries where lead_id=v and kind='email')='pending', 'outbound pending strike';
  perform apply_gmail_message('00000000-0000-0000-0000-00000000000b', jsonb_build_object('message_id','m2','thread_id','t1','direction','in',
        'counterpart','a@client.com','subject','Re: Intro','body','Sounds good','sent_at',now()::text));
  assert (select strikes from leads where id=v)=0, 'reply resets strikes';
  assert not exists (select 1 from lead_entries where lead_id=v and strike_state='pending'), 'pending cleared';
  assert (select count(*) from notifications where kind='email_reply' and user_id='00000000-0000-0000-0000-00000000000b')=1, 'reply notification';
  assert apply_gmail_message('00000000-0000-0000-0000-00000000000b', jsonb_build_object('message_id','m2','direction','in','counterpart','a@client.com','sent_at',now()::text)) is null, 'dedupe';
  assert apply_gmail_message('00000000-0000-0000-0000-00000000000b', jsonb_build_object('message_id','m3','direction','in','counterpart','rohan@x.com','sent_at',now()::text)) is null, 'not matched to colleague''s lead';
end $$;
select 'FEATURES 0004 TESTS PASSED' as result;
