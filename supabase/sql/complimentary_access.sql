-- Complimentaries are reserved privately and redeemed only after email verification.
-- Never commit recipient emails in this public repository.
create table private.complimentary_access (
 email text primary key check (email = lower(btrim(email)) and position('@' in email)>1),
 granted_at timestamptz not null default now(),
 redeemed_at timestamptz,
 redeemed_user_id uuid references auth.users(id) on delete set null
);
alter table private.complimentary_access enable row level security;
revoke all on private.complimentary_access from public,anon,authenticated;
grant select,insert,update,delete on private.complimentary_access to service_role;
create policy complimentary_service_only on private.complimentary_access to service_role using (true) with check (true);

-- A trigger needs to cross from auth into the private reservation table.
-- No caller-supplied user ID or metadata is used for authorization.
create function private.redeem_complimentary_access() returns trigger
language plpgsql security definer set search_path='' as $$
declare claimed text;
begin
 if new.email_confirmed_at is null or new.email is null then return new; end if;
 update private.complimentary_access
 set redeemed_user_id=new.id,redeemed_at=now()
 where email=lower(btrim(new.email)) and redeemed_at is null
 returning email into claimed;
 if claimed is not null then
  insert into public.enrollments(user_id,status)
  values(new.id,'active')
  on conflict(user_id) do update set status='active';
 end if;
 return new;
end;
$$;
revoke all on function private.redeem_complimentary_access() from public,anon,authenticated,service_role;
create trigger aligner_redeem_complimentary_access
 after insert or update of email,email_confirmed_at on auth.users
 for each row execute function private.redeem_complimentary_access();
