import { useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { logoutAction } from "@client/api/actions";
import { ROLES } from "@client/lib/labels";
import { navTitle } from "./navConfig";
import { NavIcon } from "./NavIcon";

export function Topbar({
  user,
  onMenu,
}: {
  user: { name: string; role: string; email: string };
  onMenu: () => void;
}) {
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const [menuOpen, setMenuOpen] = useState(false);
  const role = ROLES[user.role] ?? user.role;
  return (
    <header className="topbar">
      <button className="icon-btn menu-btn" type="button" onClick={onMenu} aria-label="Open navigation">
        <NavIcon name="menu" />
      </button>
      <div className="topbar-title">
        <p className="crumb">Coal & Ash</p>
        <strong>{navTitle(pathname)}</strong>
      </div>
      <form
        className="top-search"
        action="/register"
        method="get"
        role="search"
        onSubmit={(event) => {
          event.preventDefault();
          const q = String(new FormData(event.currentTarget).get("q") || "").trim();
          navigate(q ? `/register?q=${encodeURIComponent(q)}` : "/register");
        }}
      >
        <NavIcon name="search" />
        <input
          name="q"
          type="search"
          placeholder="Search tenders"
          aria-label="Search tenders by project, client or reference"
        />
      </form>
      <div className="topbar-user">
        <button className="user-btn" type="button" onClick={() => setMenuOpen((open) => !open)}>
          <span className="avatar" aria-hidden>
            {initials(user.name)}
          </span>
          <span>
            <strong>{user.name}</strong>
            <small>{role}</small>
          </span>
        </button>
        {menuOpen ? (
          <>
            <button className="menu-scrim" type="button" aria-label="Close menu" onClick={() => setMenuOpen(false)} />
            <div className="user-menu">
              <div className="user-menu-head">
                <strong>{user.name}</strong>
                <span>{user.email}</span>
                <em>{role}</em>
              </div>
              <form action={logoutAction}>
                <button type="submit">Sign out</button>
              </form>
            </div>
          </>
        ) : null}
      </div>
    </header>
  );
}

export function initials(name: string) {
  return name
    .split(" ")
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
}
