/** The side menu the Group CEO sees. Every login gets this same list, including Portals. */
const CEO_MENU = ["/", "/worklist", "/register", "/bonds", "/guarantees", "/reports/users", "/reports", "/notifications", "/portals"];

export const NAV: { href: string; label: string; icon: string }[] = [
  { href: "/", label: "Pipeline", icon: "grid" },
  { href: "/worklist", label: "My worklist", icon: "check" },
  { href: "/register", label: "Tender register", icon: "list" },
  { href: "/bonds", label: "ISB bonds", icon: "shield" },
  { href: "/guarantees", label: "Bank guarantees", icon: "bank" },
  { href: "/reports/users", label: "User report", icon: "users" },
  { href: "/reports", label: "Reports", icon: "chart" },
  { href: "/notifications", label: "Notifications", icon: "bell" },
  { href: "/portals", label: "Portals", icon: "globe" },
];

export function navFor(_role: string) {
  return NAV.filter((item) => CEO_MENU.includes(item.href));
}

export function navTitle(pathname: string) {
  if (pathname.startsWith("/tenders/") && pathname !== "/tenders/new") return "Tender record";
  if (pathname.startsWith("/guarantees/")) return "Bank guarantee";
  if (pathname.startsWith("/bonds/")) return "Surety bond";
  const match = NAV.find((item) => (item.href === "/" ? pathname === "/" : pathname.startsWith(item.href)));
  return match?.label ?? "Coal & Ash";
}
