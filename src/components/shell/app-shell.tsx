import { Suspense, type ReactNode } from "react";

import { t } from "@/i18n";

import { AccountArea, DrawerAuthLinks } from "./account-area";
import { LanguageSwitch } from "./language-switch";
import { Logo } from "./logo";
import { MobileNav } from "./mobile-nav";
import { NavLinks, NavLinksFallback } from "./nav-links";

// Frame for every page. Below lg: a top bar with a menu drawer. From lg up: a fixed left sidebar plus the top bar.
// The parts that depend on the signed-in user stream in behind Suspense, so the frame itself stays static.
export function AppShell({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-dvh">
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-64 flex-col border-r bg-surface-raised lg:flex">
        <div className="flex h-16 items-center border-b px-5">
          <Logo />
        </div>
        <nav aria-label={t.nav.main} className="grid content-start gap-1 overflow-y-auto p-3">
          <Suspense fallback={<NavLinksFallback />}>
            <NavLinks />
          </Suspense>
        </nav>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col lg:pl-64">
        <header className="sticky top-0 z-20 flex h-16 items-center gap-2 border-b bg-surface/90 px-4 backdrop-blur lg:px-8">
          <MobileNav
            header={<Logo />}
            footer={
              <Suspense fallback={null}>
                <DrawerAuthLinks />
              </Suspense>
            }
          >
            <Suspense fallback={<NavLinksFallback />}>
              <NavLinks />
            </Suspense>
          </MobileNav>
          <div className="lg:hidden">
            <Logo />
          </div>
          <div className="ml-auto flex items-center gap-1 sm:gap-2">
            <LanguageSwitch />
            <Suspense fallback={<div className="h-9 w-20" aria-hidden />}>
              <AccountArea />
            </Suspense>
          </div>
        </header>

        <main className="mx-auto flex w-full max-w-content flex-1 flex-col gap-6 px-4 py-6 lg:px-8 lg:py-10">
          {children}
        </main>
      </div>
    </div>
  );
}
