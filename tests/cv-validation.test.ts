import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { CvDocument } from "@/components/cv/cv-document";
import type { CvDoc, CvView } from "@/lib/types";
import { currentMonthInTashkent, cvBodySchema, safeHttpsUrl } from "@/lib/validation";

import { validCv } from "./cv-fixtures";

// Limits, URL rules and output escaping of the CV (CLAUDE.md rule 12). No database: the integration test
// (tests/cv.test.ts) shows that save_cv() refuses the same documents in SQL.


const parse = (patch: Partial<CvDoc> | Record<string, unknown>) => cvBodySchema.safeParse({ ...validCv(), ...patch });

describe("cvBodySchema", () => {
  it("accepts a full CV and normalizes it", () => {
    const r = parse({});
    expect(r.success).toBe(true);
    if (!r.success) return;
    expect(r.data.contact_email).toBe("test@example.invalid");
    expect(r.data.contact_telegram).toBe("@test_user");
    expect(r.data.links[0].url).toBe("https://github.com/example");
  });

  it("accepts an empty CV; empty contacts become null", () => {
    const r = cvBodySchema.safeParse({
      about: "",
      skills: [],
      languages: [],
      experience: [],
      links: [],
      contact_phone: "",
      contact_email: null,
      contact_telegram: " ",
      contact_city: "",
    });
    expect(r.success).toBe(true);
    if (r.success) expect([r.data.contact_phone, r.data.contact_email, r.data.contact_telegram, r.data.contact_city]).toEqual([null, null, null, null]);
  });

  it("enforces the limits", () => {
    const exp = validCv().experience[0];
    const cases: Record<string, unknown>[] = [
      { about: "a".repeat(601) },
      { skills: Array.from({ length: 21 }, (_, i) => `s${i}`) },
      { skills: ["a".repeat(41)] },
      { skills: ["SQL", "sql"] },
      { skills: [""] },
      { languages: Array.from({ length: 9 }, (_, i) => ({ name: `L${i}`, level: "A1" })) },
      { languages: [{ name: "Ingliz", level: "fluent" }] },
      { experience: Array.from({ length: 11 }, () => exp) },
      { experience: [{ ...exp, description: "d".repeat(301) }] },
      { experience: [{ ...exp, title: "" }] },
      { experience: [{ ...exp, start: "2024-13" }] },
      { experience: [{ ...exp, start: "2024-9" }] },
      { experience: [{ ...exp, start: "2024-09", end: "2024-08" }] },
      { experience: [{ ...exp, start: "2999-01" }] },
      { experience: [{ ...exp, extra: 1 }] },
      { links: Array.from({ length: 6 }, (_, i) => ({ label: `L${i}`, url: `https://example.com/${i}` })) },
      { links: [{ label: "x".repeat(41), url: "https://example.com" }] },
      { contact_city: "c".repeat(81) },
      { contact_phone: "call me" },
      { contact_email: "not-an-email" },
      { contact_telegram: "@ab" },
      { cv_visibility: "public" },
      { about: "zero\u0000width" },
      { about: "bidi ‮ override" },
      { skills: ["new\nline"] },
    ];
    for (const c of cases) expect(parse(c).success, JSON.stringify(c).slice(0, 80)).toBe(false);
  });

  it("counts characters, not UTF-16 units (Postgres char_length)", () => {
    expect(parse({ about: "😀".repeat(600) }).success).toBe(true);
    expect(parse({ about: "😀".repeat(601) }).success).toBe(false);
    expect(parse({ skills: ["oʻgʻ".repeat(10)] }).success).toBe(true);
  });

  it("allows the current month and 'present', not a future month", () => {
    const now = currentMonthInTashkent();
    const exp = validCv().experience[0];
    expect(parse({ experience: [{ ...exp, start: now, end: now }] }).success).toBe(true);
    const [y, m] = now.split("-").map(Number);
    const next = m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, "0")}`;
    expect(parse({ experience: [{ ...exp, start: "2020-01", end: next }] }).success).toBe(false);
  });

  it("links: https only, no credentials, a dotted host", () => {
    const bad = [
      "http://example.com",
      "javascript:alert(1)",
      "JAVASCRIPT:alert(1)",
      "data:text/html,<script>alert(1)</script>",
      "ftp://example.com",
      "//example.com",
      "https://user:pass@example.com",
      "https://localhost",
      "https://example.com.",
      "https://[::1]/",
      "example.com",
      `https://example.com/${"a".repeat(300)}`,
    ];
    for (const url of bad) {
      expect(safeHttpsUrl(url), url).toBeNull();
      expect(parse({ links: [{ label: "x", url }] }).success, url).toBe(false);
    }
    expect(safeHttpsUrl("  https://Example.com/a b ")).toBe("https://example.com/a%20b");
  });
});

describe("CV output escaping", () => {
  const SCRIPT = `<script>alert("x")</script><img src=x onerror=alert(1)>`;
  const view: CvView = {
    student_id: "00000000-0000-4000-8000-000000000001",
    full_name: SCRIPT,
    university: SCRIPT,
    faculty: SCRIPT,
    course: 2,
    tier: null,
    content: {
      about: SCRIPT,
      skills: [SCRIPT],
      languages: [{ name: SCRIPT, level: "B2" }],
      experience: [{ title: SCRIPT, organization: SCRIPT, start: "2024-01", end: null, description: SCRIPT }],
      links: [
        { label: SCRIPT, url: "javascript:alert(1)" },
        { label: "ok", url: "https://example.com/x" },
      ],
    },
    contacts: { contact_phone: SCRIPT, contact_email: SCRIPT, contact_telegram: SCRIPT, contact_city: SCRIPT },
    works: [
      {
        submission_id: "w1",
        title: SCRIPT,
        type_name: { uz: SCRIPT, en: SCRIPT, ru: SCRIPT },
        issuer: SCRIPT,
        achievement_date: "2025-01-01",
        level: "national",
        result: "winner",
      },
    ],
    updated_at: "2026-11-08T10:00:00Z",
  };

  it("renders every text field as escaped text, never as markup", () => {
    const html = renderToStaticMarkup(createElement(CvDocument, { cv: view }));
    expect(html).not.toMatch(/<script/i);
    expect(html).not.toMatch(/<img/i);
    expect(html).toContain("&lt;script&gt;");
    expect(html).not.toMatch(/href="javascript:/i);
  });

  it("valid links get rel=noopener noreferrer nofollow and open in a new tab", () => {
    const html = renderToStaticMarkup(createElement(CvDocument, { cv: view }));
    expect(html).toMatch(/<a href="https:\/\/example\.com\/x" target="_blank" rel="noopener noreferrer nofollow"/);
    // The javascript: link is shown as text only.
    expect(html.match(/<a /g)?.length).toBe(1);
  });

  it("shows contacts and course only when the view carries them", () => {
    const contacts = { contact_phone: "+998 90 000 00 01", contact_email: "mark@example.invalid", contact_telegram: "@markuser", contact_city: "MarkCity" };
    const withAll = renderToStaticMarkup(createElement(CvDocument, { cv: { ...view, contacts } }));
    for (const v of Object.values(contacts)) expect(withAll).toContain(v);
    expect(withAll).toContain("2-kurs");

    const rest: CvView = { ...view };
    delete rest.contacts;
    delete rest.course;
    const without = renderToStaticMarkup(createElement(CvDocument, { cv: rest }));
    for (const v of Object.values(contacts)) expect(without).not.toContain(v);
    expect(without).not.toContain("2-kurs");
  });
});
