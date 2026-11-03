// Leaderboard layouts. A view changes only how the rows are laid out: the data, the public order
// (tier, then name) and the cache are the same for every view (rule 11). A new view = one entry here plus
// its renderer in components/leaderboard/leaderboard-rows.tsx.
export const LEADERBOARD_VIEWS = ["tiers", "list"] as const;
export type LeaderboardView = (typeof LEADERBOARD_VIEWS)[number];
export const DEFAULT_VIEW: LeaderboardView = "tiers";

export function parseView(value: unknown): LeaderboardView {
  return typeof value === "string" && (LEADERBOARD_VIEWS as readonly string[]).includes(value)
    ? (value as LeaderboardView)
    : DEFAULT_VIEW;
}
