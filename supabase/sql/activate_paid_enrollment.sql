begin;
create or replace function public.activate_paid_enrollment(
  p_user_id uuid,
  p_session_id text,
  p_payment_intent_id text,
  p_price_id text,
  p_total_cents integer,
  p_currency text
) returns jsonb
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  created_order uuid;
  existing_order public.payment_orders%rowtype;
  processed_at timestamptz := now();
begin
  if p_user_id is null or p_session_id is null or p_session_id !~ '^cs_live_[A-Za-z0-9]+$'
     or p_price_id is null or p_price_id !~ '^price_[A-Za-z0-9]+$'
     or p_total_cents is distinct from 3700 or p_currency is distinct from 'eur' then
    raise exception 'Unexpected live checkout parameters';
  end if;
  if not exists (
    select 1 from public.checkout_consents c
    where c.stripe_checkout_session_id = p_session_id and c.user_id = p_user_id
      and c.cgv_accepted and c.immediate_start_requested and c.withdrawal_information_acknowledged
  ) then
    raise exception 'Verified checkout consents required';
  end if;

  -- La commande et l'accès sont écrits dans une seule transaction.
  insert into public.payment_orders(
    user_id,stripe_checkout_session_id,stripe_payment_intent_id,stripe_price_id,
    total_cents,currency,status,updated_at
  ) values (
    p_user_id,p_session_id,p_payment_intent_id,p_price_id,p_total_cents,p_currency,'paid',processed_at
  ) on conflict(stripe_checkout_session_id) do nothing returning id into created_order;

  if created_order is null then
    select * into existing_order from public.payment_orders where stripe_checkout_session_id=p_session_id;
    if existing_order.user_id is distinct from p_user_id
       or existing_order.stripe_price_id is distinct from p_price_id
       or existing_order.total_cents is distinct from p_total_cents
       or existing_order.currency is distinct from p_currency then
      raise exception 'Conflicting checkout replay';
    end if;
    -- Une notification répétée ne réactive pas un accès retiré ultérieurement.
    return jsonb_build_object('activated',false,'duplicate',true);
  end if;

  insert into public.enrollments(user_id,status,purchased_at)
    values(p_user_id,'active',processed_at)
    on conflict(user_id) do update
      set status='active', purchased_at=coalesce(public.enrollments.purchased_at,excluded.purchased_at)
      where public.enrollments.status<>'active';
  return jsonb_build_object('activated',true,'duplicate',false);
end;
$function$;
revoke all on function public.activate_paid_enrollment(uuid,text,text,text,integer,text) from public,anon,authenticated;
grant execute on function public.activate_paid_enrollment(uuid,text,text,text,integer,text) to service_role;
commit;
