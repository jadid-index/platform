import { Suspense, type ReactNode } from "react";

import { t } from "@/i18n";

import { AccountArea, SheetAccount } from "./account-area";
import { LanguageChoices, LanguageSwitch } from "./language-switch";
import { Logo } from "./logo";
import { MobileNav } from "./mobile-nav";
import { NavLinks, NavLinksFallback } from "./nav-links";
import { ThemeChoices, ThemeSwitch } from "./theme-switch";

// Frame for every page: a floating pill bar at the top (sticky, a small margin from the edge), no sidebar.
// From lg up the pill holds logo, role links and the language / theme / account controls; below lg it shrinks to
// logo plus a menu button that opens a full-width sheet. /admin adds its own section tabs inside the page.
// The parts that depend on the signed-in user stream in behind Suspense, so the frame itself stays static.
// Sticky, not fixed: on phones the bar scrolls with the page when the keyboard opens and never covers a field.
export function AppShell({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col">
      {/* Same width and side padding as <main>, so the pill lines up with the content. */}
      <header className="sticky top-0 z-40 mx-auto w-full max-w-content px-3 pt-3 sm:px-4 lg:px-8">
        <div className="flex h-14 items-center gap-2 rounded-full border bg-surface-raised/80 pr-2 pl-4 shadow-nav backdrop-blur-md sm:pl-5">
          <Logo />
          <nav aria-label={t.nav.main} className="mx-auto hidden items-center gap-1 lg:flex">
            <Suspense fallback={<NavLinksFallback layout="pill" />}>
              <NavLinks layout="pill" />
            </Suspense>
          </nav>
          <div className="ml-auto hidden items-center gap-1 lg:ml-0 lg:flex">
            <LanguageSwitch />
            <ThemeSwitch />
            <Suspense fallback={<div className="h-10 w-40" aria-hidden />}>
              <AccountArea />
            </Suspense>
          </div>
          <div className="ml-auto lg:hidden">
            <MobileNav
              header={<Logo />}
              links={
                <Suspense fallback={<NavLinksFallback layout="sheet" />}>
                  <NavLinks layout="sheet" />
                </Suspense>
              }
              account={
                <Suspense fallback={null}>
                  <SheetAccount />
                </Suspense>
              }
              settings={
                <div className="grid gap-4 sm:grid-cols-2">
                  <LanguageChoices />
                  <ThemeChoices />
                </div>
              }
            />
          </div>
        </div>
      </header>

      <main className="mx-auto flex w-full max-w-content flex-1 flex-col gap-6 px-4 pt-6 pb-10 lg:px-8 lg:pt-10">
        {children}
      </main>
    </div>
  );
}
