import type { Metadata } from "next";

import { getActiveAccount } from "@/features/accounts/active";
import { listAccounts } from "@/features/accounts/queries";
import { PortfolioShell } from "@/features/portfolio/components/portfolio-shell";
import { getPositions } from "@/features/portfolio/queries";

export const metadata: Metadata = {
  title: "Portefeuille",
};

// Always render against the latest DB state.
export const dynamic = "force-dynamic";

export default async function PortfolioPage() {
  const [accounts, activeAccount] = await Promise.all([
    listAccounts(),
    getActiveAccount(),
  ]);
  const { orders, positions, realizations, priceByIsin, pricesUpdatedAt } =
    await getPositions(activeAccount);

  return (
    <PortfolioShell
      positions={positions}
      orders={orders}
      realizations={realizations}
      priceByIsin={priceByIsin}
      pricesUpdatedAt={pricesUpdatedAt}
      accounts={accounts}
      activeAccount={activeAccount}
    />
  );
}
