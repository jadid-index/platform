import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

import { checkTheme, contrast, parseThemes, runContrastCheck } from "../scripts/check-contrast";

describe("npm run check:contrast", () => {
  it("passes for every theme and finds no raw colors in components", () => {
    const { report, ok } = runContrastCheck();
    expect(ok, report).toBe(true);
  });

  it("measures the team palette as WCAG does", () => {
    expect(contrast("#272727", "#effffb")).toBeCloseTo(14.5, 1);
    expect(contrast("#272727", "#50d890")).toBeCloseTo(8.2, 1);
    expect(contrast("#ffffff", "#50d890")).toBeLessThan(2);
    expect(contrast("#4f98ca", "#effffb")).toBeLessThan(3.1);
  });

  it("fails a theme with a bad pair", () => {
    const css = (extra: string) =>
      readFileSync("src/styles/themes.css", "utf8") + `\n[data-theme="broken"] { ${extra} }`;
    const broken = parseThemes(css("--primary-contrast: #ffffff; --accent-text: #4f98ca;")).broken;
    const { failures } = checkTheme(broken);
    expect(failures.some((f) => f.includes("--primary-contrast on --primary"))).toBe(true);
    expect(failures.some((f) => f.includes("white text on #50D890"))).toBe(true);
    expect(failures.some((f) => f.includes("palette fill color"))).toBe(true);
  });
});
