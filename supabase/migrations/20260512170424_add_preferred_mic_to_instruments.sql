-- Add quote-provider listing fields to instruments so we can target a
-- specific venue (MIC) and provider symbol without round-tripping
-- through yahoo_symbol on every refresh. Backfills existing rows from
-- the legacy yahoo_symbol column; yahoo_symbol is kept for now.

alter table public.instruments
  add column if not exists preferred_mic text,
  add column if not exists preferred_currency text,
  add column if not exists provider text,
  add column if not exists provider_symbol text;

create index if not exists instruments_preferred_mic_idx
  on public.instruments (preferred_mic)
  where preferred_mic is not null;

update public.instruments
set preferred_mic = case
      when yahoo_symbol like '%.US'    then 'XNAS'
      when yahoo_symbol like '%.XETRA' then 'XETR'
      when yahoo_symbol like '%.F'     then 'XFRA'
      when yahoo_symbol like '%.PA'    then 'XPAR'
      when yahoo_symbol like '%.AS'    then 'XAMS'
      when yahoo_symbol like '%.MI'    then 'XMIL'
      when yahoo_symbol like '%.LSE'   then 'XLON'
      when yahoo_symbol like '%.LS'    then 'XLIS'
      when yahoo_symbol like '%.MC'    then 'XMAD'
      when yahoo_symbol like '%.SW'    then 'XSWX'
      when yahoo_symbol like '%.BR'    then 'XBRU'
      else null
    end,
    preferred_currency = currency,
    provider = case when yahoo_symbol is not null then 'eodhd' else provider end,
    provider_symbol = yahoo_symbol
where yahoo_symbol is not null;
