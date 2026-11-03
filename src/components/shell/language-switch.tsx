"use client";

import { Check, Languages } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { locale, t } from "@/i18n";
import { cn } from "@/lib/utils";

// Only Uzbek exists for now; Russian and English are listed as coming soon.
const LOCALES = ["uz", "ru", "en"] as const;

export function LanguageSwitch() {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="sm" className="h-10 rounded-full px-3" aria-label={t.nav.language}>
          <Languages aria-hidden />
          <span className="uppercase">{locale}</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-44">
        <DropdownMenuLabel>{t.nav.language}</DropdownMenuLabel>
        <DropdownMenuRadioGroup value={locale}>
          {LOCALES.map((code) => (
            <DropdownMenuRadioItem key={code} value={code} disabled={code !== locale}>
              {t.nav.languages[code]}
              {code !== locale ? (
                <span className="ml-auto text-xs text-muted-foreground">{t.nav.languageSoon}</span>
              ) : null}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

// The same choice as buttons, for the mobile menu sheet.
export function LanguageChoices() {
  return (
    <fieldset className="grid gap-2">
      <legend className="mb-2 text-small font-semibold">{t.nav.language}</legend>
      <div className="grid grid-cols-3 gap-2">
        {LOCALES.map((code) => {
          const active = code === locale;
          return (
            <button
              key={code}
              type="button"
              aria-pressed={active}
              disabled={!active}
              title={active ? undefined : t.nav.languageSoon}
              className={cn(
                "flex h-11 items-center justify-center gap-1.5 rounded-xl border px-2 text-small font-medium",
                "outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:text-muted-foreground",
                active ? "border-primary-text bg-primary-soft text-text" : "bg-surface-raised",
              )}
            >
              {active ? <Check className="size-4 text-primary-text" aria-hidden /> : null}
              <span className="uppercase">{code}</span>
            </button>
          );
        })}
      </div>
    </fieldset>
  );
}
