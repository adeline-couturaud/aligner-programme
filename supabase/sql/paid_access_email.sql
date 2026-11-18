begin;
create table private.paid_access_email_outbox (
 session_id text primary key references public.payment_orders(stripe_checkout_session_id) on delete cascade,
 user_id uuid not null references auth.users(id) on delete cascade,
 status text not null default 'pending' check(status in ('pending','sending','failed','sent','review','skipped')),
 payload jsonb,
 attempts integer not null default 0,
 first_attempt_at timestamptz,
 locked_at timestamptz,
 claim_token uuid,
 sent_at timestamptz,
 provider_message_id text,
 last_error text,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 check(session_id ~ '^cs_live_[A-Za-z0-9]+$')
);
create index paid_access_email_outbox_user_idx on private.paid_access_email_outbox(user_id);
alter table private.paid_access_email_outbox enable row level security;
revoke all on private.paid_access_email_outbox from public,anon,authenticated;
grant usage on schema private to service_role;
grant select,insert,update,delete on private.paid_access_email_outbox to service_role;
create policy paid_access_email_service_only on private.paid_access_email_outbox
 for all to service_role using(true) with check(true);

create or replace function public.claim_paid_access_email(p_user_id uuid,p_session_id text,p_payload jsonb)
returns jsonb language plpgsql security invoker set search_path=''
as $fn$
declare
 job private.paid_access_email_outbox%rowtype;
 token uuid;
begin
 select * into job from private.paid_access_email_outbox
 where session_id=p_session_id and user_id=p_user_id for update;
 if not found then return jsonb_build_object('status','not_queued'); end if;
 if job.status in ('sent','review','skipped') then return jsonb_build_object('status',job.status); end if;
 if not exists(
  select 1 from public.payment_orders o join public.enrollments e on e.user_id=o.user_id
  where o.stripe_checkout_session_id=p_session_id and o.user_id=p_user_id
    and o.status='paid' and o.total_cents=3700 and o.currency='eur' and e.status='active'
 ) then
  update private.paid_access_email_outbox set status='skipped',updated_at=now(),last_error='access_not_active'
   where session_id=p_session_id;
  return jsonb_build_object('status','skipped');
 end if;
 -- Resend only deduplicates for 24h. Stop before that boundary after an ambiguous attempt.
 if job.first_attempt_at is not null and job.first_attempt_at < now()-interval '23 hours' then
  update private.paid_access_email_outbox set status='review',updated_at=now(),last_error='idempotency_window_expiring'
   where session_id=p_session_id;
  return jsonb_build_object('status','review');
 end if;
 if job.status='sending' and job.locked_at>now()-interval '2 minutes' then
  return jsonb_build_object('status','busy');
 end if;
 if job.payload is null and (
  p_payload is null or jsonb_typeof(p_payload)<>'object'
  or jsonb_typeof(p_payload->'to') is distinct from 'array'
  or jsonb_array_length(p_payload->'to')<>1
  or coalesce(p_payload->'to'->>0,'')=''
 ) then raise exception 'Email payload required'; end if;
 token:=gen_random_uuid();
 update private.paid_access_email_outbox set
  status='sending',payload=coalesce(payload,p_payload),attempts=attempts+1,
  first_attempt_at=coalesce(first_attempt_at,now()),locked_at=now(),claim_token=token,
  last_error=null,updated_at=now()
 where session_id=p_session_id
 returning * into job;
 return jsonb_build_object('status','claimed','token',token,'payload',job.payload);
end;
$fn$;
create or replace function public.finish_paid_access_email(
 p_session_id text,p_token uuid,p_success boolean,p_provider_id text,p_error text)
returns boolean language plpgsql security invoker set search_path=''
as $fn$
declare changed integer;
begin
 if p_success and coalesce(p_provider_id,'')='' then raise exception 'Provider id required'; end if;
 update private.paid_access_email_outbox set
  status=case when p_success then 'sent' else 'failed' end,
  sent_at=case when p_success then now() else null end,
  provider_message_id=case when p_success then p_provider_id else null end,
  last_error=case when p_success then null else left(p_error,80) end,
  locked_at=null,claim_token=null,updated_at=now()
 where session_id=p_session_id and status='sending' and claim_token=p_token;
 get diagnostics changed=row_count;
 return changed=1;
end;
$fn$;
revoke all on function public.claim_paid_access_email(uuid,text,jsonb) from public,anon,authenticated;
revoke all on function public.finish_paid_access_email(text,uuid,boolean,text,text) from public,anon,authenticated;
grant execute on function public.claim_paid_access_email(uuid,text,jsonb) to service_role;
grant execute on function public.finish_paid_access_email(text,uuid,boolean,text,text) to service_role;
commit;
