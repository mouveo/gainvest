import { Card, CardContent } from "@/components/ui/card";

import type { PortfolioTotals } from "../aggregate";
import { fmtCcy, fmtSignedCcy, fmtPct } from "../format";
import { DeltaPill } from "./delta-pill";

export function KpiStrip({
  totals,
  pricesUpdatedAt,
  withDividends = false,
  netOfFees = false,
}: {
  totals: PortfolioTotals;
  pricesUpdatedAt: string | null;
  withDividends?: boolean;
  netOfFees?: boolean;
}) {
  const basePnl = withDividends ? totals.pnlTotal : totals.pnl;
  const pnlValue = basePnl - (netOfFees ? totals.holdingFeesTotal : 0);
  const pnlPctValue = totals.invested > 0 ? pnlValue / totals.invested : 0;
  const xirrValue = netOfFees
    ? withDividends
      ? totals.xirrTotalNetFees
      : totals.xirrCapitalNetFees
    : withDividends
      ? totals.xirrTotal
      : totals.xirrCapital;
  const mwrBaseLabel = withDividends ? "MWR · avec divs" : "MWR · capital seul";
  const mwrSubLabel = netOfFees ? `${mwrBaseLabel} · net frais` : mwrBaseLabel;
  const investedSub =
    `${totals.lines} ligne${totals.lines > 1 ? "s" : ""} · frais cumulés ${fmtCcy(totals.totalFees, 0)}` +
    (totals.holdingFeesTotal > 0
      ? ` · dont ${fmtCcy(totals.holdingFeesTotal, 0)} de droits de garde`
      : "");

  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
      <Kpi label="Capital investi" value={fmtCcy(totals.invested, 0)} sub={investedSub} />
      <Kpi
        label="Valorisation"
        value={fmtCcy(totals.valuation, 0)}
        sub={
          pricesUpdatedAt ? `MAJ ${fmtRelativeMinutes(pricesUpdatedAt)}` : "Cours non rafraîchis"
        }
      />
      <Kpi
        label="PnL latent"
        value={fmtSignedCcy(pnlValue, 0)}
        valueClassName={
          pnlValue >= 0 ? "text-success" : pnlValue < 0 ? "text-danger" : undefined
        }
        sub={
          <span className="inline-flex items-center gap-1">
            <DeltaPill value={pnlPctValue} /> total
          </span>
        }
      />
      <Kpi
        label="PnL annualisé"
        value={Number.isFinite(xirrValue) ? fmtPct(xirrValue, 1) : "—"}
        valueClassName={
          !Number.isFinite(xirrValue)
            ? "text-muted-foreground"
            : xirrValue >= 0
              ? "text-success"
              : "text-danger"
        }
        sub={mwrSubLabel}
      />
    </div>
  );
}

function fmtRelativeMinutes(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const minutes = Math.round(diff / 60_000);

  if (minutes < 1) return "à l'instant";
  if (minutes < 60) return `il y a ${minutes} min`;

  const hours = Math.round(minutes / 60);
  if (hours < 24) return `il y a ${hours} h`;

  const days = Math.round(hours / 24);
  return `il y a ${days} j`;
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
