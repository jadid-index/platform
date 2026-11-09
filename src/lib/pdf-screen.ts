import { constants, inflateSync } from "node:zlib";

import { CV_FILE_MAX_BYTES } from "@/lib/validation";

// A simple screen for uploaded CV PDFs. It is NOT a malware scanner: it only refuses files that are not PDFs, are too
// large, are encrypted, or carry the usual markers of active content. A PDF that passes may still be harmful; the
// UI says so. Files are never opened, rendered or sent to the AI model.
//
// Checks, in order:
//   1. size <= 5 MB                                   -> file_too_large
//   2. the bytes start with "%PDF-" (not the extension) -> file_type
//   3. no /Encrypt name                               -> pdf_encrypted
//   4. no /JavaScript, /JS, /Launch, /EmbeddedFile(s), /OpenAction name -> pdf_active_content
// Names are matched as whole PDF name tokens with #xx escapes decoded (/J#53 is /JS). Dictionaries outside streams
// are scanned, plus the contents of object streams (/Type /ObjStm, where PDF 1.5+ keeps dictionaries compressed),
// inflated with a size budget. Other stream data (page content, images, fonts) is not decoded; it is only searched
// for the long markers, because a three-letter name like /JS turns up by chance in binary data.

export type PdfScreenResult =
  | { ok: true }
  | { ok: false; code: "file_too_large" | "file_type" | "pdf_encrypted" | "pdf_active_content" | "pdf_unreadable" };

const ACTIVE = new Set(["JavaScript", "JS", "Launch", "EmbeddedFile", "EmbeddedFiles", "OpenAction"]);
const LONG_MARKERS = ["/JavaScript", "/Launch", "/EmbeddedFile", "/OpenAction", "/Encrypt"];
const INFLATE_BUDGET = 20 * 1024 * 1024; // total bytes inflated from object streams
const STREAM_START = /stream(?:\r\n|\n|\r)/g;
// A PDF name: "/" then regular characters (anything but whitespace and delimiters).
const NAME = /\/([^\x00\t\n\f\r \/\[\]<>(){}%]*)/g;

function decodeName(raw: string): string {
  return raw.replace(/#([0-9a-fA-F]{2})/g, (_, h: string) => String.fromCharCode(parseInt(h, 16)));
}

function names(text: string): Set<string> {
  const out = new Set<string>();
  for (const m of text.matchAll(NAME)) out.add(decodeName(m[1]));
  return out;
}

type Stream = { dict: string; data: Uint8Array };

// Splits the file into the text outside streams and the raw stream bodies. A stream runs from the "stream" keyword
// after a dictionary to the next "endstream" (the /Length value may be an indirect object, so it is not used).
function splitStreams(bytes: Uint8Array, text: string): { outside: string; streams: Stream[] } {
  const streams: Stream[] = [];
  let outside = "";
  let pos = 0;
  STREAM_START.lastIndex = 0;
  for (;;) {
    const m = STREAM_START.exec(text);
    if (!m) break;
    // Only "stream" right after a dictionary ">>" starts a stream (not "endstream" or the word inside a string).
    const before = text.slice(Math.max(pos, m.index - 2048), m.index);
    if (!/>>\s*$/.test(before) || text.slice(m.index - 3, m.index) === "end") continue;
    const start = m.index + m[0].length;
    const end = text.indexOf("endstream", start);
    if (end < 0) break;
    const objStart = text.lastIndexOf("obj", m.index);
    const dict = text.slice(Math.max(pos, objStart < 0 ? pos : objStart), m.index);
    outside += text.slice(pos, start);
    streams.push({ dict, data: bytes.subarray(start, end) });
    pos = end;
    STREAM_START.lastIndex = end;
  }
  outside += text.slice(pos);
  return { outside, streams };
}

export function screenPdf(bytes: Uint8Array): PdfScreenResult {
  if (bytes.length > CV_FILE_MAX_BYTES) return { ok: false, code: "file_too_large" };
  if (bytes.length < 5 || String.fromCharCode(...bytes.subarray(0, 5)) !== "%PDF-") return { ok: false, code: "file_type" };

  const text = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString("latin1");
  const { outside, streams } = splitStreams(bytes, text);

  // Dictionaries kept inside object streams.
  let scanned = outside;
  let budget = INFLATE_BUDGET;
  for (const s of streams) {
    const dictNames = names(s.dict);
    if (!dictNames.has("ObjStm")) continue;
    const filters = [...dictNames].filter((n) => n.endsWith("Decode"));
    let data: Buffer;
    if (filters.length === 0) {
      data = Buffer.from(s.data);
    } else if (filters.length === 1 && filters[0] === "FlateDecode") {
      try {
        data = inflateSync(s.data, { maxOutputLength: budget, finishFlush: constants.Z_SYNC_FLUSH });
      } catch {
        return { ok: false, code: "pdf_unreadable" };
      }
    } else {
      return { ok: false, code: "pdf_unreadable" };
    }
    budget -= data.length;
    if (budget <= 0) return { ok: false, code: "pdf_unreadable" };
    scanned += "\n" + data.toString("latin1");
  }

  const found = names(scanned);
  if (found.has("Encrypt")) return { ok: false, code: "pdf_encrypted" };
  for (const n of found) if (ACTIVE.has(n)) return { ok: false, code: "pdf_active_content" };

  // Raw stream data: only the long markers (a chance match of these is practically impossible).
  for (const s of streams) {
    const raw = Buffer.from(s.data.buffer, s.data.byteOffset, s.data.byteLength).toString("latin1");
    for (const marker of LONG_MARKERS) {
      if (raw.includes(marker)) return { ok: false, code: marker === "/Encrypt" ? "pdf_encrypted" : "pdf_active_content" };
    }
  }
  return { ok: true };
}
