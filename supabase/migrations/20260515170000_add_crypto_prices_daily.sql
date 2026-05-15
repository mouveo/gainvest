-- Daily historical EUR prices for crypto assets, keyed on the CoinGecko id
-- (provider_symbol). Used by the French art. 150 VH bis fiscal calculator to
-- value the whole portfolio at each fiat cession date. Global table (no
-- user_id) — same price for every user. Writes are server-side only.

create table if not exists public.crypto_prices_daily (
  provider_symbol text not null,
  date date not null,
  currency text not null default 'EUR',
  price_eur numeric(20, 8) not null,
  source text not null default 'coingecko',
  fetched_at timestamptz not null default now(),
  primary key (provider_symbol, date, currency)
);

alter table public.crypto_prices_daily enable row level security;

drop policy if exists "crypto_prices_daily authenticated read" on public.crypto_prices_daily;
create policy "crypto_prices_daily authenticated read" on public.crypto_prices_daily
  for select using (auth.role() = 'authenticated');
