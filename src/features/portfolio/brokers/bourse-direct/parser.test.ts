import { describe, expect, it } from "vitest";

import { inferBourseDirectMarket, parseBourseDirectCsv, splitCsvLine } from "./parser";

const HEADER = "Date,Quoi,ISIN,Description,Quantite, Montant";
const HEADER_V2 = "Date,Quoi,ISIN,Description,Quantité, Montant, Commission";

function csv(...rows: string[]): string {
  return [HEADER, ...rows].join("\n");
}

function csvV2(...rows: string[]): string {
  return [HEADER_V2, ...rows].join("\n");
}

describe("splitCsvLine", () => {
  it("keeps quoted commas inside a field", () => {
    expect(splitCsvLine('a,b,c,"  50 892,24 € "')).toEqual(["a", "b", "c", "  50 892,24 € "]);
  });
});

describe("inferBourseDirectMarket", () => {
  it("infers US for US ISIN", () => {
    expect(inferBourseDirectMarket("US0231351067")).toBe("us");
  });
  it("infers euronext for FR / NL / BE", () => {
    expect(inferBourseDirectMarket("FR0000000001")).toBe("euronext");
    expect(inferBourseDirectMarket("NL0011794037")).toBe("euronext");
  });
  it("infers other for unknown prefix", () => {
    expect(inferBourseDirectMarket("XY1234567890")).toBe("other");
  });
});

