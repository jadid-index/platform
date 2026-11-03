// WCAG AA contrast check for every theme in src/styles/themes.css, plus a scan for raw colors in components.
//   npm run check:contrast
// Exits 1 if any pair is below its minimum or a component uses a raw color.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const THEMES_FILE = "src/styles/themes.css";
const TEXT = 4.5; // normal text
const LARGE = 3; // large text (>= 24 px, or >= 18.66 px bold) and UI borders / focus rings

type Vars = Record<string, string>;

// --- Parse themes.css: the default is :root; each [data-theme="x"] block overrides it; the shared alias block applies to all.
export function parseThemes(css: string): Record<string, Vars> {
  const blocks = [...css.replace(/\/\*[\s\S]*?\*\//g, "").matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => ({
    selector: m[1].trim(),
    vars: Object.fromEntries(
      [...m[2].matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)].map((d) => [d[1], d[2].trim()]),
    ) as Vars,
  }));
  const shared = blocks.filter((b) => /\[data-theme\]\s*$/.test(b.selector)).map((b) => b.vars);
  const base = blocks.filter((b) => b.selector.split(",").some((s) => s.trim() === ":root") && !shared.includes(b.vars));
  const ids = new Set(
    blocks.flatMap((b) => [...b.selector.matchAll(/\[data-theme="([\w-]+)"\]/g)].map((m) => m[1])),
  );
  const themes: Record<string, Vars> = {};
  for (const id of ids) {
    const own = blocks.filter((b) => b.selector.includes(`[data-theme="${id}"]`)).map((b) => b.vars);
    // A theme that is not the :root default still starts from :root, so a missing token falls back visibly.
    const isRoot = base.some((b) => own.includes(b.vars));
    themes[id] = Object.assign({}, ...(isRoot ? [] : base.map((b) => b.vars)), ...own, ...shared);
  }
  return themes;
}

function resolve(vars: Vars, name: string, depth = 0): string {
  const value = vars[name];
  if (value === undefined) throw new Error(`missing token ${name}`);
  const ref = value.match(/^var\((--[\w-]+)\)$/);
  if (ref && depth < 10) return resolve(vars, ref[1], depth + 1);
  return value;
}

function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace("#", "");
  const full = h.length === 3 ? [...h].map((c) => c + c).join("") : h;
  if (!/^[0-9a-f]{6}$/i.test(full)) throw new Error(`not a solid hex color: ${hex}`);
  return [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16)) as [number, number, number];
}

