// Recognition check for the reviewer (SPEC section 5). Plain code, not the model: it compares what the AI read
// from the document with what the student entered and with the profile. It only informs; it never blocks approval.

export type CheckStatus = "ok" | "check" | "missing";
export type Check = { key: "name" | "date" | "certificate_ref"; status: CheckStatus; document: string | null; entered: string | null };

// Uzbek and Russian Cyrillic to Uzbek Latin. Apostrophe letters (oʻ, gʻ) are folded to o and g by normalize().
const CYRILLIC: Record<string, string> = {
  а: "a", б: "b", в: "v", г: "g", ғ: "g", д: "d", е: "e", ё: "yo", ж: "j", з: "z", и: "i", й: "y", к: "k", қ: "q",
  л: "l", м: "m", н: "n", о: "o", п: "p", р: "r", с: "s", т: "t", у: "u", ў: "o", ф: "f", х: "x", ҳ: "h", ц: "ts",
  ч: "ch", ш: "sh", щ: "sh", ъ: "", ы: "i", ь: "", э: "e", ю: "yu", я: "ya",
};

export function transliterate(text: string): string {
  return [...text.toLowerCase()].map((c) => CYRILLIC[c] ?? c).join("");
}

// Lowercase Latin tokens: Cyrillic transliterated, accents and apostrophes dropped, Russian-style "kh" read as "x".
export function nameTokens(name: string): string[] {
  return transliterate(name)
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[ʻʼ'`’‘]/g, "")
    .replace(/kh/g, "x")
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length > 1);
}

// The same person if at least two profile name tokens (or all of them, for a one-word name) appear in the
// document's recipient name, in any order. Patronymic suffixes ("ogli", "qizi") never decide on their own.
export function namesMatch(documentName: string, profileName: string): boolean {
  const ignore = new Set(["ogli", "qizi", "ugli", "kizi"]);
  const doc = new Set(nameTokens(documentName).filter((t) => !ignore.has(t)));
  const profile = nameTokens(profileName).filter((t) => !ignore.has(t));
  if (doc.size === 0 || profile.length === 0) return false;
  const hits = profile.filter((t) => doc.has(t)).length;
  return hits >= Math.min(2, profile.length);
}

// Certificate numbers: case, spaces, dashes, dots and slashes do not count.
export function normalizeRef(ref: string): string {
  return transliterate(ref).replace(/[\s\-–—./\\№#]/g, "");
}

type Extracted = { recipient_name?: unknown; achievement_date?: unknown; certificate_ref?: unknown } | null | undefined;

const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);

export function recognitionChecks(
  extraction: Extracted,
  entered: { profile_name: string; achievement_date: string; certificate_ref: string | null },
): Check[] {
  const docName = str(extraction?.recipient_name);
  const docDate = str(extraction?.achievement_date);
  const docRef = str(extraction?.certificate_ref);
  const ref = str(entered.certificate_ref);
  return [
    {
      key: "name",
      status: docName ? (namesMatch(docName, entered.profile_name) ? "ok" : "check") : "missing",
      document: docName,
      entered: entered.profile_name,
    },
    {
      key: "date",
      status: docDate ? (docDate === entered.achievement_date ? "ok" : "check") : "missing",
      document: docDate,
      entered: entered.achievement_date,
    },
    {
      key: "certificate_ref",
      status: docRef ? (ref && normalizeRef(docRef) === normalizeRef(ref) ? "ok" : "check") : "missing",
      document: docRef,
      entered: ref,
    },
  ];
}