describe("parseBourseDirectCsv", () => {
  it("parses an Amazon buy and computes US fees from resolved gross", () => {
    const text = csv('7/9/2022,Achat,US0231351067,AMAZON COM (+400 A CONF),400,"  50 892,24 € "');
    const { rows } = parseBourseDirectCsv(text, { support: "CTO" });
    expect(rows).toHaveLength(1);
    const r = rows[0]!;
    expect(r.kind).toBe("buy");
    expect(r.date).toBe("2022-09-07");
    expect(r.isin).toBe("US0231351067");
    expect(r.quantity).toBe(400);
    expect(r.needsAttention).toBe(false);
    expect(r.inferredMarket).toBe("us");
    // total est > 10000 → gross > 10000 → brackets % active, ~45,76 €
    expect(r.computedFees!.brokerage).toBeGreaterThan(45.7);
    expect(r.computedFees!.brokerage).toBeLessThan(45.8);
    expect(r.grossAmount!).toBeGreaterThan(50845);
    expect(r.grossAmount!).toBeLessThan(50847);
  });

  it("treats Coupons as dividend with quantity null and gross = total", () => {
    const text = csv('12/12/2022,Coupons,FR0007052782,LY.CAC40 UC.ETF D.,,"  589,00 € "');
    const { rows } = parseBourseDirectCsv(text, { support: "CTO" });
    expect(rows).toHaveLength(1);
    const r = rows[0]!;
    expect(r.kind).toBe("dividend");
    expect(r.quantity).toBeNull();
    expect(r.grossAmount).toBe(589);
    expect(r.computedFees).toBeUndefined();
    expect(r.needsAttention).toBe(false);
  });

  it("treats Frais without ISIN as fee with quantity null", () => {
    const text = csv('5/10/2022,Frais,,Droits de garde 2022 T3,,"  4,03 € "');
    const { rows } = parseBourseDirectCsv(text, { support: "CTO" });
    expect(rows).toHaveLength(1);
    const r = rows[0]!;
    expect(r.kind).toBe("fee");
    expect(r.isin).toBeNull();
    expect(r.quantity).toBeNull();
    expect(r.grossAmount).toBe(4.03);
    expect(r.needsAttention).toBe(false);
  });

  it("extracts Tesla quantity from description when column is empty", () => {
    const text = csv('12/11/2024,Vente,US88160R1014,TESLA (-300),,"  92 651,03 € "');
    const { rows } = parseBourseDirectCsv(text, { support: "CTO" });
    expect(rows).toHaveLength(1);
    const r = rows[0]!;
    expect(r.kind).toBe("sell");
    expect(r.quantity).toBe(300);
    expect(r.needsAttention).toBe(false);
  });

  it("marks needsAttention when quantity is missing everywhere", () => {
    const text = csv('7/9/2022,Achat,US0231351067,AMAZON COM no qty info,,"  50 892,24 € "');
    const { rows } = parseBourseDirectCsv(text, { support: "CTO" });
    expect(rows).toHaveLength(1);
    const r = rows[0]!;
    expect(r.needsAttention).toBe(true);
    expect(r.attentionReason).toMatch(/Quantité/);
  });

  it("handles a description containing a non-quoted comma", () => {
    const text = csv(
      '12/12/2022,Coupons,FR0007052782,LY.CAC40 UC.ETF D., Distribution,,"  589,00 € "',
    );
    const { rows } = parseBourseDirectCsv(text, { support: "CTO" });
    expect(rows).toHaveLength(1);
    const r = rows[0]!;
    expect(r.kind).toBe("dividend");
    expect(r.description).toBe("LY.CAC40 UC.ETF D., Distribution");
    expect(r.grossAmount).toBe(589);
  });

  it("handles CRLF line endings", () => {
    const text = HEADER + "\r\n" + '5/10/2022,Frais,,Droits de garde 2022 T3,,"  4,03 € "' + "\r\n";
    const { rows } = parseBourseDirectCsv(text, { support: "CTO" });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.kind).toBe("fee");
  });

  it("skips empty lines", () => {
    const text = csv("", '5/10/2022,Frais,,Droits de garde 2022 T3,,"  4,03 € "', "");
    const { rows } = parseBourseDirectCsv(text, { support: "CTO" });
    expect(rows).toHaveLength(1);
  });

  it("flags rows with unknown Quoi values", () => {
    const text = csv('5/10/2022,Bizarre,,Unknown,,"  4,03 € "');
    const { rows } = parseBourseDirectCsv(text, { support: "CTO" });
    expect(rows[0]!.needsAttention).toBe(true);
    expect(rows[0]!.attentionReason).toMatch(/inconnu/);
  });

  it("reads Commission column directly when header v2 is used (Quantité accent)", () => {
    const text = csvV2(
      '14/2/2022,Achat,FR0007052782,CPT LY.CAC40 UC.ETF D.,300,"  20 217,18 € ","  18,18 € "',
    );
    const { rows, warnings } = parseBourseDirectCsv(text, { support: "CTO" });
    expect(warnings).toEqual([]);
    expect(rows).toHaveLength(1);
    const r = rows[0]!;
    expect(r.kind).toBe("buy");
    expect(r.quantity).toBe(300);
    expect(r.computedFees!.brokerage).toBeCloseTo(18.18, 2);
    expect(r.grossAmount).toBeCloseTo(20199, 0);
  });

  it("handles signed quantity via Math.abs (e.g. -100 → 100)", () => {
    const text = csvV2(
      '3/2/2022,Achat,FR0010655712,AMUNDI ETF DAX UCITS ETF DR,-100,"  28 225,38 € ","  25,38 € "',
    );
    const { rows } = parseBourseDirectCsv(text, { support: "CTO" });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.quantity).toBe(100);
  });

  it("marks Liquidation as a sell with inferQtyFromHoldings flag", () => {
    const text = csvV2(
      '9/9/2024,Liquidation,FR0011041334,AMD.CAC M.60 UC.D,,"  19 378,93 € ",',
    );
    const { rows } = parseBourseDirectCsv(text, { support: "CTO" });
    expect(rows).toHaveLength(1);
    const r = rows[0]!;
    expect(r.kind).toBe("sell");
    expect(r.quantity).toBeNull();
    expect(r.inferQtyFromHoldings).toBe(true);
    expect(r.notes).toBe("Liquidation");
    expect(r.computedFees!.brokerage).toBe(0);
    expect(r.computedFees!.ttf).toBe(0);
  });

  it("skips orphan Coupons rows (?? description) and aggregates a warning", () => {
    const text = csvV2(
      '22/2/2023,Coupons,,??,,"  292,56 € ",',
      '13/3/2023,Coupons,,??,,"  137,02 € ",',
      '15/11/2022,Coupons,US0378331005,APPLE,,"  78,62 € ",',
    );
    const { rows, warnings } = parseBourseDirectCsv(text, { support: "CTO" });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.isin).toBe("US0378331005");
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatch(/2 coupons ignorés/);
  });
});
