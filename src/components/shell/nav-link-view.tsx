import {
  Award,
  BriefcaseBusiness,
  ClipboardCheck,
  FileUser,
  Handshake,
  Send,
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
  review: ClipboardCheck,
  onboarding: UserRoundCheck,
  admin: ShieldCheck,
  talent: BriefcaseBusiness,
  requests: Send,
  offers: Handshake,
  cv: FileUser,
} satisfies Record<string, LucideIcon>;

export type NavIcon = keyof typeof ICONS;
// pill: inline in the floating bar (lg and up); sheet: full-width rows in the mobile menu.
export type NavLayout = "pill" | "sheet";

// count: a number badge after the label (new contact requests); countLabel is its text for screen readers.
export type NavLinkProps = { href: string; label: string; icon: NavIcon; layout: NavLayout; count?: number; countLabel?: string };

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
export function NavLinkView({
  href,
  label,
  icon,
  layout,
  count,
  countLabel,
  active = false,
}: NavLinkProps & { active?: boolean }) {
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
      {count ? (
        <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-surface-inverse px-1.5 text-xs font-bold text-surface-inverse-foreground tabular">
          <span aria-hidden>{count}</span>
          <span className="sr-only">{countLabel ?? count}</span>
        </span>
      ) : null}
    </Link>
  );
}
