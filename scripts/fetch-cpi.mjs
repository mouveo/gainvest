#!/usr/bin/env node
// Refreshes src/data/cpi-france.json from the official INSEE CPI dataset
// published on data.gouv.fr.
//
// Series: CPI / IND_TYPE=IX / COICOP_2018=00 (Ensemble) / GEO=F (France) /
// TPH_CPI=_T (Total = Ensemble des ménages) / FREQ=M. Tabac inclus.
// Base 2025=100 since the publication of the IPC for January 2026.
//
// Coverage strategy:
//   - "Principal" dataset (base 2025) — canonical INSEE series from 1996-01.
//   - "Base 2015" legacy dataset (also INSEE / data.gouv.fr) — used to
//     extend coverage back to 1990-01 by rescaling on the first overlapping
//     month. Both series are official INSEE; only the index base differs.

import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const OUT_FILE = join(ROOT, "src/data/cpi-france.json");

const PRINCIPAL_URL =
  "https://www.data.gouv.fr/api/1/datasets/r/5961e778-380b-4098-9b7e-33697b44b3c6";
const LEGACY_URL =
  "https://www.data.gouv.fr/api/1/datasets/r/f1f82e0e-4665-4909-ad66-0897a5972a77";

const SERIES_LABEL =
  "IPC, ensemble des ménages, France, ensemble (tabac inclus), mensuel";
const SERIES_ID =
  "INSEE/DS_IPC_PRINC/CPI.IX.COICOP_2018=00.GEO=F.TPH_CPI=_T.FREQ=M";
const BASE_YEAR = 2025;
const FIRST_MONTH = "1990-01";

async function downloadToFile(url, outPath) {
  const res = await fetch(url, { redirect: "follow" });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  const buf = Buffer.from(await res.arrayBuffer());
  writeFileSync(outPath, buf);
}

function parseCsv(text, delim) {
  const rows = [];
  let row = [];
  let field = "";
  let inQuote = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuote) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else inQuote = false;
      } else field += c;
    } else if (c === '"') inQuote = true;
    else if (c === delim) {
      row.push(field);
      field = "";
    } else if (c === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else if (c !== "\r") field += c;
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

function parsePrincipalCsv(text) {
  const rows = parseCsv(text, ";");
  const header = rows[0];
  const col = (name) => header.indexOf(name);
  const idxType = col("IDX_TYPE");
  const indType = col("IND_TYPE");
  const coicop = col("COICOP_2018");
  const geo = col("GEO");
  const tph = col("TPH_CPI");
  const freq = col("FREQ");
  const period = col("TIME_PERIOD");
  const value = col("OBS_VALUE");
  const out = {};
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    if (!r || r.length <= value) continue;
    if (
      r[idxType] !== "CPI" ||
      r[indType] !== "IX" ||
      r[coicop] !== "00" ||
      r[geo] !== "F" ||
      r[tph] !== "_T" ||
      r[freq] !== "M"
    )
      continue;
    if (!/^\d{4}-\d{2}$/.test(r[period])) continue;
    const v = Number(r[value]);
    if (!Number.isFinite(v)) continue;
    out[r[period]] = v;
  }
  return out;
}

function parseLegacyCsv(text) {
  const rows = parseCsv(text, ",");
  const out = {};
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    if (!r || r.length < 3) continue;
    const p = r[0];
    if (!/^\d{4}-\d{2}$/.test(p)) continue;
    const v = Number(r[2]);
    if (!Number.isFinite(v)) continue;
    out[p] = v;
  }
  return out;
}

function functionallyEqual(a, b) {
  const omit = ({ fetched_at, ...rest }) => rest;
  return JSON.stringify(omit(a)) === JSON.stringify(omit(b));
}

async function main() {
  const tmp = mkdtempSync(join(tmpdir(), "cpi-"));
  try {
    const zipPath = join(tmp, "principal.zip");
    await downloadToFile(PRINCIPAL_URL, zipPath);
    execFileSync("unzip", ["-o", zipPath, "-d", tmp], { stdio: "ignore" });
    const principalCsv = readFileSync(
      join(tmp, "DS_IPC_PRINC_data.csv"),
      "utf8",
    );
    const principal = parsePrincipalCsv(principalCsv);

    const legacyPath = join(tmp, "legacy.csv");
    await downloadToFile(LEGACY_URL, legacyPath);
    const legacy = parseLegacyCsv(readFileSync(legacyPath, "utf8"));

    const principalKeys = Object.keys(principal).sort();
    const anchor = principalKeys[0];
    if (!anchor || !legacy[anchor]) {
      throw new Error(
        `Cannot splice legacy to principal: missing overlap month ${anchor}`,
      );
    }
    const coefficient = principal[anchor] / legacy[anchor];

    const merged = {};
    for (const [k, v] of Object.entries(legacy)) {
      if (k < anchor && k >= FIRST_MONTH) {
        merged[k] = Math.round(v * coefficient * 1e4) / 1e4;
      }
    }
    for (const [k, v] of Object.entries(principal)) {
      merged[k] = v;
    }

    const ordered = {};
    const keys = Object.keys(merged).sort();
    for (const k of keys) ordered[k] = merged[k];

    const payload = {
      source: "https://www.data.gouv.fr/datasets/indice-des-prix-a-la-consommation-jeu-de-donnees-principal",
      producer: "INSEE",
      base_year: BASE_YEAR,
      fetched_at: new Date().toISOString().slice(0, 10),
      series_id: SERIES_ID,
      series_label: SERIES_LABEL,
      notes:
        "Valeurs 1996-01 → présent issues du dataset principal (base 2025=100). Valeurs 1990-01 → 1995-12 reconstituées depuis le dataset INSEE 'Base 2015' (data.gouv resource f1f82e0e-…), rebasées sur le mois d'ancrage indiqué.",
      splice: {
        legacy_resource: LEGACY_URL,
        anchor_month: anchor,
        coefficient,
      },
      values: ordered,
    };

    if (existsSync(OUT_FILE)) {
      try {
        const existing = JSON.parse(readFileSync(OUT_FILE, "utf8"));
        if (functionallyEqual(existing, payload)) {
          console.log("CPI dataset unchanged — no write.");
          return;
        }
      } catch {
        // fall through and rewrite
      }
    }

    mkdirSync(dirname(OUT_FILE), { recursive: true });
    writeFileSync(OUT_FILE, JSON.stringify(payload, null, 2) + "\n");
    console.log(
      `Wrote ${keys.length} monthly points (${keys[0]} → ${keys[keys.length - 1]}) to ${OUT_FILE}`,
    );
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
