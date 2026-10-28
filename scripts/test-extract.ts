// Runs the extraction used by /api/extract on every file in test-certificates/ and prints which fields came back.
// For checking real certificates (Uzbek Latin and Cyrillic, Russian, English) before turning extraction on.
//
//   npm run test:extract                 all files in test-certificates/
//   npm run test:extract -- --show       also print the extracted values (on your screen only, never stored)
//
// test-certificates/ is gitignored: these are real students' documents. Keep them local and delete them after
// testing. Every file is one paid model call.

import { readdirSync, readFileSync } from "node:fs";
import { extname, join } from "node:path";

import { EXTRACTION_MODEL, extractFromBytes, extractionEnabled, type Extraction, type ProofKind } from "@/lib/extraction";
import { kindFromBytes } from "@/lib/submissions";

const DIR = "test-certificates";
const FIELDS = ["title", "issuer", "recipient_name", "achievement_date", "certificate_ref"] as const;
const show = process.argv.includes("--show");

async function main() {
  if (!extractionEnabled()) {
    console.error("Extraction is off. Set AI_EXTRACTION_ENABLED=true and ANTHROPIC_API_KEY in .env.local.");
    process.exit(1);
  }
  let files: string[];
  try {
    files = readdirSync(DIR).filter((f) => [".pdf", ".jpg", ".jpeg", ".png"].includes(extname(f).toLowerCase())).sort();
  } catch {
    console.error(`Put the certificates in ./${DIR}/ (gitignored) and run again.`);
    process.exit(1);
  }
  if (files.length === 0) {
    console.error(`No PDF, JPG or PNG files in ./${DIR}/.`);
    process.exit(1);
  }
  console.log(`${files.length} files, model ${EXTRACTION_MODEL}. Each file is one paid API call.\n`);

  const rows: string[][] = [];
  let filled = 0;
  for (const name of files) {
    const bytes = new Uint8Array(readFileSync(join(DIR, name)));
    const kind = kindFromBytes(bytes) as ProofKind | null;
    const started = Date.now();
    const outcome = kind ? await extractFromBytes(bytes, kind) : ({ ok: false, reason: "not PDF/JPG/PNG" } as const);
    const seconds = ((Date.now() - started) / 1000).toFixed(1);
    if (!outcome.ok) {
      rows.push([name, `FAILED: ${outcome.reason}`, "", "", ...FIELDS.map(() => ""), "", "", seconds]);
      continue;
    }
    const r: Extraction = outcome.result;
    filled += FIELDS.filter((f) => r[f]).length;
    rows.push([
      name,
      r.document_kind,
      r.language,
      r.confidence,
      ...FIELDS.map((f) => (r[f] ? "✓" : "·")),
      r.level_hint,
      r.result_hint,
      seconds,
    ]);
    if (show) {
      console.log(`--- ${name}`);
      for (const f of [...FIELDS, "level_evidence", "result_evidence"] as const) console.log(`  ${f}: ${r[f] ?? "—"}`);
      if (r.warnings.length) console.log(`  warnings: ${r.warnings.join(" | ")}`);
    }
  }

  const header = ["file", "kind", "language", "confidence", ...FIELDS, "level_hint", "result_hint", "s"];
  const widths = header.map((h, i) => Math.max(h.length, ...rows.map((r) => [...(r[i] ?? "")].length)));
  const line = (cells: string[]) => cells.map((c, i) => c + " ".repeat(widths[i] - [...c].length)).join("  ");
  console.log("\n" + line(header));
  console.log(widths.map((w) => "-".repeat(w)).join("  "));
  rows.forEach((r) => console.log(line(r)));
  console.log(`\n✓ = found, · = empty. ${filled} of ${files.length * FIELDS.length} fields found.`);
  console.log(`Delete ./${DIR}/ when you are done.`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
