-- Cache the Yahoo Finance ticker on each instrument so we can poll
-- query1.finance.yahoo.com without re-resolving the ISIN every refresh.
-- Also opens up the `update` path on instruments to authenticated users
-- (read/insert were already allowed) so the refresh action can write
-- back current_price + current_price_updated_at via RLS.

alter table public.instruments
  add column if not exists yahoo_symbol text;

drop policy if exists "instruments authenticated update" on public.instruments;
create policy "instruments authenticated update" on public.instruments
  for update
  using (auth.role() = 'authenticated')
  with check (auth.role() = 'authenticated');
