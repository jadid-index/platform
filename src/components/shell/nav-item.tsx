"use client";

import { usePathname } from "next/navigation";

import { NavLinkView, type NavLinkProps } from "./nav-link-view";

// The leaderboard link is also active on public profiles (they are opened from the leaderboard).
function isActive(pathname: string, href: string): boolean {
  if (href === "/leaderboard" && pathname.startsWith("/students/")) return true;
  if (href === "/talent" && pathname.startsWith("/talent/requests")) return false;
  return pathname === href || pathname.startsWith(`${href}/`);
}

// Nav link that marks itself on the current page. Render it inside <Suspense>: the URL is runtime data.
// match: the path prefix that counts as active (default: href), e.g. "/admin" for every admin section.
export function NavItem({ match, ...props }: NavLinkProps & { match?: string }) {
  const pathname = usePathname();
  return <NavLinkView {...props} active={isActive(pathname, match ?? props.href)} />;
}
