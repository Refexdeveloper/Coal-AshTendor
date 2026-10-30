import { Link } from "react-router-dom";
import { useLocation } from "react-router-dom";
import { logoutAction } from "@client/lib/actions";
import { ROLES } from "@client/lib/labels";
import { navFor } from "./navConfig";
import { NavIcon } from "./NavIcon";
import { initials } from "./Topbar";

export function Sidebar({
  user,
  openTasks,
  onNavigate,
}: {
  user: { name: string; role: string; email: string };
  openTasks: number;
  onNavigate?: () => void;
}) {
  const { pathname } = useLocation();
  const role = ROLES[user.role] ?? user.role;
  return (
    <div className="sidebar-inner">
      <div className="brand">
        <span className="mark">CA</span>
        <span className="brand-copy">
          <strong>Coal & Ash</strong>
          <small>Tender management</small>
        </span>
      </div>
      <nav>
        <p className="nav-kicker">{role}</p>
        {navFor(user.role).map((item) => {
          const active = item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);
          return (
            <Link key={item.href} to={item.href} className={active ? "active" : ""} title={item.label} onClick={onNavigate}>
              <NavIcon name={item.icon} />
              <span className="nav-label">{item.label}</span>
              {item.href === "/worklist" && openTasks > 0 ? <span className="nav-badge">{openTasks}</span> : null}
            </Link>
          );
        })}
      </nav>
      <div className="who">
        <span className="avatar" aria-hidden>
          {initials(user.name)}
        </span>
        <span className="who-copy">
          <strong>{user.name}</strong>
          <span>{role}</span>
        </span>
        <form action={logoutAction}>
          <button className="icon-btn" type="submit" title="Sign out" aria-label="Sign out">
            <NavIcon name="logout" />
          </button>
        </form>
      </div>
    </div>
  );
}
