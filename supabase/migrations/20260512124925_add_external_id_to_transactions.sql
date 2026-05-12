-- Stocker l'identifiant externe (ibExecID pour IBKR, transactionID pour cash flows,
-- ou un futur reference broker) pour un dedoublonnement robuste a l'import.
alter table public.transactions
  add column if not exists external_id text;

create index if not exists transactions_external_id_idx on public.transactions (external_id)
  where external_id is not null;
