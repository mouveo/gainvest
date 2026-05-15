// Domain types derived from the Supabase-generated schema.
// Regenerate with `pnpm db:types` after editing supabase/migrations/*.sql.

import type { Database } from "@/lib/supabase/types";

type Tables = Database["public"]["Tables"];
type Enums = Database["public"]["Enums"];

export type Account = Tables["accounts"]["Row"];
export type AccountInsert = Tables["accounts"]["Insert"];
export type AccountUpdate = Tables["accounts"]["Update"];

export type Instrument = Tables["instruments"]["Row"];
export type InstrumentInsert = Tables["instruments"]["Insert"];
export type InstrumentUpdate = Tables["instruments"]["Update"];

export type Transaction = Tables["transactions"]["Row"];
export type TransactionInsert = Tables["transactions"]["Insert"];
export type TransactionUpdate = Tables["transactions"]["Update"];

export type Price = Tables["prices"]["Row"];
export type PriceInsert = Tables["prices"]["Insert"];

// Enum literals — kept here so the rest of the app doesn't have to dig into
// Database["public"]["Tables"]["accounts"]["Row"]["type"] every time.
export type AccountType = NonNullable<Account["type"]>;
export type AssetClass = NonNullable<Instrument["asset_class"]>;
export type TransactionKind = NonNullable<Transaction["kind"]>;

export const SUPPORTS = ["CTO", "PEA", "PEA-PME", "AV", "CRYPTO"] as const;
export type Support = (typeof SUPPORTS)[number];

export type { Enums };
