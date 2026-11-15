-- Behavioural tests for Calendly bookings. Run after supabase_stub.sql + all migrations.
\set ON_ERROR_STOP 1
insert into auth.users (id,email,raw_user_meta_data) values
 ('00000000-0000-0000-0000-00000000000a','shashank@flamebackcapital.com','{"full_name":"Shashank"}'),
 ('00000000-0000-0000-0000-00000000000b','priya@flamebackcapital.com','{"full_name":"Priya"}');
-- (0004+) sign-ups wait for approval; approve everyone for these tests
update profiles set is_active = true, approved_at = coalesce(approved_at, now());
update profiles set in_rotation = true;

-- an existing lead owned by Shashank, in Active contact with 2 strikes
set role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-00000000000a',false);
create temp table k(n text, id uuid);
insert into k select 'asha', create_lead('{"name":"Asha Rao","email":"asha@x.com","product":"PMS","source":"Meta","rm_id":"00000000-0000-0000-0000-00000000000a"}');
select log_entry((select id from k where n='asha'),'phone_call','no_answer');
select log_entry((select id from k where n='asha'),'phone_call','no_answer');
reset role;

-- functions are not callable from the browser roles
set role authenticated;
do $$ begin
  begin perform apply_calendly_booking('00000000-0000-0000-0000-00000000000b','{}'); raise exception 'FAIL browser could call';
  exception when insufficient_privilege then null; end;
end $$;
reset role;

do $$ declare v uuid; v2 uuid; begin
  -- 1. new person books on Priya's Calendly → new lead owned by Priya
  v := apply_calendly_booking('00000000-0000-0000-0000-00000000000b', jsonb_build_object(
        'invitee_uri','inv-1','event_uri','ev-1','name','Kabir Mehta','email','Kabir@Y.com','phone','+91 98200 99999',
        'event_name','Intro call','start_time', (now()+interval '2 days')::text, 'join_url','https://meet.google.com/abc','product','PMS'));
  assert (select rm_id from leads where id=v)='00000000-0000-0000-0000-00000000000b', 'owned by Priya';
  assert (select source from leads where id=v)='Calendly', 'source Calendly';
  assert (select bucket from leads where id=v)='awaiting_meeting', 'awaiting meeting';
  assert (select product from leads where id=v)='PMS', 'product from form';
  assert (select phone from leads where id=v)='9820099999', 'phone normalised';
  assert (select meeting_url from leads where id=v)='https://meet.google.com/abc', 'meet link';
  -- same notification again → nothing new
  v2 := apply_calendly_booking('00000000-0000-0000-0000-00000000000b', jsonb_build_object('invitee_uri','inv-1','event_uri','ev-1','email','kabir@y.com','start_time',now()::text));
  assert v2 = v and (select count(*) from leads where email='kabir@y.com')=1, 'idempotent';
  assert (select count(*) from lead_entries where lead_id=v)=1, 'one note only';

  -- 2. existing lead books on Priya's Calendly (matched by email) → moves to Awaiting meeting, owner unchanged, strikes reset
  v := apply_calendly_booking('00000000-0000-0000-0000-00000000000b', jsonb_build_object(
        'invitee_uri','inv-2','event_uri','ev-2','name','Asha R','email','ASHA@x.com','start_time',(now()+interval '1 day')::text));
  assert v = (select id from k where n='asha'), 'matched by email';
  assert (select rm_id from leads where id=v)='00000000-0000-0000-0000-00000000000a', 'owner unchanged';
  assert (select bucket from leads where id=v)='awaiting_meeting' and (select strikes from leads where id=v)=0, 'moved, strikes reset';

  -- 3. cancellation clears the meeting and sets follow-up today
  perform apply_calendly_cancel('inv-2', false, 'Travelling');
  assert (select meeting_at from leads where id=v) is null, 'meeting cleared';
  assert (select next_follow_up from leads where id=v)=ist_today(), 'follow-up today';
  assert (select status from calendly_events where invitee_uri='inv-2')='canceled', 'event canceled';

  -- 4. reschedule: new booking arrives first, then cancel(rescheduled) must not clear the new time
  perform apply_calendly_booking('00000000-0000-0000-0000-00000000000b', jsonb_build_object(
        'invitee_uri','inv-3','event_uri','ev-3','email','asha@x.com','start_time',(now()+interval '3 days')::text));
  perform apply_calendly_booking('00000000-0000-0000-0000-00000000000b', jsonb_build_object(
        'invitee_uri','inv-4','event_uri','ev-4','email','asha@x.com','start_time',(now()+interval '4 days')::text));
  perform apply_calendly_cancel('inv-3', true);
  assert (select meeting_at::date from leads where id=v) = (now()+interval '4 days')::date, 'new time kept';

  -- 5. matched by hidden lead id even with a different email
  v2 := apply_calendly_booking('00000000-0000-0000-0000-00000000000b', jsonb_build_object(
        'invitee_uri','inv-5','event_uri','ev-5','email','other@z.com','lead_id',(select id from k where n='asha')::text,'start_time',(now()+interval '5 days')::text));
  assert v2 = (select id from k where n='asha'), 'matched by lead id';

  -- 6. Out List lead who books comes back to Awaiting meeting
  update leads set bucket='out', out_reason='5 strikes', meeting_at=null where id=v;
  perform apply_calendly_booking('00000000-0000-0000-0000-00000000000b', jsonb_build_object(
        'invitee_uri','inv-6','event_uri','ev-6','email','asha@x.com','start_time',(now()+interval '6 days')::text));
  assert (select bucket from leads where id=v)='awaiting_meeting', 'out lead revived';
  -- leaving awaiting meeting clears the meet link
  update leads set bucket='holding' where id=(select id from leads where email='kabir@y.com');
  assert (select meeting_url from leads where email='kabir@y.com') is null, 'meet link cleared on move';
end $$;

-- RLS: Priya sees her own Calendly events but not Shashank's lead
set role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-00000000000b',false);
do $$ begin
  assert (select count(*) from calendly_events) >= 1, 'priya sees her events';
  begin perform * from calendly_connections; raise exception 'FAIL read connections';
  exception when insufficient_privilege then null; end;
end $$;
reset role;
select 'CALENDLY TESTS PASSED' as result;
