-- Adds the columns the order form needs (broker, exec venue, exec time) and a
-- current price snapshot on instruments. Also wires a trigger so every new
-- auth user automatically gets a default "Portefeuille" account — the UI
-- doesn't expose account selection yet, but the FK on transactions still needs
-- a valid account_id.

-- =========================================================================
-- transactions: add execution metadata
-- =========================================================================
alter table public.transactions
  add column if not exists trade_time      time,
  add column if not exists execution_venue text,
  add column if not exists broker          text;

-- =========================================================================
-- instruments: cache the latest price + when it was last edited
-- =========================================================================
alter table public.instruments
  add column if not exists current_price            numeric(20, 6),
  add column if not exists current_price_updated_at timestamptz;

-- =========================================================================
-- Default "Portefeuille" account per user
-- =========================================================================
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.accounts (user_id, name, type, currency)
  values (new.id, 'Portefeuille', 'cto', 'EUR');
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Backfill: users created before this migration get one too.
insert into public.accounts (user_id, name, type, currency)
select u.id, 'Portefeuille', 'cto', 'EUR'
from auth.users u
where not exists (
  select 1 from public.accounts a where a.user_id = u.id
);
