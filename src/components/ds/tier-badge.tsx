import { format, t, typeName } from "@/i18n";
import type { PublicTier } from "@/lib/types";
import { cn } from "@/lib/utils";

// Fill and ink by tier position (1 = best). Tiers beyond 7 reuse the last pair. Classes are written out in full
// so Tailwind keeps them.
const TONES = [
  "bg-tier-1 text-tier-1-foreground",
  "bg-tier-2 text-tier-2-foreground",
  "bg-tier-3 text-tier-3-foreground",
  "bg-tier-4 text-tier-4-foreground",
  "bg-tier-5 text-tier-5-foreground",
  "bg-tier-6 text-tier-6-foreground",
  "bg-tier-7 text-tier-7-foreground",
];

const SIZES = {
  sm: "h-7 min-w-9 px-1.5 text-small",
  md: "h-full min-w-11 px-1.5 text-h2",
  lg: "h-14 min-w-16 px-3 text-h2",
} as const;

// The tier letter is always visible, in its own font (font-tier) for now; the color only supports it. No tier: a dashed "–".
export function TierBadge({
  tier,
  size = "md",
  className,
}: {
  tier: PublicTier | null;
  size?: keyof typeof SIZES;
  className?: string;
}) {
  const label = tier ? format(t.tiers.badge, { tier: typeName(tier.label) }) : t.tiers.none;
  return (
    <span
      role="img"
      aria-label={label}
      title={label}
      className={cn(
        "inline-flex shrink-0 items-center justify-center rounded-full font-tier font-extrabold tracking-tight ring-1 ring-text/10 ring-inset",
        SIZES[size],
        tier ? TONES[Math.min(tier.sort_order, TONES.length) - 1] : "border border-dashed text-muted-foreground",
        className,
      )}
    >
      <span aria-hidden>{tier ? tier.code : "–"}</span>
    </span>
  );
}
