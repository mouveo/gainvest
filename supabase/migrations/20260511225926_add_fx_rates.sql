-- Cache of "1 unit of <currency> in EUR" rates fetched from a quote provider.
-- Used to convert instrument prices that are not natively in EUR (e.g. AAPL in
-- USD) into EUR for portfolio-level aggregation. The table is global (no
-- user_id) since rates are the same for every user. RLS allows authenticated
-- read; writes are handled server-side via the service role through Next.js
-- server actions.

create table if not exists public.fx_rates (
  currency text primary key,
  eur_rate numeric(20, 8) not null,
  fetched_at timestamptz not null default now()
);

alter table public.fx_rates enable row level security;

drop policy if exists "fx_rates authenticated read" on public.fx_rates;
create policy "fx_rates authenticated read" on public.fx_rates
  for select using (auth.role() = 'authenticated');

-- Seed EUR=1 so the conversion is a no-op for EUR-quoted instruments.
insert into public.fx_rates (currency, eur_rate, fetched_at)
values ('EUR', 1, now())
on conflict (currency) do nothing;
