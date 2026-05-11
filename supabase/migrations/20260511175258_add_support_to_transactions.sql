-- Tag the legal/fiscal wrapper (CTO, PEA, PEA-PME, AV) on each transaction.
alter table public.transactions
  add column if not exists support text not null default 'CTO'
    check (support in ('CTO', 'PEA', 'PEA-PME', 'AV'));

create index if not exists transactions_support_idx
  on public.transactions (support);
