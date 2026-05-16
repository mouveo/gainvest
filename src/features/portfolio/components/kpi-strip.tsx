import { Card, CardContent } from "@/components/ui/card";

import type { MovementTotals, PortfolioTotals, RealizationTotals } from "../aggregate";
import { fmtCcy, fmtSignedCcy, fmtPct } from "../format";
import { CPI_BASE_YEAR } from "../inflation";
import { DeltaPill } from "./delta-pill";

type Props =
  | {
      view: "positions";
      totals: PortfolioTotals;
      pricesUpdatedAt: string | null;
      withDividends?: boolean;
      netOfFees?: boolean;
      inflationAdjusted?: boolean;
    }
  | {
      view: "realizations";
      totals: RealizationTotals;
      withDividends?: boolean;
      netOfFees?: boolean;
      inflationAdjusted?: boolean;
    }
  | {
      view: "movements";
      totals: MovementTotals;
    };

const REAL_BADGE = `€ réels · base ${CPI_BASE_YEAR}`;

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
  pnlSubLabel: string;
  xirrLabel: string;
  xirrSubLabel: string;
};

// Pure label builder — kept separate from the JSX so it can be unit-tested
// without rendering. Branches on `totals.kpiMode` only (never on heuristics
// like invested === valuation).
export function getPositionsKpiCopy(
  totals: PortfolioTotals,
  opts: { withDividends: boolean; netOfFees: boolean; inflationAdjusted?: boolean },
): PositionsKpiCopy {
  const real = opts.inflationAdjusted === true;
  const realSuffix = real ? ` · ${REAL_BADGE}` : "";
  if (totals.kpiMode === "cash") {
    return {
      investedLabel: "Solde cash courant",
      investedSub: `${totals.lines} ligne(s) · frais & taxes cumulés ${fmtCcy(totals.holdingFeesTotal, 0)}`,
      valuationLabel: "Valorisation EUR",
      pnlLabel: "Gain net",
      // Sur cash, le PnL = intérêts − frais − taxes (pas de notion capital/divs).
      pnlSubLabel: real ? `intérêts nets · ${REAL_BADGE}` : "intérêts nets",
      xirrLabel: "PnL annualisé",
      xirrSubLabel: real ? `Rendement annualisé cash · ${REAL_BADGE}` : "Rendement annualisé cash",
    };
  }
  const mwrBaseLabel = opts.withDividends ? "MWR · avec divs" : "MWR · capital seul";
  const mwrWithFees = opts.netOfFees ? `${mwrBaseLabel} · net frais` : mwrBaseLabel;
  const xirrSubLabel = `${mwrWithFees}${realSuffix}`;
  // Sub-label de PnL latent symétrique au MWR : révèle clairement l'état des
  // toggles pour que l'utilisateur sache si la carte affiche capital seul,
  // capital+divs, ou la variante net frais.
  const pnlBaseLabel = opts.withDividends ? "avec divs" : "capital seul";
  const pnlSubMode = opts.netOfFees ? `${pnlBaseLabel} · net frais` : pnlBaseLabel;
  const pnlSubLabel = `${pnlSubMode}${realSuffix}`;
  const investedSub =
    `${totals.lines} ligne${totals.lines > 1 ? "s" : ""} · frais cumulés ${fmtCcy(totals.totalFees, 0)}` +
    (totals.holdingFeesTotal > 0
      ? ` · dont ${fmtCcy(totals.holdingFeesTotal, 0)} de droits de garde`
      : "") +
    realSuffix;
  return {
    investedLabel: "Capital investi",
    investedSub,
    valuationLabel: "Valorisation",
    pnlLabel: "PnL latent",
    pnlSubLabel,
    xirrLabel: "PnL annualisé",
    xirrSubLabel,
  };
}

