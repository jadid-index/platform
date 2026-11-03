"use client";

import { Menu, X } from "lucide-react";
import { useState, type ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { Sheet, SheetClose, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { t } from "@/i18n";

// Menu below lg: the pill shows only the logo and this button; the full-width sheet holds the links, the account
// actions and the language and theme choices. Server-rendered parts are passed in. Following any link closes it.
export function MobileNav({
  header,
  links,
  account,
  settings,
}: {
  header: ReactNode;
  links: ReactNode;
  account: ReactNode;
  settings: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const closeOnLink = (event: React.MouseEvent) => {
    if ((event.target as HTMLElement).closest("a")) setOpen(false);
  };
  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button variant="ghost" size="icon-lg" className="rounded-full lg:hidden" aria-label={t.nav.openMenu}>
          <Menu className="size-5" aria-hidden />
        </Button>
      </SheetTrigger>
      <SheetContent
        side="top"
        showCloseButton={false}
        className="max-h-dvh gap-0 overflow-y-auto rounded-b-3xl border-b bg-surface-raised p-0 shadow-raised"
      >
        <SheetHeader className="flex-row items-center justify-between px-4 pt-4 pb-2">
          <SheetTitle className="sr-only">{t.nav.menuTitle}</SheetTitle>
          {header}
          <SheetClose asChild>
            <Button variant="ghost" size="icon-lg" className="rounded-full" aria-label={t.nav.closeMenu}>
              <X className="size-5" aria-hidden />
            </Button>
          </SheetClose>
        </SheetHeader>
        <nav aria-label={t.nav.main} className="grid gap-1 px-3 py-2" onClickCapture={closeOnLink}>
          {links}
        </nav>
        <div className="grid gap-5 border-t px-4 pt-4 pb-6" onClickCapture={closeOnLink}>
          {account}
          {settings}
        </div>
      </SheetContent>
    </Sheet>
  );
}
