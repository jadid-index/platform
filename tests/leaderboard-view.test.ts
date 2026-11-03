import { describe, expect, it } from "vitest";

import { DEFAULT_VIEW, LEADERBOARD_VIEWS, parseView } from "@/lib/leaderboard-view";

describe("parseView", () => {
  it("accepts every known view", () => {
    for (const v of LEADERBOARD_VIEWS) expect(parseView(v)).toBe(v);
  });

  it("falls back to the tier view for anything else", () => {
    expect(DEFAULT_VIEW).toBe("tiers");
    for (const v of [undefined, null, "", "ranked", "LIST", ["list"], 1]) expect(parseView(v)).toBe("tiers");
  });
});
