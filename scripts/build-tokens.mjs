#!/usr/bin/env node
// Builds DTCG token JSON files into a single CSS file with variables for :root (light)
// and `.dark` / `prefers-color-scheme: dark` (dark theme).
//
// Naming: each leaf becomes `--{group}-{path-segments}` in kebab-case.
//   color.neutral.50         -> --color-neutral-50
//   color.semantic.primary   -> --color-semantic-primary
//   radius.md                -> --radius-md
//   radius.semantic.md       -> --radius-semantic-md
//
// References like "{color.neutral.50}" inside values are resolved against the
// primitive tree at build time.

import { readFile, writeFile, readdir } from "node:fs/promises";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const TOKENS_DIR = join(ROOT, "tokens");
const OUT = join(ROOT, "src/styles/tokens.generated.css");

const REF = /^\{([^}]+)\}$/;

function isTokenLeaf(node) {
  return node && typeof node === "object" && "$value" in node;
}

function flatten(tree, prefix = []) {
  const out = [];
  for (const [key, value] of Object.entries(tree)) {
    if (key.startsWith("$")) continue;
    const path = [...prefix, key];
    if (isTokenLeaf(value)) {
      out.push({ path, value: value.$value, type: value.$type });
    } else if (value && typeof value === "object") {
      out.push(...flatten(value, path));
    }
  }
  return out;
}

function getByPath(tree, dotted) {
  const parts = dotted.split(".");
  let cur = tree;
  for (const p of parts) {
    if (cur == null) return undefined;
    cur = cur[p];
  }
  return isTokenLeaf(cur) ? cur.$value : cur;
}

function resolveValue(value, primitives, visited = new Set()) {
  if (typeof value !== "string") return value;
  const m = value.match(REF);
  if (!m) return value;
  const ref = m[1];
  if (visited.has(ref)) {
    throw new Error(`Circular token reference at ${ref}`);
  }
  const next = getByPath(primitives, ref);
  if (next === undefined) {
    throw new Error(`Unknown token reference: {${ref}}`);
  }
  return resolveValue(next, primitives, new Set([...visited, ref]));
}

function toCssVarName(path) {
  return `--${path.join("-")}`;
}

function renderBlock(entries, primitives) {
  return entries
    .map(({ path, value }) => {
      const resolved = resolveValue(value, primitives);
      return `  ${toCssVarName(path)}: ${resolved};`;
    })
    .join("\n");
}

async function loadJson(file) {
  const txt = await readFile(file, "utf8");
  return JSON.parse(txt);
}

async function main() {
  const files = (await readdir(TOKENS_DIR)).filter((f) => f.endsWith(".tokens.json"));
  if (files.length === 0) {
    throw new Error(`No token files found in ${TOKENS_DIR}`);
  }

  const primitiveFile = files.find((f) => f.startsWith("primitive."));
  if (!primitiveFile) throw new Error("Missing tokens/primitive.tokens.json");
  const primitives = await loadJson(join(TOKENS_DIR, primitiveFile));
  const primitiveEntries = flatten(primitives);

  const lightFile = files.find((f) => f.startsWith("semantic.light."));
  const darkFile = files.find((f) => f.startsWith("semantic.dark."));
  if (!lightFile) throw new Error("Missing tokens/semantic.light.tokens.json");
  if (!darkFile) throw new Error("Missing tokens/semantic.dark.tokens.json");

  const light = await loadJson(join(TOKENS_DIR, lightFile));
  const dark = await loadJson(join(TOKENS_DIR, darkFile));
  const lightEntries = flatten(light);
  const darkEntries = flatten(dark);

  const header = `/* Auto-generated from /tokens/*.tokens.json by scripts/build-tokens.mjs.\n * Do NOT edit by hand. Run \`pnpm build:tokens\` to regenerate. */\n`;

  const rootBlock = `:root {\n${renderBlock(primitiveEntries, primitives)}\n${renderBlock(
    lightEntries,
    primitives,
  )}\n}\n`;

  const darkClassBlock = `:root.dark, .dark {\n${renderBlock(darkEntries, primitives)}\n}\n`;

  const darkMediaBlock = `@media (prefers-color-scheme: dark) {\n  :root:not(.light) {\n${renderBlock(
    darkEntries,
    primitives,
  )
    .split("\n")
    .map((l) => `  ${l}`)
    .join("\n")}\n  }\n}\n`;

  await writeFile(OUT, [header, rootBlock, darkClassBlock, darkMediaBlock].join("\n"));
  console.log(`tokens → ${OUT}`);
  console.log(
    `  ${primitiveEntries.length} primitives, ${lightEntries.length} light, ${darkEntries.length} dark`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
