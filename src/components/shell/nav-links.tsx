import { t } from "@/i18n";

import { getShellViewer } from "./access";
import { NavItem } from "./nav-item";
import { NavLinkView } from "./nav-link-view";

function Group({ title, children }: { title?: string; children: React.ReactNode }) {
  return (
    <div className="grid gap-1">
      {title ? (
        <p className="px-3 pt-4 pb-1 text-xs font-semibold tracking-wide text-muted-foreground uppercase">{title}</p>
      ) : null}
      {children}
    </div>
  );
}

// Shown while the viewer is looked up. Static (no active state), so it can be prerendered.
export function NavLinksFallback() {
  return (
    <Group>
      <NavLinkView href="/" label={t.nav.home} icon="home" />
      <NavLinkView href="/leaderboard" label={t.nav.leaderboard} icon="leaderboard" />
    </Group>
  );
}

// Grouped links for the viewer's role. Display only: every page and API route checks access on the server.
export async function NavLinks() {
  const viewer = await getShellViewer();
  const isStudent = viewer.kind === "member" && viewer.active && viewer.role === "student";
  const isReviewer =
    viewer.kind === "member" && viewer.active && (viewer.role === "reviewer" || viewer.role === "admin");

  return (
    <>
      <Group>
        <NavItem href="/" label={t.nav.home} icon="home" />
        <NavItem href="/leaderboard" label={t.nav.leaderboard} icon="leaderboard" />
      </Group>
      {viewer.kind === "no-profile" ? (
        <Group>
          <NavItem href="/onboarding" label={t.nav.finishProfile} icon="onboarding" />
        </Group>
      ) : null}
      {isStudent ? (
        <Group title={t.nav.groupStudent}>
          <NavItem href="/dashboard" label={t.nav.myAchievements} icon="achievements" />
          <NavItem href="/achievements/new" label={t.nav.addAchievement} icon="add" />
        </Group>
      ) : null}
      {isReviewer ? (
        <Group title={t.nav.groupReviewer}>
          <NavItem href="/review" label={t.nav.reviewQueue} icon="review" />
        </Group>
      ) : null}
    </>
  );
}
