-- Tests for 0008: log_activity + Gmail follow-ups.
\set ON_ERROR_STOP 1
insert into auth.users (id,email,raw_user_meta_data) values ('00000000-0000-0000-0000-00000000000a','shashank@flamebackcapital.com','{"full_name":"Shashank"}');
set role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-00000000000a',false);
create temp table k(n int, id uuid);
insert into k select g, create_lead(jsonb_build_object('name','L'||g,'email','l'||g||'@x.com','product','RIA','source','Meta')) from generate_series(1,4) g;
do $$ declare a uuid := (select id from k where n=1); b uuid := (select id from k where n=2); c uuid := (select id from k where n=3); begin
  perform mark_interested(a); perform mark_interested(b); perform mark_interested(c);
  -- awaiting: a confirming call (no result) is a reminder
  perform log_activity(a, 'phone_call', 'connected', 'Confirmed Tuesday');
  assert (select strikes from leads where id=a)=1 and (select bucket from leads where id=a)='awaiting_meeting', 'reminder counted';
  -- awaiting: meeting held, still deciding → holding, strikes reset
  perform log_activity(a, 'meet_call', 'connected', 'Walked through PMS', null, null, 'met');
  assert (select bucket from leads where id=a)='holding' and (select strikes from leads where id=a)=0, 'met -> holding';
  -- holding: still deciding (met again) = follow-up
  perform log_activity(a, 'phone_call', 'connected', 'Thinking', null, null, 'met');
  assert (select bucket from leads where id=a)='holding' and (select strikes from leads where id=a)=0 and (select next_follow_up from leads where id=a)=ist_today()+14, 'holding follow-up: no strike, next in 14d';
  -- holding: commits over WhatsApp, product switched
  perform log_activity(a, 'message', 'replied', 'Yes, let us go ahead with US RIA', null, null, 'commits', null, 'us ria');
  assert (select bucket from leads where id=a)='converting' and (select product from leads where id=a)='US RIA', 'commits via message';
  -- awaiting: will commit later
  perform log_activity(b, 'in_person', null, 'Met at office, after Diwali', null, null, 'later', ist_today()+20);
  assert (select bucket from leads where id=b)='deferred' and (select deferred_until from leads where id=b)=ist_today()+20, 'later';
  -- a decision needs actual contact
  begin perform log_activity(c, 'phone_call', 'no_answer', null, null, null, 'commits'); raise exception 'FAIL commit on no answer';
  exception when others then if sqlerrm like 'FAIL%' then raise; end if; end;
  -- result ignored outside awaiting/holding (active contact uses normal rules)
  perform log_activity((select id from k where n=4), 'phone_call', 'no_answer', null, null, null, 'commits');
  assert (select bucket from leads where id=(select id from k where n=4))='active_contact' and (select strikes from leads where id=(select id from k where n=4))=1, 'active contact unaffected';
end $$;
reset role;
-- Gmail: outbound in awaiting meeting counts as a reminder
do $$ declare c uuid := (select id from k where n=3); begin
  perform apply_gmail_message('00000000-0000-0000-0000-00000000000a', jsonb_build_object('message_id','g1','direction','out','counterpart','l3@x.com','subject','Reminder','body','See you','sent_at',now()::text));
  assert (select strikes from leads where id=c)=1, 'gmail reminder counted';
  assert (select strike_state from lead_entries where lead_id=c and kind='email')='counted', 'entry tagged';
  perform apply_gmail_message('00000000-0000-0000-0000-00000000000a', jsonb_build_object('message_id','g2','direction','in','counterpart','l3@x.com','subject','Re','body','ok','sent_at',now()::text));
  assert (select strikes from leads where id=c)=1, 'client reply does not count';
end $$;
select 'LOG ACTIVITY TESTS PASSED' as result;

-- 0009: decisions from Deferred
set role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-00000000000a',false);
do $$ declare b uuid := (select id from k where n=2); begin
  assert (select bucket from leads where id=b)='deferred', 'b deferred';
  perform log_activity(b, 'phone_call', 'connected', 'Checked in, still March');
  assert (select bucket from leads where id=b)='deferred' and (select strikes from leads where id=b)=0, 'check-in stays deferred, no strike';
  perform log_activity(b, 'phone_call', 'connected', 'Pushed to April', null, null, 'later', ist_today()+60);
  assert (select bucket from leads where id=b)='deferred' and (select deferred_until from leads where id=b)=ist_today()+60, 'new date';
  perform log_activity(b, 'message', 'replied', 'Free to talk now', null, null, 'met');
  assert (select bucket from leads where id=b)='holding', 'back to holding';
  perform log_activity(b, 'phone_call', 'connected', 'Moving ahead', null, null, 'commits');
  assert (select bucket from leads where id=b)='converting', 'committed';
end $$;
reset role;
select 'LOG ACTIVITY 0009 TESTS PASSED' as result;
