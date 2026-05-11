import { Card, CardContent } from "@/components/ui/card";

import type { PortfolioTotals } from "../aggregate";
import { fmtCcy, fmtSignedCcy, fmtPct } from "../format";
import { DeltaPill } from "./delta-pill";

export function KpiStrip({ totals }: { totals: PortfolioTotals }) {
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
      <Kpi
        label="Capital investi"
        value={fmtCcy(totals.invested, 0)}
        sub={`${totals.lines} ligne${totals.lines > 1 ? "s" : ""} · frais cumulés ${fmtCcy(totals.totalFees, 0)}`}
      />
      <Kpi label="Valorisation" value={fmtCcy(totals.valuation, 0)} sub="au jour J" />
      <Kpi
        label="PnL latent"
        value={fmtSignedCcy(totals.pnl, 0)}
        valueClassName={
          totals.pnl >= 0 ? "text-success" : totals.pnl < 0 ? "text-danger" : undefined
        }
        sub={
          <span className="inline-flex items-center gap-1">
            <DeltaPill value={totals.pnlPct} /> total
          </span>
        }
      />
      <Kpi
        label="PnL annualisé"
        value={fmtPct(totals.pnlAnnualized, 1)}
        valueClassName={
          totals.pnlAnnualized >= 0
            ? "text-success"
            : totals.pnlAnnualized < 0
              ? "text-danger"
              : undefined
        }
        sub={`durée moyenne ${totals.yearsHeld.toFixed(1)} a`}
      />
    </div>
  );
}

function Kpi({
  label,
  value,
  sub,
  valueClassName,
}: {
  label: string;
  value: string;
  sub: React.ReactNode;
  valueClassName?: string;
}) {
  return (
    <Card>
      <CardContent className="flex flex-col gap-2">
        <span className="text-muted-foreground text-[11px] font-medium tracking-wider uppercase">
          {label}
        </span>
        <span className={`font-mono text-2xl font-semibold tabular-nums ${valueClassName ?? ""}`}>
          {value}
        </span>
        <span className="text-muted-foreground text-xs">{sub}</span>
      </CardContent>
    </Card>
  );
}
