"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { t } from "@/i18n";
import { cn } from "@/lib/utils";

const SECTIONS = [
  { href: "/admin/users", label: t.admin.usersTitle },
  { href: "/admin/audit", label: t.admin.auditTitle },
] as const;

function Links({ pathname }: { pathname: string | null }) {
  return (
    <nav aria-label={t.admin.sectionsLabel} className="flex w-full gap-1 overflow-x-auto rounded-lg bg-muted p-1 sm:w-fit">
      {SECTIONS.map((s) => {
        const active = pathname !== null && (pathname === s.href || pathname.startsWith(`${s.href}/`));
        return (
          <Link
            key={s.href}
            href={s.href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "flex-1 rounded-md px-4 py-1.5 text-center text-small font-medium whitespace-nowrap outline-none transition-colors sm:flex-none",
              "focus-visible:ring-[3px] focus-visible:ring-ring/50",
              active ? "bg-surface-raised text-text shadow-sm" : "text-muted-foreground hover:text-text",
            )}
          >
            {s.label}
          </Link>
        );
      })}
    </nav>
  );
}

// Section tabs for the admin area: full width on phones, compact from sm up.
export function AdminNav() {
  return <Links pathname={usePathname()} />;
}

export function AdminNavFallback() {
  return <Links pathname={null} />;
}
