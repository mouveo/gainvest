-- Allow crypto support on transactions and link the two legs of a conversion.

alter table public.transactions
  drop constraint if exists transactions_support_check;

alter table public.transactions
  add constraint transactions_support_check
  check (support in ('CTO', 'PEA', 'PEA-PME', 'AV', 'CRYPTO'));

alter table public.transactions
  add column if not exists convert_pair_id uuid;

create index if not exists transactions_convert_pair_idx
  on public.transactions (convert_pair_id)
  where convert_pair_id is not null;