function luminance(hex: string): number {
  const [r, g, b] = hexToRgb(hex).map((c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

type Pair = { fg: string; bg: string; min: number; note?: string };

const SURFACES = ["--background", "--surface", "--surface-raised"];
const pair = (fg: string, bg: string, min = TEXT, note?: string): Pair => ({ fg, bg, min, note });

export const PAIRS: Pair[] = [
  // Body and secondary text, links and small colored text on every light surface.
  ...SURFACES.flatMap((bg) => [
    pair("--text", bg),
    pair("--muted-foreground", bg),
    pair("--primary-text", bg, TEXT, "green text / links"),
    pair("--accent-text", bg, TEXT, "blue links / small text"),
    pair("--destructive", bg, TEXT, "form errors"),
    pair("--border-strong", bg, LARGE, "input borders"),
    pair("--ring", bg, LARGE, "focus ring"),
  ]),
  pair("--text", "--muted"),
  pair("--muted-foreground", "--muted"),
  pair("--text", "--surface-sunken"),
  pair("--muted-foreground", "--surface-sunken"),
  pair("--primary-text", "--primary-soft"),
  pair("--text", "--primary-soft"),
  pair("--accent-text", "--accent-soft"),
  pair("--text", "--accent-soft"),
  // Filled buttons and chips.
  pair("--primary-contrast", "--primary", TEXT, "default button"),
  pair("--primary-text-contrast", "--primary-text", TEXT, "strong button"),
  pair("--accent-contrast", "--accent", TEXT, "blue fill"),
  pair("--destructive-foreground", "--destructive", TEXT, "destructive button"),
  // Dark (inverse) panels such as the hero.
  pair("--surface-inverse-foreground", "--surface-inverse"),
  pair("--surface-inverse-muted", "--surface-inverse"),
  pair("--inverse-accent", "--surface-inverse", TEXT, "highlighted word on dark panel"),
  // Status, categories, tiers: ink on its own fill.
  ...["success", "warning", "danger"].map((s) => pair(`--${s}-foreground`, `--${s}`)),
  ...["scientific", "innovation", "social", "personal"].map((c) =>
    pair(`--category-${c}-foreground`, `--category-${c}`),
  ),
  ...[1, 2, 3, 4, 5, 6, 7].map((n) => pair(`--tier-${n}-foreground`, `--tier-${n}`, TEXT, "tier letter")),
];

// Pairs that must never be used, whatever their ratio says elsewhere (team rules for the mint palette).
const FORBIDDEN_TEXT = ["#50d890", "#4f98ca"]; // never as text on light surfaces
const FORBIDDEN_ON_GREEN = ["#ffffff", "#fff"]; // never white text on #50d890

export function checkTheme(vars: Vars): { rows: string[]; failures: string[] } {
  const rows: string[] = [];
  const failures: string[] = [];
  for (const p of PAIRS) {
    const fg = resolve(vars, p.fg).toLowerCase();
    const bg = resolve(vars, p.bg).toLowerCase();
    const ratio = contrast(fg, bg);
    const ok = ratio >= p.min;
    const line = `${ok ? "ok  " : "FAIL"} ${ratio.toFixed(2).padStart(5)}:1 (min ${p.min})  ${p.fg} on ${p.bg}${p.note ? `  (${p.note})` : ""}`;
    rows.push(line);
    if (!ok) failures.push(line);
    const lightBg = luminance(bg) > 0.5;
    if (lightBg && FORBIDDEN_TEXT.includes(fg) && p.fg !== "--tier-1-foreground") {
      failures.push(`FAIL ${p.fg} is a palette fill color (${fg}) used as text on a light surface`);
    }
    if (bg === "#50d890" && FORBIDDEN_ON_GREEN.includes(fg)) failures.push(`FAIL white text on #50D890 (${p.fg})`);
  }
  return { rows, failures };
}

// --- Raw colors in components: hex/rgb/hsl/oklch literals and Tailwind palette classes are not allowed.
const PALETTE =
  /\b(?:bg|text|border|ring|fill|stroke|from|to|via|outline|shadow|divide|decoration|caret|accent)-(?:slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose|white|black)(?:-\d{2,3})?\b/;
const LITERAL = /#[0-9a-fA-F]{3,8}\b|\b(?:rgba?|hsla?|oklch)\(/;

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? walk(path) : /\.(tsx|ts)$/.test(name) ? [path] : [];
  });
}

export function scanRawColors(root = "src"): string[] {
  const hits: string[] = [];
  for (const file of walk(root)) {
    readFileSync(file, "utf8")
      .split("\n")
      .forEach((line, i) => {
        // Comments may mention colors; code may not. Skip comment-only lines.
        if (/^\s*(\/\/|\*|\/\*)/.test(line)) return;
        if (PALETTE.test(line) || LITERAL.test(line)) hits.push(`${file}:${i + 1}: ${line.trim().slice(0, 120)}`);
      });
  }
  return hits;
}

export function runContrastCheck(): { report: string; ok: boolean } {
  const themes = parseThemes(readFileSync(THEMES_FILE, "utf8"));
  const out: string[] = [];
  let ok = true;
  if (!themes.mint) throw new Error("the default theme 'mint' is missing");
  for (const [id, vars] of Object.entries(themes)) {
    const { rows, failures } = checkTheme(vars);
    out.push(`\n== ${id} (${rows.length} pairs, ${failures.length} failing)`, ...rows);
    if (failures.length) {
      ok = false;
      out.push(...failures.filter((f) => !rows.includes(f)));
    }
  }
  const raw = scanRawColors();
  out.push(`\n== raw colors in src (${raw.length})`, ...raw);
  if (raw.length) ok = false;
  return { report: out.join("\n"), ok };
}

if (process.argv[1]?.endsWith("check-contrast.ts")) {
  const { report, ok } = runContrastCheck();
  console.log(report);
  console.log(ok ? "\nAll contrast pairs pass WCAG AA." : "\nContrast check failed.");
  process.exit(ok ? 0 : 1);
}
