import { Card, CardContent } from "@/components/ui/card";

import type { MovementTotals, PortfolioTotals, RealizationTotals } from "../aggregate";
import { fmtCcy, fmtSignedCcy, fmtPct } from "../format";
import { DeltaPill } from "./delta-pill";

type Props =
  | {
      view: "positions";
      totals: PortfolioTotals;
      pricesUpdatedAt: string | null;
      withDividends?: boolean;
      netOfFees?: boolean;
    }
  | {
      view: "realizations";
      totals: RealizationTotals;
      withDividends?: boolean;
      netOfFees?: boolean;
    }
  | {
      view: "movements";
      totals: MovementTotals;
    };

export function KpiStrip(props: Props) {
  if (props.view === "positions") {
    return <PositionsKpis {...props} />;
  }
  if (props.view === "realizations") {
    return <RealizationsKpis {...props} />;
  }
  return <MovementsKpis {...props} />;
}

export type PositionsKpiCopy = {
  investedLabel: string;
  investedSub: string;
  valuationLabel: string;
  pnlLabel: string;
  xirrLabel: string;
  xirrSubLabel: string;
};

// Pure label builder — kept separate from the JSX so it can be unit-tested
// without rendering. Branches on `totals.kpiMode` only (never on heuristics
// like invested === valuation).
export function getPositionsKpiCopy(
  totals: PortfolioTotals,
  opts: { withDividends: boolean; netOfFees: boolean },
): PositionsKpiCopy {
  if (totals.kpiMode === "cash") {
    return {
      investedLabel: "Solde cash courant",
      investedSub: `${totals.lines} ligne(s) · frais & taxes cumulés ${fmtCcy(totals.holdingFeesTotal, 0)}`,
      valuationLabel: "Valorisation EUR",
      pnlLabel: "Gain net",
      xirrLabel: "PnL annualisé",
      xirrSubLabel: "Rendement annualisé cash",
    };
  }
  const mwrBaseLabel = opts.withDividends ? "MWR · avec divs" : "MWR · capital seul";
  const xirrSubLabel = opts.netOfFees ? `${mwrBaseLabel} · net frais` : mwrBaseLabel;
  const investedSub =
    `${totals.lines} ligne${totals.lines > 1 ? "s" : ""} · frais cumulés ${fmtCcy(totals.totalFees, 0)}` +
    (totals.holdingFeesTotal > 0
      ? ` · dont ${fmtCcy(totals.holdingFeesTotal, 0)} de droits de garde`
      : "");
  return {
    investedLabel: "Capital investi",
    investedSub,
    valuationLabel: "Valorisation",
    pnlLabel: "PnL latent",
    xirrLabel: "PnL annualisé",
    xirrSubLabel,
  };
}

function PositionsKpis({
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
  const copy = getPositionsKpiCopy(totals, { withDividends, netOfFees });

  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
      <Kpi label={copy.investedLabel} value={fmtCcy(totals.invested, 0)} sub={copy.investedSub} />
      <Kpi
        label={copy.valuationLabel}
        value={fmtCcy(totals.valuation, 0)}
        sub={
          pricesUpdatedAt ? `MAJ ${fmtRelativeMinutes(pricesUpdatedAt)}` : "Cours non rafraîchis"
        }
      />
      <Kpi
        label={copy.pnlLabel}
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
        label={copy.xirrLabel}
        value={Number.isFinite(xirrValue) ? fmtPct(xirrValue, 1) : "—"}
        valueClassName={
          !Number.isFinite(xirrValue)
            ? "text-muted-foreground"
            : xirrValue >= 0
              ? "text-success"
              : "text-danger"
        }
        sub={copy.xirrSubLabel}
      />
    </div>
  );
}

function RealizationsKpis({
  totals,
  withDividends = false,
  netOfFees = false,
}: {
  totals: RealizationTotals;
  withDividends?: boolean;
  netOfFees?: boolean;
}) {
  const pnlValue = withDividends ? totals.pnlTotal : totals.pnlCapital;
  const xirrValue = netOfFees
    ? withDividends
      ? totals.xirrTotalNetFees
      : totals.xirrCapitalNetFees
    : withDividends
      ? totals.xirrTotal
      : totals.xirrCapital;
  const xirrBaseLabel = withDividends ? "XIRR · avec divs" : "XIRR · capital seul";
  const xirrSubLabel = netOfFees ? `${xirrBaseLabel} · net frais` : xirrBaseLabel;
  const countSub = `${totals.count} réalisation${totals.count > 1 ? "s" : ""}`;
  const pnlPct = totals.costBasis > 0 ? pnlValue / totals.costBasis : 0;

  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
      <Kpi
        label="Capital récupéré"
        value={fmtCcy(totals.capitalRecovered, 0)}
        sub={countSub}
      />
      <Kpi
        label="Coût des ventes"
        value={fmtCcy(totals.costBasis, 0)}
        sub="Base de coût cédée"
      />
      <Kpi
        label="PnL réalisé"
        value={fmtSignedCcy(pnlValue, 0)}
        valueClassName={
          pnlValue >= 0 ? "text-success" : pnlValue < 0 ? "text-danger" : undefined
        }
        sub={
          <span className="inline-flex items-center gap-1">
            <DeltaPill value={pnlPct} /> total
          </span>
        }
      />
      <Kpi
        label="XIRR réalisé"
        value={Number.isFinite(xirrValue) ? fmtPct(xirrValue, 1) : "—"}
        valueClassName={
          !Number.isFinite(xirrValue)
            ? "text-muted-foreground"
            : xirrValue >= 0
              ? "text-success"
              : "text-danger"
        }
        sub={xirrSubLabel}
      />
    </div>
  );
}

function MovementsKpis({ totals }: { totals: MovementTotals }) {
  const countSub = `${totals.count} mouvement${totals.count > 1 ? "s" : ""}`;

  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
      <Kpi label="Total achats" value={fmtCcy(totals.totalBuys, 0)} sub={countSub} />
      <Kpi label="Total ventes" value={fmtCcy(totals.totalSells, 0)} sub="Brut hors frais" />
      <Kpi
        label="Dividendes encaissés"
        value={fmtCcy(totals.dividendsReceived, 0)}
        sub="Brut avant fiscalité"
      />
      <Kpi label="Frais payés" value={fmtCcy(totals.feesPaid, 0)} sub="Commissions + droits de garde" />
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
