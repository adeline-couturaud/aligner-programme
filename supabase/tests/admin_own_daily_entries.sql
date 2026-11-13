begin;
do $test$
declare
  admin_id uuid := gen_random_uuid();
  member_id uuid := gen_random_uuid();
  pending_id uuid := gen_random_uuid();
  denied boolean;
  affected integer;
  visible integer;
begin
  insert into auth.users(id,email,raw_user_meta_data) values
    (admin_id,'rls-admin-'||admin_id::text||'@example.invalid','{}'::jsonb),
    (member_id,'rls-member-'||member_id::text||'@example.invalid','{}'::jsonb),
    (pending_id,'rls-pending-'||pending_id::text||'@example.invalid','{}'::jsonb);
  update public.profiles set role='admin' where id=admin_id;
  update public.enrollments set status='active' where user_id=member_id;
  insert into public.daily_entries(user_id,day,answers,shared_with_adeline)
    values(member_id,1,'{"fixture":"member-private"}'::jsonb,false);

  perform set_config('request.jwt.claim.sub',admin_id::text,true);
  perform set_config('request.jwt.claims',json_build_object('sub',admin_id::text,'role','authenticated')::text,true);
  execute 'set local role authenticated';

  insert into public.daily_entries(user_id,day,answers)
    values(admin_id,1,'{"fixture":"admin-first"}'::jsonb)
    on conflict(user_id,day) do update set answers=excluded.answers;
  insert into public.daily_entries(user_id,day,answers)
    values(admin_id,1,'{"fixture":"admin-updated"}'::jsonb)
    on conflict(user_id,day) do update set answers=excluded.answers;
  if not exists(select 1 from public.daily_entries where user_id=admin_id and day=1 and answers->>'fixture'='admin-updated') then
    raise exception 'Admin own upsert failed';
  end if;
  select count(*) into visible from public.daily_entries where user_id=member_id and day=1;
  if visible<>0 then raise exception 'Admin can read unshared fixture'; end if;
  denied:=false;
  begin
    insert into public.daily_entries(user_id,day) values(member_id,2);
  exception when insufficient_privilege then denied:=true;
  end;
  if not denied then raise exception 'Admin can insert another user entry'; end if;

  execute 'reset role';
  update public.daily_entries set shared_with_adeline=true where user_id=member_id and day=1;
  execute 'set local role authenticated';
  select count(*) into visible from public.daily_entries where user_id=member_id and day=1;
  if visible<>1 then raise exception 'Shared fixture not visible to admin'; end if;
  update public.daily_entries set notes='unauthorized' where user_id=member_id and day=1;
  get diagnostics affected=row_count;
  if affected<>0 then raise exception 'Admin can modify another user shared entry'; end if;

  execute 'reset role';
  perform set_config('request.jwt.claim.sub',member_id::text,true);
  perform set_config('request.jwt.claims',json_build_object('sub',member_id::text,'role','authenticated')::text,true);
  execute 'set local role authenticated';
  insert into public.daily_entries(user_id,day,answers)
    values(member_id,1,'{"fixture":"member-updated"}'::jsonb)
    on conflict(user_id,day) do update set answers=excluded.answers;
  if not exists(select 1 from public.daily_entries where user_id=member_id and answers->>'fixture'='member-updated') then
    raise exception 'Active member own upsert failed';
  end if;
  select count(*) into visible from public.daily_entries where user_id=admin_id;
  if visible<>0 then raise exception 'Member can read another user entry'; end if;

  execute 'reset role';
  perform set_config('request.jwt.claim.sub',pending_id::text,true);
  perform set_config('request.jwt.claims',json_build_object('sub',pending_id::text,'role','authenticated')::text,true);
  execute 'set local role authenticated';
  denied:=false;
  begin insert into public.daily_entries(user_id,day) values(pending_id,1);
  exception when insufficient_privilege then denied:=true;
  end;
  if not denied then raise exception 'Pending member can create entry'; end if;
  execute 'reset role';
end $test$;
rollback;
select 'PASS: admin own INSERT/UPDATE upserts, active member save, private entry isolation, shared read-only for admin, cross-owner INSERT rejected, pending member rejected; all test fixtures rolled back' as verification;
