import { describe, expect, it } from "vitest";

import { EODHD_EXCHANGE_TO_MIC, eodhdExchangeToMic, micToEodhdExchange } from "./mic";

describe("eodhdExchangeToMic / micToEodhdExchange", () => {
  it("round-trips every supported EODHD exchange code", () => {
    for (const [code, mic] of Object.entries(EODHD_EXCHANGE_TO_MIC)) {
      expect(eodhdExchangeToMic(code)).toBe(mic);
      expect(micToEodhdExchange(mic)).toBe(code);
    }
  });

  it("returns null for an unknown EODHD exchange code", () => {
    expect(eodhdExchangeToMic("UNKNOWN")).toBeNull();
  });

  it("maps XNAS to the US exchange", () => {
    expect(micToEodhdExchange("XNAS")).toBe("US");
  });

  it("maps XNYS to the US exchange (EODHD does not distinguish)", () => {
    expect(micToEodhdExchange("XNYS")).toBe("US");
  });

  it("returns null for an unknown MIC", () => {
    expect(micToEodhdExchange("XXXX")).toBeNull();
  });
});
