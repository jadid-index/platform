"use client";

import { Languages } from "lucide-react";

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

// Only Uzbek exists for now; Russian and English are listed as coming soon.
const LOCALES = ["uz", "ru", "en"] as const;

export function LanguageSwitch() {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="sm" aria-label={t.nav.language}>
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
