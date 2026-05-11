-- Gainvest — initial schema
-- Applied automatically by `supabase start` (local) and `supabase db push` (cloud).
-- All tables that hold user data have a `user_id` column and Row Level Security
-- enabled so each authenticated user only sees their own rows.

-- =========================================================================
-- Extensions
-- =========================================================================
create extension if not exists "pgcrypto";

-- =========================================================================
-- accounts — brokerage / banking accounts holding the user's positions
-- =========================================================================
create table if not exists public.accounts (
  id          uuid        primary key default gen_random_uuid(),
  user_id     uuid        not null references auth.users (id) on delete cascade,
  name        text        not null,
  type        text        not null check (type in (
    'pea','pea_pme','cto','av','per','livret','crypto','real_estate','other'
  )),
  broker      text,
  currency    text        not null default 'EUR',
  opened_at   date,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index if not exists accounts_user_id_idx on public.accounts (user_id);

alter table public.accounts enable row level security;

create policy "accounts owner select" on public.accounts
  for select using (auth.uid() = user_id);
create policy "accounts owner insert" on public.accounts
  for insert with check (auth.uid() = user_id);
create policy "accounts owner update" on public.accounts
  for update using (auth.uid() = user_id);
create policy "accounts owner delete" on public.accounts
  for delete using (auth.uid() = user_id);

-- =========================================================================
-- instruments — securities (stocks, ETFs, bonds, crypto, …). Global catalogue
-- shared across users; reads are public, writes restricted to authenticated.
-- =========================================================================
create table if not exists public.instruments (
  id           uuid        primary key default gen_random_uuid(),
  symbol       text        not null,
  isin         text,
  mic          text,
  name         text        not null,
  asset_class  text        not null check (asset_class in (
    'equity','etf','fund','bond','crypto','real_estate','cash'
  )),
  currency     text        not null default 'EUR',
  country      text,
  created_at   timestamptz not null default now(),
  unique (symbol, mic)
);

create index if not exists instruments_isin_idx on public.instruments (isin);

alter table public.instruments enable row level security;

create policy "instruments authenticated read" on public.instruments
  for select using (auth.role() = 'authenticated');
create policy "instruments authenticated write" on public.instruments
  for insert with check (auth.role() = 'authenticated');

-- =========================================================================
-- transactions — every flow on an account (buy/sell/dividend/fee/…)
-- =========================================================================
create table if not exists public.transactions (
  id               uuid        primary key default gen_random_uuid(),
  user_id          uuid        not null references auth.users (id) on delete cascade,
  account_id       uuid        not null references public.accounts (id) on delete cascade,
  instrument_id    uuid                 references public.instruments (id) on delete restrict,
  kind             text        not null check (kind in (
    'buy','sell','dividend','interest','fee','tax','deposit','withdrawal'
  )),
  trade_date       date        not null,
  settlement_date  date,
  quantity         numeric(20,8),
  price            numeric(20,6),
  gross_amount     numeric(20,2) not null,
  fees             numeric(20,2) not null default 0,
  tax              numeric(20,2) not null default 0,
  currency         text        not null default 'EUR',
  fx_rate          numeric(20,8),
  notes            text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create index if not exists transactions_user_id_idx on public.transactions (user_id);
create index if not exists transactions_account_id_idx on public.transactions (account_id);
create index if not exists transactions_instrument_id_idx on public.transactions (instrument_id);
create index if not exists transactions_trade_date_idx on public.transactions (trade_date);

alter table public.transactions enable row level security;

create policy "transactions owner select" on public.transactions
  for select using (auth.uid() = user_id);
create policy "transactions owner insert" on public.transactions
  for insert with check (auth.uid() = user_id);
create policy "transactions owner update" on public.transactions
  for update using (auth.uid() = user_id);
create policy "transactions owner delete" on public.transactions
  for delete using (auth.uid() = user_id);

-- =========================================================================
-- prices — closing price per instrument per day
-- =========================================================================
create table if not exists public.prices (
  instrument_id  uuid    not null references public.instruments (id) on delete cascade,
  date           date    not null,
  close          numeric(20,6) not null,
  currency       text    not null default 'EUR',
  source         text,
  primary key (instrument_id, date)
);

create index if not exists prices_date_idx on public.prices (date desc);

alter table public.prices enable row level security;

create policy "prices authenticated read" on public.prices
  for select using (auth.role() = 'authenticated');
create policy "prices service write" on public.prices
  for insert with check (auth.role() = 'service_role');

-- =========================================================================
-- updated_at trigger
-- =========================================================================
create or replace function public.tg_set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists set_updated_at on public.accounts;
create trigger set_updated_at before update on public.accounts
  for each row execute function public.tg_set_updated_at();

drop trigger if exists set_updated_at on public.transactions;
create trigger set_updated_at before update on public.transactions
  for each row execute function public.tg_set_updated_at();
