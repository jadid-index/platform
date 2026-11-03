"use client";

import { Check, Palette } from "lucide-react";
import { useSyncExternalStore } from "react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { t } from "@/i18n";
import { DEFAULT_THEME, parseTheme, THEME_COOKIE, THEME_COOKIE_MAX_AGE, THEMES, type ThemeId } from "@/lib/themes";
import { cn } from "@/lib/utils";

// The theme lives on <html data-theme> (set before paint by THEME_BOOT_SCRIPT) and in the jadid-theme cookie.
function subscribe(onChange: () => void) {
  const observer = new MutationObserver(onChange);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
  return () => observer.disconnect();
}
const current = () => parseTheme(document.documentElement.getAttribute("data-theme"));

function useTheme(): [ThemeId, (id: ThemeId) => void] {
  const theme = useSyncExternalStore(subscribe, current, () => DEFAULT_THEME);
  const set = (id: ThemeId) => {
    document.documentElement.setAttribute("data-theme", id);
    document.cookie = `${THEME_COOKIE}=${id}; path=/; max-age=${THEME_COOKIE_MAX_AGE}; samesite=lax`;
  };
  return [theme, set];
}

// Three dots in the theme's own colors: data-theme on the swatch makes its tokens resolve to that theme,
// so a new theme needs no change here.
function Swatch({ id }: { id: ThemeId }) {
  return (
    <span data-theme={id} aria-hidden className="flex -space-x-1">
      {["bg-background", "bg-primary", "bg-accent", "bg-surface-inverse"].map((c) => (
        <span key={c} className={cn("size-3.5 rounded-full border border-border-strong/60", c)} />
      ))}
    </span>
  );
}

const name = (id: ThemeId) => t.theme.names[id] ?? id;

// Radio items for use inside another dropdown (the profile menu).
export function ThemeMenuItems() {
  const [theme, setTheme] = useTheme();
  return (
    <>
      <DropdownMenuLabel>{t.theme.label}</DropdownMenuLabel>
      <DropdownMenuRadioGroup value={theme} onValueChange={(v) => setTheme(parseTheme(v))}>
        {THEMES.map(({ id }) => (
          <DropdownMenuRadioItem key={id} value={id} onSelect={(e) => e.preventDefault()}>
            <Swatch id={id} />
            {name(id)}
          </DropdownMenuRadioItem>
        ))}
      </DropdownMenuRadioGroup>
    </>
  );
}

// Icon button with a dropdown, for the top bar.
export function ThemeSwitch({ className }: { className?: string }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" className={cn("rounded-full", className)} aria-label={t.theme.label}>
          <Palette className="size-5" aria-hidden />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-48">
        <ThemeMenuItems />
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

// Segmented choice for the mobile menu sheet: every option shows its swatch and name.
export function ThemeChoices() {
  const [theme, setTheme] = useTheme();
  return (
    <fieldset className="grid gap-2">
      <legend className="mb-2 text-small font-semibold">{t.theme.label}</legend>
      <div className="grid grid-cols-2 gap-2">
        {THEMES.map(({ id }) => {
          const active = theme === id;
          return (
            <button
              key={id}
              type="button"
              aria-pressed={active}
              onClick={() => setTheme(id)}
              className={cn(
                "flex h-11 items-center gap-2 rounded-xl border px-3 text-small font-medium outline-none transition-colors",
                "focus-visible:ring-[3px] focus-visible:ring-ring/50",
                active ? "border-primary-text bg-primary-soft text-text" : "bg-surface-raised hover:bg-muted",
              )}
            >
              <Swatch id={id} />
              <span className="flex-1 text-left">{name(id)}</span>
              {active ? <Check className="size-4 text-primary-text" aria-hidden /> : null}
            </button>
          );
        })}
      </div>
    </fieldset>
  );
}
