export const EODHD_EXCHANGE_TO_MIC: Record<string, string> = {
  US: "XNAS",
  XETRA: "XETR",
  F: "XFRA",
  PA: "XPAR",
  AS: "XAMS",
  MI: "XMIL",
  BR: "XBRU",
  LS: "XLIS",
  MC: "XMAD",
  SW: "XSWX",
  LSE: "XLON",
};

// EODHD collapses NYSE and Nasdaq under the single "US" exchange code,
// so both MICs round-trip to "US".
const MIC_TO_EODHD_EXCHANGE: Record<string, string> = {
  ...Object.fromEntries(
    Object.entries(EODHD_EXCHANGE_TO_MIC).map(([code, mic]) => [mic, code]),
  ),
  XNYS: "US",
};

export function eodhdExchangeToMic(code: string): string | null {
  return EODHD_EXCHANGE_TO_MIC[code] ?? null;
}

export function micToEodhdExchange(mic: string): string | null {
  return MIC_TO_EODHD_EXCHANGE[mic] ?? null;
}

// Libellés ISO 10383 + ville, pour l'UI. Permet à l'utilisateur de
// reconnaître facilement XAMS = Amsterdam, XETR = Xetra Francfort, etc.
const MIC_LABEL: Record<string, string> = {
  XETR: "Xetra · Francfort",
  XFRA: "Bourse de Francfort",
  XPAR: "Euronext Paris",
  XAMS: "Euronext Amsterdam",
  XBRU: "Euronext Bruxelles",
  XLIS: "Euronext Lisbonne",
  XMIL: "Borsa Italiana · Milan",
  XMAD: "Bolsa de Madrid",
  XSWX: "SIX Swiss · Zurich",
  XLON: "London Stock Exchange",
  XNAS: "Nasdaq · New York",
  XNYS: "NYSE · New York",
};

export function micLabel(mic: string): string {
  return MIC_LABEL[mic] ?? mic;
}
