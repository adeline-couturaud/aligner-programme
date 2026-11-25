begin;
do $$
declare u uuid:=gen_random_uuid(); outsider uuid:=gen_random_uuid(); before_count int; stamp timestamptz;
begin
 insert into private.complimentary_access(email) values ('carnet-free-test@example.invalid');
 insert into auth.users(id,email,raw_user_meta_data) values(u,'carnet-free-test@example.invalid','{"display_name":"Test accès offert"}');
 if (select status from public.enrollments where user_id=u)<>'pending' then raise exception 'Unconfirmed grant'; end if;
 if (select redeemed_at from private.complimentary_access where email='carnet-free-test@example.invalid') is not null then raise exception 'Premature redemption'; end if;
 update auth.users set email_confirmed_at=now() where id=u;
 if not private.active_member(u) then raise exception 'Verified access missing'; end if;
 if (select role from public.profiles where id=u)<>'member' then raise exception 'Unexpected role'; end if;
 if (select purchased_at from public.enrollments where user_id=u) is not null then raise exception 'Fake purchase'; end if;
 select redeemed_at into stamp from private.complimentary_access where email='carnet-free-test@example.invalid' and redeemed_user_id=u;
 if stamp is null then raise exception 'Missing redemption'; end if;
 update public.enrollments set status='revoked' where user_id=u;
 update auth.users set email_confirmed_at=now() where id=u;
 if private.active_member(u) then raise exception 'Revoked access reactivated'; end if;
 if (select redeemed_at from private.complimentary_access where email='carnet-free-test@example.invalid')<>stamp then raise exception 'Duplicate redemption'; end if;
 insert into auth.users(id,email,email_confirmed_at,raw_user_meta_data) values(outsider,'carnet-outsider@example.invalid',now(),'{"display_name":"Test sans accès"}');
 if private.active_member(outsider) then raise exception 'Outsider granted'; end if;
 if has_table_privilege('authenticated','private.complimentary_access','SELECT') or has_table_privilege('anon','private.complimentary_access','INSERT') then raise exception 'Exposed reservations'; end if;
 if has_function_privilege('authenticated','private.redeem_complimentary_access()','EXECUTE') then raise exception 'Callable trigger'; end if;
 -- The same authenticated RLS used by the app allows all 21 days to the recipient.
 update public.enrollments set status='active' where user_id=u;
 perform set_config('request.jwt.claims',jsonb_build_object('sub',u,'role','authenticated')::text,true);
 perform set_config('request.jwt.claim.sub',u::text,true);
 execute 'set local role authenticated';
 select count(*) into before_count from public.program_days;
 if before_count<>21 then raise exception 'Expected 21 days, got %',before_count; end if;
 execute 'reset role';
 perform set_config('request.jwt.claims',jsonb_build_object('sub',outsider,'role','authenticated')::text,true);
 perform set_config('request.jwt.claim.sub',outsider::text,true);
 execute 'set local role authenticated';
 select count(*) into before_count from public.program_days;
 if before_count<>0 then raise exception 'Outsider can read protected days'; end if;
 execute 'reset role';
end $$;
rollback;
select 'PASS: verified signup, no payment, member only, one redemption, revocation respected, 21 protected days, outsider denied; all test data rolled back' as result;
