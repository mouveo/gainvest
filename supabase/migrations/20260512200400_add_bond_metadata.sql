-- Adds bond-specific metadata columns to `instruments`. Populated by the IBKR
-- import pipeline (parser extracts coupon/maturity/frequency from the
-- description/symbol) and surfaced by valuation/realize logic. Manual edits
-- take precedence: backfill and reimport only fill columns when they are
-- still NULL.

alter table public.instruments
  add column bond_coupon_rate       numeric(6, 4),
  add column bond_maturity_date     date,
  add column bond_coupon_frequency  smallint;

alter table public.instruments
  add constraint instruments_bond_coupon_frequency_check
  check (
    bond_coupon_frequency is null
    or bond_coupon_frequency in (1, 2, 4)
  );

create index instruments_bond_maturity_idx
  on public.instruments(bond_maturity_date)
  where asset_class = 'bond';
