\set ON_ERROR_STOP 1
insert into auth.users (id,email,raw_user_meta_data) values ('00000000-0000-0000-0000-0000000000ff','boss@flamebackcapital.com','{"full_name":"Boss"}');
insert into auth.users (id,email,raw_user_meta_data) values ('00000000-0000-0000-0000-00000000000b','priya@flamebackcapital.com','{"full_name":"Priya"}');
update profiles set is_active = true, approved_at = now();
do $$ begin
  -- the only admin can't step down or lose access
  begin update profiles set role = 'rm' where email like 'boss%'; raise exception 'FAIL demoted last admin';
  exception when others then if sqlerrm like 'FAIL%' then raise; end if; end;
  begin update profiles set is_active = false where email like 'boss%'; raise exception 'FAIL deactivated last admin';
  exception when others then if sqlerrm like 'FAIL%' then raise; end if; end;
  -- once someone else is admin, they can
  update profiles set role = 'admin' where email like 'priya%';
  update profiles set role = 'rm' where email like 'boss%';
  assert (select role from profiles where email like 'boss%') = 'rm', 'stepped down';
  begin update profiles set role = 'rm' where email like 'priya%'; raise exception 'FAIL demoted the new last admin';
  exception when others then if sqlerrm like 'FAIL%' then raise; end if; end;
end $$;
-- remove_access on the last admin is refused too (another admin can't remove them if they're the only other one… and nobody can remove themselves)
select 'KEEP ONE ADMIN TESTS PASSED' as result;
