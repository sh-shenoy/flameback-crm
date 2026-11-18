-- Argus · 0024: there is always at least one admin
--
-- The last active admin can't be changed to RM or have their access removed: make someone else an
-- admin first. (Otherwise nobody could approve people, change roles or switch the admin back.)

create or replace function public._profiles_role_rules()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.role = 'admin' then new.in_rotation := false; end if;
  if new.manager_id is not null then
    if new.manager_id = new.id then raise exception 'Someone can''t manage themselves'; end if;
    if not exists (select 1 from public.profiles where id = new.manager_id and role = 'admin') then
      raise exception 'A manager must be an admin';
    end if;
  end if;
  if tg_op = 'UPDATE' and old.role = 'admin' and old.is_active
     and (new.role <> 'admin' or not new.is_active)
     and not exists (select 1 from public.profiles p where p.id <> old.id and p.role = 'admin' and p.is_active) then
    raise exception '% is the only admin. Make someone else an admin first, so Argus always has one.', coalesce(old.full_name, 'This person');
  end if;
  return new;
end $$;

create or replace function public._profiles_keep_admin_on_delete()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if old.role = 'admin' and old.is_active
     and not exists (select 1 from public.profiles p where p.id <> old.id and p.role = 'admin' and p.is_active) then
    raise exception 'Can''t delete the only admin. Make someone else an admin first.';
  end if;
  return old;
end $$;
drop trigger if exists profiles_keep_admin on public.profiles;
create trigger profiles_keep_admin before delete on public.profiles
  for each row execute function public._profiles_keep_admin_on_delete();
