begin;
do $test$
declare
  test_user uuid := gen_random_uuid();
  session_id text := 'cs_live_fixture'||replace(gen_random_uuid()::text,'-','');
  missing_session text := 'cs_live_missing'||replace(gen_random_uuid()::text,'-','');
  outcome jsonb;
  denied boolean := false;
  total integer;
begin
  insert into auth.users(id,email,raw_user_meta_data)
    values(test_user,'payment-fixture-'||test_user::text||'@example.invalid','{}'::jsonb);
  insert into public.checkout_consents(stripe_checkout_session_id,user_id,cgv_accepted,immediate_start_requested,withdrawal_information_acknowledged,terms_version)
    values(session_id,test_user,true,true,true,'test-fixture');

  execute 'set local role service_role';
  outcome:=public.activate_paid_enrollment(test_user,session_id,'pi_fixture','price_fixture',3700,'eur');
  if outcome->>'activated'<>'true' then raise exception 'First activation failed'; end if;
  if not exists(select 1 from public.enrollments where user_id=test_user and status='active') then raise exception 'Access not activated'; end if;
  outcome:=public.activate_paid_enrollment(test_user,session_id,'pi_fixture','price_fixture',3700,'eur');
  if outcome->>'duplicate'<>'true' then raise exception 'Duplicate not recognized'; end if;
  select count(*) into total from public.payment_orders where stripe_checkout_session_id=session_id;
  if total<>1 then raise exception 'Duplicate order created'; end if;
  update public.enrollments set status='revoked' where user_id=test_user;
  perform public.activate_paid_enrollment(test_user,session_id,'pi_fixture','price_fixture',3700,'eur');
  if not exists(select 1 from public.enrollments where user_id=test_user and status='revoked') then raise exception 'Replay restored revoked access'; end if;

  begin
    perform public.activate_paid_enrollment(test_user,'cs_test_fixture','pi_fixture','price_fixture',3700,'eur');
  exception when others then denied:=true; end;
  if not denied then raise exception 'Test session accepted'; end if;
  denied:=false;
  begin
    perform public.activate_paid_enrollment(test_user,missing_session,'pi_fixture','price_fixture',3700,'eur');
  exception when others then denied:=true; end;
  if not denied then raise exception 'Missing consents accepted'; end if;
  denied:=false;
  begin
    perform public.activate_paid_enrollment(test_user,session_id,'pi_fixture','price_fixture',2700,'eur');
  exception when others then denied:=true; end;
  if not denied then raise exception 'Wrong amount accepted'; end if;

  execute 'reset role';
  perform set_config('request.jwt.claim.sub',test_user::text,true);
  perform set_config('request.jwt.claims',json_build_object('sub',test_user::text,'role','authenticated')::text,true);
  execute 'set local role authenticated';
  denied:=false;
  begin
    perform public.activate_paid_enrollment(test_user,session_id,'pi_fixture','price_fixture',3700,'eur');
  exception when insufficient_privilege then denied:=true; end;
  if not denied then raise exception 'Signed-in member can call activation'; end if;
  execute 'reset role';
end;
$test$;
rollback;
select 'PASS: atomic activation, duplicate handling, revoked access preserved, test sessions and missing consents refused, member RPC access denied; fixtures rolled back' as verification;
