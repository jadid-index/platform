"use client";

import { usePathname } from "next/navigation";

import { NavLinkView, type NavLinkProps } from "./nav-link-view";

// The leaderboard link is also active on public profiles (they are opened from the leaderboard).
function isActive(pathname: string, href: string): boolean {
  if (href === "/leaderboard" && pathname.startsWith("/students/")) return true;
  return pathname === href || pathname.startsWith(`${href}/`);
}

// Sidebar link that highlights itself on the current page. Render it inside <Suspense>: the URL is runtime data.
export function NavItem(props: NavLinkProps) {
  const pathname = usePathname();
  return <NavLinkView {...props} active={isActive(pathname, props.href)} />;
}
