begin;
do $test$
declare
 uid uuid:=gen_random_uuid();
 sid text:='cs_live_emailfixture'||replace(gen_random_uuid()::text,'-','');
 sid2 text;
 sid3 text;
 j jsonb;
 token uuid;
 denied boolean;
 n integer;
 original jsonb:=jsonb_build_object('to',jsonb_build_array('fixture@example.invalid'),'text','Original immutable message');
 changed jsonb:=jsonb_build_object('to',jsonb_build_array('changed@example.invalid'),'text','Changed message');
begin
 sid2:=sid||'Revoked';sid3:=sid||'Review';
 insert into auth.users(id,email,raw_user_meta_data) values(uid,'email-fixture-'||uid||'@example.invalid','{}'::jsonb);
 insert into public.checkout_consents(stripe_checkout_session_id,user_id,cgv_accepted,immediate_start_requested,withdrawal_information_acknowledged,terms_version)
 values(sid,uid,true,true,true,'fixture'),(sid2,uid,true,true,true,'fixture'),(sid3,uid,true,true,true,'fixture');
 execute 'set local role service_role';
 perform public.activate_paid_enrollment(uid,sid,'pi_fixture','price_fixture',3700,'eur');
 if not exists(select 1 from private.paid_access_email_outbox where session_id=sid and status='pending') then raise exception 'Email not queued with activation'; end if;
 perform public.activate_paid_enrollment(uid,sid,'pi_fixture','price_fixture',3700,'eur');
 select count(*) into n from private.paid_access_email_outbox where session_id=sid;
 if n<>1 then raise exception 'Duplicate email job'; end if;
 j:=public.claim_paid_access_email(uid,sid,original);token:=(j->>'token')::uuid;
 if j->>'status'<>'claimed' or j->'payload'<>original then raise exception 'First claim failed'; end if;
 if public.claim_paid_access_email(uid,sid,changed)->>'status'<>'busy' then raise exception 'Concurrent claim accepted'; end if;
 if public.finish_paid_access_email(sid,gen_random_uuid(),true,'wrong',null) then raise exception 'Wrong token accepted'; end if;
 if not public.finish_paid_access_email(sid,token,false,null,'provider_http_429') then raise exception 'Failed send not recorded'; end if;
 j:=public.claim_paid_access_email(uid,sid,changed);token:=(j->>'token')::uuid;
 if j->'payload'<>original then raise exception 'Retry changed frozen payload'; end if;
 if not public.finish_paid_access_email(sid,token,true,'provider-fixture',null) then raise exception 'Success not recorded'; end if;
 if public.claim_paid_access_email(uid,sid,changed)->>'status'<>'sent' then raise exception 'Sent email claimed again'; end if;
 select attempts into n from private.paid_access_email_outbox where session_id=sid;
 if n<>2 then raise exception 'Incorrect attempt count'; end if;

 perform public.activate_paid_enrollment(uid,sid2,'pi_fixture2','price_fixture',3700,'eur');
 update public.enrollments set status='revoked' where user_id=uid;
 if public.claim_paid_access_email(uid,sid2,original)->>'status'<>'skipped' then raise exception 'Revoked access email accepted'; end if;
 perform public.activate_paid_enrollment(uid,sid2,'pi_fixture2','price_fixture',3700,'eur');
 if not exists(select 1 from public.enrollments where user_id=uid and status='revoked') then raise exception 'Replay restored revoked access'; end if;

 perform public.activate_paid_enrollment(uid,sid3,'pi_fixture3','price_fixture',3700,'eur');
 j:=public.claim_paid_access_email(uid,sid3,original);
 perform public.finish_paid_access_email(sid3,(j->>'token')::uuid,false,null,'network');
 update private.paid_access_email_outbox set first_attempt_at=now()-interval '24 hours' where session_id=sid3;
 if public.claim_paid_access_email(uid,sid3,original)->>'status'<>'review' then raise exception 'Expired idempotency window retried'; end if;
 if public.claim_paid_access_email(uid,sid||'Unknown',original)->>'status'<>'not_queued' then raise exception 'Unknown session accepted'; end if;
 if public.claim_paid_access_email(gen_random_uuid(),sid3,original)->>'status'<>'not_queued' then raise exception 'Wrong user accepted'; end if;
 if not exists(select 1 from public.enrollments where user_id=uid and status='active') then raise exception 'Email failure removed access'; end if;

 execute 'reset role';
 execute 'set local role authenticated';
 denied:=false;begin perform public.claim_paid_access_email(uid,sid,original);exception when insufficient_privilege then denied:=true;end;
 if not denied then raise exception 'Member can claim emails';end if;
 denied:=false;begin perform public.finish_paid_access_email(sid,token,true,'injected',null);exception when insufficient_privilege then denied:=true;end;
 if not denied then raise exception 'Member can mark emails sent';end if;
 denied:=false;begin perform 1 from private.paid_access_email_outbox;exception when insufficient_privilege then denied:=true;end;
 if not denied then raise exception 'Member can read outbox';end if;
 execute 'reset role';
end;
$test$;
rollback;
select 'PASS: email queue atomic with activation; no duplicate; lease and token guards; frozen retry; sent message never reclaimed; revoked access skipped; expired retry requires review; member access denied; fixtures rolled back' as verification;
