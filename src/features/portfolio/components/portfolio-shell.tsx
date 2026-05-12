"use client";

import { useEffect, useMemo, useState } from "react";

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

import {
  computeMovementTotals,
  computeRealizationTotals,
  computeTotals,
  type CurrentPrice,
  type OrderRow,
  type Position,
} from "../aggregate";
import type { PastRealization } from "../realize";
import { AddOrderSheet } from "./add-order-sheet";
import { AutoRefreshPrices } from "./auto-refresh-prices";
import { HoldingFeesToggle, useNetOfFeesMode } from "./holding-fees-toggle";
import { ImportSheet } from "./import-sheet";
import { KpiStrip } from "./kpi-strip";
import { MovementsTable } from "./movements-table";
import { PnlModeToggle, usePnlMode } from "./pnl-mode-toggle";
import { PositionsTable } from "./positions-table";
import { RealizationsTable } from "./realizations-table";
import { RefreshPricesButton } from "./refresh-prices-button";

type Tab = "positions" | "realizations" | "movements";

type Props = {
  positions: Position[];
  orders: OrderRow[];
  realizations: PastRealization[];
  priceByIsin: Record<string, CurrentPrice>;
  pricesUpdatedAt: string | null;
};

export function PortfolioShell({
  positions,
  orders,
  realizations,
  priceByIsin,
  pricesUpdatedAt,
}: Props) {
  const [tab, setTab] = useState<Tab>("positions");
  const [withDividends, setWithDividends] = usePnlMode();
  const [netOfFees, setNetOfFees] = useNetOfFeesMode();
  // Cash positions carry synthetic CASH-* pseudo-ISINs — they have no place
  // in the order autocomplete (you don't "buy" cash from the order sheet).
  // Positions sont émises par (isin, support, broker) depuis Plan L, donc un
  // même ISIN détenu chez 2 brokers apparaît 2 fois ici. On déduplique par
  // ISIN pour ne pas casser les keys React de l'autocomplete.
  const knownIsins = useMemo(() => {
    const seen = new Map<string, { isin: string; name: string }>();
    for (const p of positions) {
      if (p.assetClass === "cash") continue;
      if (!seen.has(p.isin)) seen.set(p.isin, { isin: p.isin, name: p.instrumentName });
    }
    return Array.from(seen.values());
  }, [positions]);

  const [visiblePositions, setVisiblePositions] = useState(positions);
  const [visibleRealizations, setVisibleRealizations] = useState(realizations);
  const [visibleOrders, setVisibleOrders] = useState(orders);

  useEffect(() => setVisiblePositions(positions), [positions]);
  useEffect(() => setVisibleRealizations(realizations), [realizations]);
  useEffect(() => setVisibleOrders(orders), [orders]);

  const visiblePositionTotals = useMemo(
    () => computeTotals(visiblePositions),
    [visiblePositions],
  );

  const visibleRealizationTotals = useMemo(
    () => computeRealizationTotals(visibleRealizations),
    [visibleRealizations],
  );

  const visibleMovementTotals = useMemo(
    () => computeMovementTotals(visibleOrders),
    [visibleOrders],
  );

  return (
    <div className="flex flex-col gap-6">
      <AutoRefreshPrices pricesUpdatedAt={pricesUpdatedAt} />
      <div className="flex items-start justify-between gap-4">
        <div className="flex flex-col gap-1">
          <h1 className="text-2xl font-semibold tracking-tight">Portefeuille</h1>
          <p className="text-muted-foreground text-sm">
            Une vue agrégée par instrument et le journal complet des mouvements.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <RefreshPricesButton />
          <ImportSheet />
          <AddOrderSheet knownIsins={knownIsins} />
        </div>
      </div>

      <Tabs value={tab} onValueChange={(v) => v && setTab(v as Tab)} className="gap-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
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
            <TabsTrigger value="movements">
              Mouvements
              <span className="bg-background/60 text-muted-foreground ml-1.5 rounded-full px-1.5 py-0.5 text-xs">
                {orders.length}
              </span>
            </TabsTrigger>
          </TabsList>

          <div className="flex items-center gap-4">
            <PnlModeToggle value={withDividends} onChange={setWithDividends} />
            <HoldingFeesToggle value={netOfFees} onChange={setNetOfFees} />
          </div>
        </div>

        {tab === "positions" && (
          <KpiStrip
            view="positions"
            totals={visiblePositionTotals}
            pricesUpdatedAt={pricesUpdatedAt}
            withDividends={withDividends}
            netOfFees={netOfFees}
          />
        )}

        {tab === "realizations" && (
          <KpiStrip
            view="realizations"
            totals={visibleRealizationTotals}
            withDividends={withDividends}
            netOfFees={netOfFees}
          />
        )}

        {tab === "movements" && (
          <KpiStrip view="movements" totals={visibleMovementTotals} />
        )}

        <TabsContent value="positions">
          <PositionsTable
            positions={positions}
            withDividends={withDividends}
            netOfFees={netOfFees}
            onVisibleRowsChange={setVisiblePositions}
          />
        </TabsContent>
        <TabsContent value="realizations">
          <RealizationsTable
            realizations={realizations}
            withDividends={withDividends}
            netOfFees={netOfFees}
            priceByIsin={priceByIsin}
            onVisibleRowsChange={setVisibleRealizations}
          />
        </TabsContent>
        <TabsContent value="movements">
          <MovementsTable orders={orders} onVisibleRowsChange={setVisibleOrders} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
