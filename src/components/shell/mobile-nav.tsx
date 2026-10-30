"use client";

import { Menu, X } from "lucide-react";
import { useState, type ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { Sheet, SheetClose, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { t } from "@/i18n";

// Drawer navigation below lg. The links are rendered on the server and passed in as children.
export function MobileNav({ header, children, footer }: { header: ReactNode; children: ReactNode; footer?: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button variant="ghost" size="icon" className="lg:hidden" aria-label={t.nav.openMenu}>
          <Menu className="size-5" aria-hidden />
        </Button>
      </SheetTrigger>
      <SheetContent side="left" showCloseButton={false} className="w-72 gap-0 bg-surface-raised p-0">
        <SheetHeader className="flex-row items-center justify-between border-b p-4">
          <SheetTitle className="sr-only">{t.nav.menuTitle}</SheetTitle>
          {header}
          <SheetClose asChild>
            <Button variant="ghost" size="icon" aria-label={t.nav.closeMenu}>
              <X className="size-5" aria-hidden />
            </Button>
          </SheetClose>
        </SheetHeader>
        {/* Close the drawer when any link inside it is followed. */}
        <nav
          aria-label={t.nav.main}
          className="grid content-start gap-1 overflow-y-auto p-3"
          onClickCapture={(event) => {
            if ((event.target as HTMLElement).closest("a")) setOpen(false);
          }}
        >
          {children}
        </nav>
        {footer ? (
          <div
            className="mt-auto border-t p-4 empty:hidden"
            onClickCapture={(event) => {
              if ((event.target as HTMLElement).closest("a")) setOpen(false);
            }}
          >
            {footer}
          </div>
        ) : null}
      </SheetContent>
    </Sheet>
  );
}
