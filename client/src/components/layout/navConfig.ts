import { CREATOR_ROLES } from "@client/lib/labels";

/** `roles` limits an entry to those roles; entries without it show for everyone. */
export const NAV: { href: string; label: string; icon: string; roles?: string[] }[] = [
  { href: "/", label: "Pipeline", icon: "grid" },
  { href: "/worklist", label: "My worklist", icon: "check" },
  { href: "/register", label: "Tender register", icon: "list" },
  { href: "/tenders/new", label: "New tender", icon: "plus", roles: CREATOR_ROLES },
  { href: "/reports", label: "Reports", icon: "chart" },
  { href: "/notifications", label: "Notifications", icon: "bell" },
  { href: "/portals", label: "Portals", icon: "globe", roles: ["ADMIN", "COORDINATOR", "REVIEWER"] },
  { href: "/admin", label: "Administration", icon: "gear", roles: ["ADMIN"] },
];

export function navFor(role: string) {
  return NAV.filter((item) => !item.roles || item.roles.includes(role));
}

export function navTitle(pathname: string) {
  if (pathname.startsWith("/tenders/") && pathname !== "/tenders/new") return "Tender record";
  const match = NAV.find((item) => (item.href === "/" ? pathname === "/" : pathname.startsWith(item.href)));
  return match?.label ?? "Coal & Ash";
}
