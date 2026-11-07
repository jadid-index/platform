import { format, t } from "@/i18n";

import { getPendingRequestCount, getShellViewer } from "./access";
import { NavItem } from "./nav-item";
import { NavLinkView, type NavLayout } from "./nav-link-view";

// Shown while the viewer is looked up. Static (no active state), so it can be prerendered.
export function NavLinksFallback({ layout }: { layout: NavLayout }) {
  return <NavLinkView href="/leaderboard" label={t.nav.leaderboard} icon="leaderboard" layout={layout} />;
}

// The links the viewer's role may open. Display only: every page and API route checks access on the server.
// Home is the logo. Students get /offers, which carries the new-request badge. Employers get the talent directory
// and their sent requests; admins also see the directory.
export async function NavLinks({ layout }: { layout: NavLayout }) {
  const viewer = await getShellViewer();
  const member = viewer.kind === "member" && viewer.active ? viewer : null;
  const isStudent = member?.role === "student";
  const isReviewer = member?.role === "reviewer" || member?.role === "admin";
  const isAdmin = member?.role === "admin";
  const isEmployer = member?.role === "employer";
  const pending = isStudent && member ? await getPendingRequestCount(member.id) : 0;

  return (
    <>
      <NavItem href="/leaderboard" label={t.nav.leaderboard} icon="leaderboard" layout={layout} />
      {viewer.kind === "no-profile" ? (
        <NavItem href="/onboarding" label={t.nav.finishProfile} icon="onboarding" layout={layout} />
      ) : null}
      {isStudent ? (
        <>
          <NavItem href="/dashboard" label={t.nav.myAchievements} icon="achievements" layout={layout} />
          <NavItem
            href="/offers"
            label={t.nav.offers}
            icon="offers"
            layout={layout}
            count={pending}
            countLabel={format(t.nav.newRequests, { n: pending })}
          />
        </>
      ) : null}
      {isEmployer || isAdmin ? <NavItem href="/talent" label={t.nav.talent} icon="talent" layout={layout} /> : null}
      {isEmployer ? <NavItem href="/talent/requests" label={t.nav.myRequests} icon="requests" layout={layout} /> : null}
      {isReviewer ? <NavItem href="/review" label={t.nav.reviewQueue} icon="review" layout={layout} /> : null}
      {isAdmin ? (
        <NavItem href="/admin/users" match="/admin" label={t.nav.admin} icon="admin" layout={layout} />
      ) : null}
    </>
  );
}
