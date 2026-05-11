// Pure formatters — locale fr-FR, EUR by default. Match the design's output:
//   fmtCcy(1685000)         -> "1 685 000 €"
//   fmtPct(0.114, 1)        -> "+11,4 %"
//   fmtSignedCcy(445000)    -> "+445 000 €"
//   fmtNum(6.369, 3)        -> "6,369"
//   fmtDateFR("2022-03-15") -> "15 mars 2022"

const ccy = (dp: number) =>
  new Intl.NumberFormat("fr-FR", {
    style: "currency",
    currency: "EUR",
    minimumFractionDigits: dp,
    maximumFractionDigits: dp,
  });

export function fmtCcy(n: number, dp = 0): string {
  return ccy(dp).format(n);
}

export function fmtNum(n: number, dp = 2): string {
  return new Intl.NumberFormat("fr-FR", {
    minimumFractionDigits: dp,
    maximumFractionDigits: dp,
  }).format(n);
}

export function fmtInt(n: number): string {
  return new Intl.NumberFormat("fr-FR").format(n);
}

export function fmtPct(n: number, dp = 1): string {
  const sign = n >= 0 ? "+" : "";
  return `${sign}${new Intl.NumberFormat("fr-FR", {
    minimumFractionDigits: dp,
    maximumFractionDigits: dp,
  }).format(n * 100)} %`;
}

export function fmtSignedCcy(n: number, dp = 0): string {
  const sign = n >= 0 ? "+" : "−";
  return `${sign}${fmtCcy(Math.abs(n), dp).replace("-", "")}`;
}

export function fmtDateFR(d: string | Date): string {
  const date = typeof d === "string" ? new Date(`${d}T00:00:00`) : d;
  return date.toLocaleDateString("fr-FR", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

export function parseDate(s: string): Date {
  return new Date(`${s}T00:00:00`);
}

export function daysBetween(a: Date, b: Date): number {
  return (b.getTime() - a.getTime()) / 86_400_000;
}
