DO $$ BEGIN IF EXISTS (SELECT 1 FROM public.checkout_consents) THEN RAISE EXCEPTION 'Consent history changed; inspect before renaming'; END IF; END $$;
-- Demandes reçues, sans déclenchement automatique de remboursement.
create table public.withdrawal_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete set null,
  first_name text not null check (length(first_name) between 1 and 80),
  last_name text not null check (length(last_name) between 1 and 80),
  email text not null check (length(email) between 3 and 254),
  purchase_date date not null,
  order_reference text not null default '' check (length(order_reference) <= 160),
  created_at timestamptz not null default now(),
  receipt_sent_at timestamptz,
  notification_sent_at timestamptz,
  unique (user_id, purchase_date, order_reference)
);
create index withdrawal_requests_user_created_idx
  on public.withdrawal_requests (user_id, created_at desc);
alter table public.withdrawal_requests enable row level security;
revoke all on public.withdrawal_requests from public, anon, authenticated;
grant select, insert, update on public.withdrawal_requests to service_role;

-- Aucune vente n'a encore été enregistrée. Le champ exprime la prise de
-- connaissance du droit, sans enregistrer une renonciation inexistante.
alter table public.checkout_consents
  rename column withdrawal_loss_acknowledged to withdrawal_information_acknowledged;
alter table public.checkout_consents
  rename constraint checkout_consents_withdrawal_loss_acknowledged_check
  to checkout_consents_withdrawal_information_acknowledged_check;

comment on table public.withdrawal_requests is 'Demandes de rétractation. Accès réservé aux fonctions serveur ; aucun accès direct anon/authenticated.';
