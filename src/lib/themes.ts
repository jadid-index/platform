// Theme registry. Colors live in src/styles/themes.css (one [data-theme] block per id); labels in t.theme.names.
// Adding a theme: a CSS block, an entry here, a label. No component changes.
export const THEMES = [
  { id: "mint" },
  { id: "pastel" },
] as const;

export type ThemeId = (typeof THEMES)[number]["id"];
export const DEFAULT_THEME: ThemeId = "mint";
export const THEME_COOKIE = "jadid-theme";
export const THEME_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

export function parseTheme(value: unknown): ThemeId {
  return THEMES.some((t) => t.id === value) ? (value as ThemeId) : DEFAULT_THEME;
}

// Runs in <head> before the first paint, so a saved theme never flashes the default. Only known ids are applied;
// an unreadable or unknown cookie leaves the default (:root) in place.
export const THEME_BOOT_SCRIPT = `(function(){try{var m=document.cookie.match(/(?:^|; )${THEME_COOKIE}=([^;]*)/);var v=m&&decodeURIComponent(m[1]);var ok=${JSON.stringify(THEMES.map((t) => t.id))};if(v&&ok.indexOf(v)>-1)document.documentElement.setAttribute("data-theme",v);}catch(e){}})();`;
