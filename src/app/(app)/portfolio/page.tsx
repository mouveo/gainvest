import type { Metadata } from "next";

import { PortfolioShell } from "@/features/portfolio/components/portfolio-shell";
import { getPositions } from "@/features/portfolio/queries";

export const metadata: Metadata = {
  title: "Portefeuille",
};

// Always render against the latest DB state.
export const dynamic = "force-dynamic";

export default async function PortfolioPage() {
  const { orders, positions, realizations, priceByIsin, pricesUpdatedAt } = await getPositions();

  return (
    <PortfolioShell
      positions={positions}
      orders={orders}
      realizations={realizations}
      priceByIsin={priceByIsin}
      pricesUpdatedAt={pricesUpdatedAt}
    />
  );
}
