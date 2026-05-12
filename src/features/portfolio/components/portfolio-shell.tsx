"use client";

import { useState } from "react";

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

import type { OrderRow, PortfolioTotals, Position } from "../aggregate";
import type { PastRealization } from "../realize";
import { AddOrderSheet } from "./add-order-sheet";
import { AutoRefreshPrices } from "./auto-refresh-prices";
import { HoldingFeesToggle, useNetOfFeesMode } from "./holding-fees-toggle";
import { ImportSheet } from "./import-sheet";
import { KpiStrip } from "./kpi-strip";
import { OrdersTable } from "./orders-table";
import { PnlModeToggle, usePnlMode } from "./pnl-mode-toggle";
import { PositionsTable } from "./positions-table";
import { RealizationsTable } from "./realizations-table";
import { RefreshPricesButton } from "./refresh-prices-button";

type Tab = "positions" | "realizations" | "orders";

type Props = {
  positions: Position[];
  orders: OrderRow[];
  realizations: PastRealization[];
  totals: PortfolioTotals;
  pricesUpdatedAt: string | null;
};

export function PortfolioShell({
  positions,
  orders,
  realizations,
  totals,
  pricesUpdatedAt,
}: Props) {
  const [tab, setTab] = useState<Tab>("positions");
  const [withDividends, setWithDividends] = usePnlMode();
  const [netOfFees, setNetOfFees] = useNetOfFeesMode();
  const knownIsins = positions.map((p) => ({ isin: p.isin, name: p.instrumentName }));

  return (
    <div className="flex flex-col gap-6">
      <AutoRefreshPrices pricesUpdatedAt={pricesUpdatedAt} />
      <div className="flex items-start justify-between gap-4">
        <div className="flex flex-col gap-1">
          <h1 className="text-2xl font-semibold tracking-tight">Portefeuille</h1>
          <p className="text-muted-foreground text-sm">
            Une vue agrégée par instrument et le journal complet des ordres.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <RefreshPricesButton />
          <ImportSheet />
          <AddOrderSheet knownIsins={knownIsins} />
        </div>
      </div>

      <div className="flex justify-end gap-4">
        <PnlModeToggle value={withDividends} onChange={setWithDividends} />
        <HoldingFeesToggle value={netOfFees} onChange={setNetOfFees} />
      </div>

      <KpiStrip
        totals={totals}
        pricesUpdatedAt={pricesUpdatedAt}
        withDividends={withDividends}
        netOfFees={netOfFees}
      />

      <Tabs value={tab} onValueChange={(v) => v && setTab(v as Tab)}>
        <TabsList>
          <TabsTrigger value="positions">
            Positions
            <span className="bg-background/60 text-muted-foreground ml-1.5 rounded-full px-1.5 py-0.5 text-xs">
              {positions.length}
            </span>
          </TabsTrigger>
          <TabsTrigger value="realizations">
            Détention passée
            <span className="bg-background/60 text-muted-foreground ml-1.5 rounded-full px-1.5 py-0.5 text-xs">
              {realizations.length}
            </span>
          </TabsTrigger>
          <TabsTrigger value="orders">
            Ordres
            <span className="bg-background/60 text-muted-foreground ml-1.5 rounded-full px-1.5 py-0.5 text-xs">
              {orders.length}
            </span>
          </TabsTrigger>
        </TabsList>
        <TabsContent value="positions" className="pt-4">
          <PositionsTable
            positions={positions}
            withDividends={withDividends}
            netOfFees={netOfFees}
          />
        </TabsContent>
        <TabsContent value="realizations" className="pt-4">
          <RealizationsTable realizations={realizations} withDividends={withDividends} />
        </TabsContent>
        <TabsContent value="orders" className="pt-4">
          <OrdersTable orders={orders} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
