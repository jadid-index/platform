import { Medal } from "lucide-react";

import { format, t } from "@/i18n";
import { cn } from "@/lib/utils";

const MEDALS: Record<number, string> = {
  1: "bg-rank-gold text-rank-gold-foreground",
  2: "bg-rank-silver text-rank-silver-foreground",
  3: "bg-rank-bronze text-rank-bronze-foreground",
};

// Places 1-3 get a medal fill and icon, the rest a plain number. The number is always visible.
export function RankBadge({ rank, className }: { rank: number; className?: string }) {
  const medal = MEDALS[rank];
  const label = medal
    ? `${format(t.leaderboard.rank, { rank })} (${t.leaderboard.medal[rank]})`
    : format(t.leaderboard.rank, { rank });
  return (
    <span
      role="img"
      aria-label={label}
      className={cn(
        "inline-flex h-8 min-w-8 shrink-0 items-center justify-center gap-0.5 rounded-full px-2 text-small font-semibold tabular",
        medal ?? "text-muted-foreground",
        className,
      )}
    >
      {medal ? <Medal className="size-3.5" aria-hidden /> : null}
      <span aria-hidden>{rank}</span>
    </span>
  );
}