function PositionsKpis({
  totals,
  pricesUpdatedAt,
  withDividends = false,
  netOfFees = false,
  inflationAdjusted = false,
}: {
  totals: PortfolioTotals;
  pricesUpdatedAt: string | null;
  withDividends?: boolean;
  netOfFees?: boolean;
  inflationAdjusted?: boolean;
}) {
  const investedValue = inflationAdjusted ? totals.investedReal : totals.invested;
  let pnlValue: number;
  if (inflationAdjusted) {
    pnlValue = netOfFees
      ? withDividends
        ? totals.pnlTotalReal - totals.holdingFeesTotalReal
        : totals.pnlReal - totals.holdingFeesTotalReal
      : withDividends
        ? totals.pnlTotalReal
        : totals.pnlReal;
  } else {
    const basePnl = withDividends ? totals.pnlTotal : totals.pnl;
    pnlValue = basePnl - (netOfFees ? totals.holdingFeesTotal : 0);
  }
  const pnlPctValue = investedValue > 0 ? pnlValue / investedValue : 0;
  const xirrValue = netOfFees
    ? withDividends
      ? inflationAdjusted
        ? totals.xirrTotalNetFeesReal
        : totals.xirrTotalNetFees
      : inflationAdjusted
        ? totals.xirrCapitalNetFeesReal
        : totals.xirrCapitalNetFees
    : withDividends
      ? inflationAdjusted
        ? totals.xirrTotalReal
        : totals.xirrTotal
      : inflationAdjusted
        ? totals.xirrCapitalReal
        : totals.xirrCapital;
  const copy = getPositionsKpiCopy(totals, { withDividends, netOfFees, inflationAdjusted });

  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
      <Kpi label={copy.investedLabel} value={fmtCcy(investedValue, 0)} sub={copy.investedSub} />
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
            <DeltaPill value={pnlPctValue} /> {copy.pnlSubLabel}
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
  inflationAdjusted = false,
}: {
  totals: RealizationTotals;
  withDividends?: boolean;
  netOfFees?: boolean;
  inflationAdjusted?: boolean;
}) {
  const capitalRecovered = inflationAdjusted
    ? totals.capitalRecoveredReal
    : totals.capitalRecovered;
  const costBasis = inflationAdjusted ? totals.costBasisReal : totals.costBasis;
  const pnlValue = inflationAdjusted
    ? netOfFees
      ? withDividends
        ? totals.pnlTotalNetFeesReal
        : totals.pnlCapitalNetFeesReal
      : withDividends
        ? totals.pnlTotalReal
        : totals.pnlCapitalReal
    : withDividends
      ? totals.pnlTotal
      : totals.pnlCapital;
  const xirrValue = netOfFees
    ? withDividends
      ? inflationAdjusted
        ? totals.xirrTotalNetFeesReal
        : totals.xirrTotalNetFees
      : inflationAdjusted
        ? totals.xirrCapitalNetFeesReal
        : totals.xirrCapitalNetFees
    : withDividends
      ? inflationAdjusted
        ? totals.xirrTotalReal
        : totals.xirrTotal
      : inflationAdjusted
        ? totals.xirrCapitalReal
        : totals.xirrCapital;
  const xirrBaseLabel = withDividends ? "XIRR · avec divs" : "XIRR · capital seul";
  const xirrWithFees = netOfFees ? `${xirrBaseLabel} · net frais` : xirrBaseLabel;
  const xirrSubLabel = inflationAdjusted
    ? `${xirrWithFees} · ${REAL_BADGE}`
    : xirrWithFees;
  // Sub-label PnL réalisé symétrique : révèle l'état des toggles plutôt
  // que d'afficher un "total" générique trompeur.
  const pnlBaseLabel = withDividends ? "avec divs" : "capital seul";
  const pnlWithFees = netOfFees ? `${pnlBaseLabel} · net frais` : pnlBaseLabel;
  const pnlSubLabel = inflationAdjusted ? `${pnlWithFees} · ${REAL_BADGE}` : pnlWithFees;
  const countSub = inflationAdjusted
    ? `${totals.count} réalisation${totals.count > 1 ? "s" : ""} · ${REAL_BADGE}`
    : `${totals.count} réalisation${totals.count > 1 ? "s" : ""}`;
  const costBasisSub = inflationAdjusted
    ? `Base de coût cédée · ${REAL_BADGE}`
    : "Base de coût cédée";
  const pnlPct = costBasis > 0 ? pnlValue / costBasis : 0;

  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
      <Kpi
        label="Capital récupéré"
        value={fmtCcy(capitalRecovered, 0)}
        sub={countSub}
      />
      <Kpi
        label="Coût des ventes"
        value={fmtCcy(costBasis, 0)}
        sub={costBasisSub}
      />
      <Kpi
        label="PnL réalisé"
        value={fmtSignedCcy(pnlValue, 0)}
        valueClassName={
          pnlValue >= 0 ? "text-success" : pnlValue < 0 ? "text-danger" : undefined
        }
        sub={
          <span className="inline-flex items-center gap-1">
            <DeltaPill value={pnlPct} /> {pnlSubLabel}
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
