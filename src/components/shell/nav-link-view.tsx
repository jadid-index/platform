import {
  Award,
  ClipboardCheck,
  PlusCircle,
  ShieldCheck,
  Trophy,
  UserRoundCheck,
  type LucideIcon,
} from "lucide-react";
import Link from "next/link";

import { cn } from "@/lib/utils";

const ICONS = {
  leaderboard: Trophy,
  achievements: Award,
  add: PlusCircle,
  review: ClipboardCheck,
  onboarding: UserRoundCheck,
  admin: ShieldCheck,
} satisfies Record<string, LucideIcon>;

export type NavIcon = keyof typeof ICONS;
// pill: inline in the floating bar (lg and up); sheet: full-width rows in the mobile menu.
export type NavLayout = "pill" | "sheet";

export type NavLinkProps = { href: string; label: string; icon: NavIcon; layout: NavLayout };

const LAYOUTS: Record<NavLayout, { base: string; active: string; idle: string; icon: string }> = {
  pill: {
    base: "h-10 gap-2 rounded-full px-4 text-small font-semibold",
    active: "bg-primary text-primary-contrast shadow-card",
    idle: "text-muted-foreground hover:bg-muted hover:text-text",
    icon: "size-4",
  },
  sheet: {
    base: "h-12 gap-3 rounded-xl px-4 text-body font-semibold",
    active: "bg-primary text-primary-contrast",
    idle: "text-text hover:bg-muted",
    icon: "size-5",
  },
};

// Presentational nav link. Server-safe: the active state is passed in. The icon always has its text label;
// the active link is marked by fill, weight and aria-current, not by color alone.
export function NavLinkView({ href, label, icon, layout, active = false }: NavLinkProps & { active?: boolean }) {
  const Icon = ICONS[icon];
  const style = LAYOUTS[layout];
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={cn(
        "flex items-center whitespace-nowrap outline-none transition-colors",
        "focus-visible:ring-[3px] focus-visible:ring-ring/50",
        style.base,
        active ? style.active : style.idle,
      )}
    >
      <Icon className={cn("shrink-0", style.icon)} aria-hidden />
      {label}
    </Link>
  );
}
