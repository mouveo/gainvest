-- Indexes pour le calcul et le recalibrage du solde cash.
-- Le premier accelere le scan des flux qui impactent le cash par
-- (user_id, support, broker, currency) sur l'axe trade_date.
-- Le second garantit l'unicite (par scope cash) du depot "Solde initial".

create index if not exists transactions_cash_balance_idx
  on public.transactions (user_id, support, broker, currency, trade_date)
  where kind in ('buy','sell','dividend','interest','fee','tax','deposit','withdrawal');

create index if not exists transactions_initial_cash_unique_idx
  on public.transactions (user_id, support, broker, currency)
  where kind = 'deposit'
    and notes = 'Solde initial — saisie manuelle';
