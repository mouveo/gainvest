"use client";

import { useState } from "react";

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

import type { OrderRow, PortfolioTotals, Position } from "../aggregate";
import { AddOrderSheet } from "./add-order-sheet";
import { AutoRefreshPrices } from "./auto-refresh-prices";
import { KpiStrip } from "./kpi-strip";
import { OrdersTable } from "./orders-table";
import { PositionsTable } from "./positions-table";
import { RefreshPricesButton } from "./refresh-prices-button";

type Props = {
  positions: Position[];
  orders: OrderRow[];
  totals: PortfolioTotals;
  pricesUpdatedAt: string | null;
};

export function PortfolioShell({ positions, orders, totals, pricesUpdatedAt }: Props) {
  const [tab, setTab] = useState<"positions" | "orders">("positions");
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
          <AddOrderSheet knownIsins={knownIsins} />
        </div>
      </div>

      <KpiStrip totals={totals} pricesUpdatedAt={pricesUpdatedAt} />

      <Tabs value={tab} onValueChange={(v) => v && setTab(v as "positions" | "orders")}>
        <TabsList>
          <TabsTrigger value="positions">
            Positions
            <span className="bg-background/60 text-muted-foreground ml-1.5 rounded-full px-1.5 py-0.5 text-xs">
              {positions.length}
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
          <PositionsTable positions={positions} />
        </TabsContent>
        <TabsContent value="orders" className="pt-4">
          <OrdersTable orders={orders} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
