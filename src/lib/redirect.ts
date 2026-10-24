// Accepts only a same-site relative path for post-login redirects, otherwise "/".
// Rejects "//host" and "/\host" (browsers treat both as another origin), anything absolute, and control
// characters: the URL parser strips tabs and newlines, so "/\t/evil.com" would become "//evil.com".
// The final check resolves the path against a dummy origin and requires the origin to stay the same.
export function safeNextPath(next: string | null | undefined): string {
  if (!next || !next.startsWith("/") || next.startsWith("//") || next.startsWith("/\\")) return "/";
  if (/[\u0000-\u001f\u007f]/.test(next)) return "/";
  const base = "https://same.origin.invalid";
  const url = new URL(next, base);
  return url.origin === base ? `${url.pathname}${url.search}${url.hash}` : "/";
}
