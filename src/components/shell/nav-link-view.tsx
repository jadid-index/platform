import { Award, ClipboardCheck, House, PlusCircle, Trophy, UserRoundCheck, type LucideIcon } from "lucide-react";
import Link from "next/link";

import { cn } from "@/lib/utils";

const ICONS = {
  home: House,
  leaderboard: Trophy,
  achievements: Award,
  add: PlusCircle,
  review: ClipboardCheck,
  onboarding: UserRoundCheck,
} satisfies Record<string, LucideIcon>;

export type NavIcon = keyof typeof ICONS;

export type NavLinkProps = { href: string; label: string; icon: NavIcon };

// Presentational sidebar link. Server-safe: the active state is passed in, not read from the URL.
export function NavLinkView({ href, label, icon, active = false }: NavLinkProps & { active?: boolean }) {
  const Icon = ICONS[icon];
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={cn(
        "flex items-center gap-3 rounded-lg px-3 py-2 text-small font-medium outline-none transition-colors",
        "focus-visible:ring-[3px] focus-visible:ring-ring/50",
        active ? "bg-primary-soft text-primary-strong" : "text-muted-foreground hover:bg-muted hover:text-text",
      )}
    >
      <Icon className="size-4.5 shrink-0" aria-hidden />
      {label}
    </Link>
  );
}
