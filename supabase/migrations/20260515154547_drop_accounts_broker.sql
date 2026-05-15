-- Drop the broker column from accounts.
--
-- The "Opérateur" field at account level was redundant and misleading: a
-- single account can hold transactions executed via several brokers (e.g. BD
-- and IBKR on the same compte-titres). The authoritative broker lives on
-- transactions.broker. Cleaner data model + simpler UI.

ALTER TABLE accounts DROP COLUMN IF EXISTS broker;
