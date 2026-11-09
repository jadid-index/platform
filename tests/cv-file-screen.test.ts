import { deflateSync } from "node:zlib";

import { PDFDocument, StandardFonts } from "pdf-lib";
import { describe, expect, it } from "vitest";

import { screenPdf } from "@/lib/pdf-screen";
import { CV_FILE_MAX_BYTES } from "@/lib/validation";

import { samplePdf } from "../scripts/lib/test-data";

// The uploaded-CV screen (src/lib/pdf-screen.ts). A simple screen, not a malware scanner: these tests pin what it
// does refuse.

const enc = (s: string) => new Uint8Array(Buffer.from(s, "latin1"));

// A minimal PDF whose catalog carries extra dictionary entries.
function pdfWith(catalogExtra: string, extraObjects: string[] = []): Uint8Array {
  const objects = [
    `<< /Type /Catalog /Pages 2 0 R ${catalogExtra} >>`,
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] >>",
    ...extraObjects,
  ];
  let body = "%PDF-1.7\n";
  objects.forEach((o, i) => (body += `${i + 1} 0 obj\n${o}\nendobj\n`));
  body += `trailer\n<< /Root 1 0 R /Size ${objects.length + 1} >>\n%%EOF\n`;
  return enc(body);
}

async function cleanPdfLib(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const page = doc.addPage();
  page.drawText("Test CV", { font: await doc.embedFont(StandardFonts.Helvetica), x: 50, y: 700 });
  return doc.save({ useObjectStreams: true });
}

describe("screenPdf()", () => {
  it("accepts ordinary PDFs", async () => {
    expect(screenPdf(samplePdf("clean"))).toEqual({ ok: true });
    expect(screenPdf(pdfWith(""))).toEqual({ ok: true });
    expect(screenPdf(await cleanPdfLib())).toEqual({ ok: true });
    // A URI link is not one of the markers.
    expect(screenPdf(pdfWith("", ["<< /Type /Annot /Subtype /Link /A << /S /URI /URI (https://example.com) >> >>"]))).toEqual({ ok: true });
  });

  it("refuses type spoofing: an .exe renamed to .pdf, or text with a .pdf name", () => {
    const exe = new Uint8Array(4096);
    exe.set(enc("MZ\x90\x00\x03\x00\x00\x00This program cannot be run in DOS mode."));
    expect(screenPdf(exe)).toEqual({ ok: false, code: "file_type" });
    expect(screenPdf(enc("hello %PDF-1.4"))).toEqual({ ok: false, code: "file_type" });
    expect(screenPdf(enc("%PDF"))).toEqual({ ok: false, code: "file_type" });
    expect(screenPdf(new Uint8Array(0))).toEqual({ ok: false, code: "file_type" });
  });

  it("refuses files over 5 MB", () => {
    const big = new Uint8Array(CV_FILE_MAX_BYTES + 1);
    big.set(samplePdf("big"));
    expect(screenPdf(big)).toEqual({ ok: false, code: "file_too_large" });
    const exact = new Uint8Array(CV_FILE_MAX_BYTES);
    exact.set(samplePdf("exact"));
    expect(screenPdf(exact)).toEqual({ ok: true });
  });

  it("refuses encrypted PDFs", () => {
    const encrypted = enc(
      "%PDF-1.6\n1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n" +
        "5 0 obj\n<< /Filter /Standard /V 2 /R 3 /Length 128 /P -1068 /O <00> /U <00> >>\nendobj\n" +
        "trailer\n<< /Root 1 0 R /Encrypt 5 0 R /ID [<01><01>] >>\n%%EOF\n",
    );
    expect(screenPdf(encrypted)).toEqual({ ok: false, code: "pdf_encrypted" });
  });

  it.each([
    ["/JavaScript", "/OpenAction 4 0 R", ["<< /S /JavaScript /JS (app.alert(1)) >>"]],
    ["/JS only", "/Names << /JavaScript 4 0 R >>", ["<< /S /JavaScript /JS 5 0 R >>"]],
    ["/Launch", "", ["<< /Type /Annot /Subtype /Link /A << /S /Launch /F (calc.exe) >> >>"]],
    ["/EmbeddedFile", "", ["<< /Type /EmbeddedFile /Length 0 >>"]],
    ["/EmbeddedFiles name tree", "/Names << /EmbeddedFiles 4 0 R >>", ["<< /Names [] >>"]],
    ["/OpenAction", "/OpenAction [3 0 R /Fit]", []],
  ])("refuses active content: %s", (_label, catalog, extra) => {
    expect(screenPdf(pdfWith(catalog, extra))).toEqual({ ok: false, code: "pdf_active_content" });
  });

  it("refuses /JS on its own and with #-escaped names", () => {
    expect(screenPdf(pdfWith("", ["<< /S /Foo /JS (x) >>"]))).toEqual({ ok: false, code: "pdf_active_content" });
    expect(screenPdf(pdfWith("", ["<< /S /J#61vaScript /J#53 (x) >>"]))).toEqual({ ok: false, code: "pdf_active_content" });
    expect(screenPdf(pdfWith("/Open#41ction [3 0 R /Fit]"))).toEqual({ ok: false, code: "pdf_active_content" });
    expect(screenPdf(pdfWith("", ["<< /Filter /Standard >>"]).slice(0))).toEqual({ ok: true });
  });

  it("does not match longer names that only start with a marker", () => {
    expect(screenPdf(pdfWith("/JSX 1 /Launcher 2 /OpenActions 3"))).toEqual({ ok: true });
  });

  it("finds markers hidden inside a compressed object stream", () => {
    const inner = "6 0 << /S /JavaScript /JS (app.alert(1)) >>";
    const packed = deflateSync(Buffer.from(inner, "latin1"));
    const head = `%PDF-1.7\n7 0 obj\n<< /Type /ObjStm /N 1 /First 4 /Filter /FlateDecode /Length ${packed.length} >>\nstream\n`;
    const tail = "\nendstream\nendobj\ntrailer\n<< /Root 1 0 R >>\n%%EOF\n";
    const bytes = new Uint8Array([...enc(head), ...packed, ...enc(tail)]);
    expect(screenPdf(bytes)).toEqual({ ok: false, code: "pdf_active_content" });

    // Same, with the stream type #-escaped so a plain substring search would miss it.
    const escaped = head.replace("/ObjStm", "/Obj#53tm");
    expect(screenPdf(new Uint8Array([...enc(escaped), ...packed, ...enc(tail)]))).toEqual({
      ok: false,
      code: "pdf_active_content",
    });
  });

  it("refuses an object stream it cannot read", () => {
    const head = "%PDF-1.7\n7 0 obj\n<< /Type /ObjStm /N 1 /First 4 /Filter /FlateDecode /Length 10 >>\nstream\n";
    const bytes = enc(head + "not-zlib!!" + "\nendstream\nendobj\n%%EOF\n");
    expect(screenPdf(bytes)).toEqual({ ok: false, code: "pdf_unreadable" });
  });

  it("ignores a chance /JS in binary stream data but not the long markers", () => {
    const withShort = pdfWith("", ["<< /Length 12 >>\nstream\nab/JS cd/JS \nendstream"]);
    expect(screenPdf(withShort)).toEqual({ ok: true });
    const withLong = pdfWith("", ["<< /Length 16 >>\nstream\nxx/JavaScript xx\nendstream"]);
    expect(screenPdf(withLong)).toEqual({ ok: false, code: "pdf_active_content" });
  });
});
