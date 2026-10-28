import { describe, expect, it } from "vitest";

import { kindFitsType } from "@/lib/document-kinds";
import { nameTokens, namesMatch, normalizeRef, recognitionChecks, transliterate } from "@/lib/recognition";

describe("names", () => {
  it("transliterates Uzbek and Russian Cyrillic", () => {
    expect(transliterate("Шоҳруҳ Ғуломов")).toBe("shohruh gulomov");
    expect(transliterate("Ўткир Қодиров")).toBe("otkir qodirov");
    expect(transliterate("Юлия Щербакова")).toBe("yuliya sherbakova");
  });

  it("drops apostrophes and reads Russian kh as x", () => {
    expect(nameTokens("Oʻtkir G'ulomov")).toEqual(["otkir", "gulomov"]);
    expect(nameTokens("Khasanov")).toEqual(["xasanov"]);
  });

  it("matches the same person across scripts, order and patronymics", () => {
    const profile = "Karimova Aziza Bahodir qizi";
    expect(namesMatch("Азиза Каримова", profile)).toBe(true);
    expect(namesMatch("KARIMOVA AZIZA", profile)).toBe(true);
    expect(namesMatch("Aziza Karimova Bahodirovna", profile)).toBe(true);
    expect(namesMatch("Хасанов Жасур", "Xasanov Jasur")).toBe(true);
    expect(namesMatch("Khasanov Jasur", "Xasanov Jasur")).toBe(true);
  });

  it("flags a different person", () => {
    expect(namesMatch("Aziza Rahimova", "Karimova Aziza")).toBe(false);
    expect(namesMatch("Bobur Rahimov", "Karimova Aziza")).toBe(false);
    expect(namesMatch("", "Karimova Aziza")).toBe(false);
    expect(namesMatch("qizi", "Aziza qizi")).toBe(false);
  });
});

describe("recognitionChecks", () => {
  const entered = { profile_name: "Karimova Aziza", achievement_date: "2025-10-15", certificate_ref: "AB 12-345" };

  it("shows OK, Check this and missing with both values", () => {
    const checks = recognitionChecks(
      { recipient_name: "Азиза Каримова", achievement_date: "2025-10-16", certificate_ref: "ab12345" },
      entered,
    );
    expect(checks).toEqual([
      { key: "name", status: "ok", document: "Азиза Каримова", entered: "Karimova Aziza" },
      { key: "date", status: "check", document: "2025-10-16", entered: "2025-10-15" },
      { key: "certificate_ref", status: "ok", document: "ab12345", entered: "AB 12-345" },
    ]);
  });

  it("marks fields the document did not show as missing, and works without any extraction", () => {
    const none = recognitionChecks(null, entered);
    expect(none.map((c) => c.status)).toEqual(["missing", "missing", "missing"]);
    const noRefEntered = recognitionChecks({ certificate_ref: "N-1" }, { ...entered, certificate_ref: null });
    expect(noRefEntered[2]).toMatchObject({ status: "check", document: "N-1", entered: null });
  });

  it("normalizes certificate numbers", () => {
    expect(normalizeRef("№ AB-12/345")).toBe("ab12345");
    expect(normalizeRef("10.1000/xyz.2025")).toBe("101000xyz2025");
  });
});

describe("document kind vs type (warning only)", () => {
  it("follows the SPEC table", () => {
    expect(kindFitsType("journal_article", 1)).toBe(true);
    expect(kindFitsType("certificate", 1)).toBe(false);
    expect(kindFitsType("patent_or_registration", 5)).toBe(true);
    expect(kindFitsType("diploma", 3)).toBe(true);
    expect(kindFitsType("other", 12)).toBe(true);
    expect(kindFitsType("anything", 999)).toBe(true);
  });
});
