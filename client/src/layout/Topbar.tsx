import { useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { logoutAction } from "@client/api/actions";
import { roleTitle } from "@client/lib/labels";
import { navTitle } from "./navConfig";
import { NavIcon } from "./NavIcon";

/** The Refex One portal people come from, as in the P2P app. The back button returns there. */
const REFEX_ONE_URL = "https://refexone.com";
const REFEX_ONE_LOGO = "https://refexone.com/refexone-logo.png";

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
  const role = roleTitle(user);
  return (
    <header className="topbar">
      <button className="icon-btn menu-btn" type="button" onClick={onMenu} aria-label="Open navigation">
        <NavIcon name="menu" />
      </button>
      <a className="refex-back" href={REFEX_ONE_URL} title="Back to Refex One" aria-label="Back to Refex One">
        <span className="refex-back-arrow" aria-hidden>
          ←
        </span>
        <img src={REFEX_ONE_LOGO} alt="" onError={(event) => (event.currentTarget.style.display = "none")} />
        <span className="refex-back-text">Refex One</span>
      </a>
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
              <a className="user-menu-link" href={REFEX_ONE_URL}>
                ← Back to Refex One
              </a>
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
