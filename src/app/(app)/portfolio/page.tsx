import type { Metadata } from "next";

import { computeTotals } from "@/features/portfolio/aggregate";
import { PortfolioShell } from "@/features/portfolio/components/portfolio-shell";
import { getPositions } from "@/features/portfolio/queries";

export const metadata: Metadata = {
  title: "Portefeuille",
};

// Always render against the latest DB state.
export const dynamic = "force-dynamic";

export default async function PortfolioPage() {
  const { orders, positions, pricesUpdatedAt } = await getPositions();
  const totals = computeTotals(positions);

  return (
    <PortfolioShell
      positions={positions}
      orders={orders}
      totals={totals}
      pricesUpdatedAt={pricesUpdatedAt}
    />
  );
}
