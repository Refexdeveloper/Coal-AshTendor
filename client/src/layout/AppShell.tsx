import { useEffect, useState } from "react";
import { installRipple } from "@client/components/feature/fx";
import { Sidebar } from "./Sidebar";
import { Topbar } from "./Topbar";

export function AppShell({
  user,
  openTasks,
  children,
}: {
  user: { name: string; role: string; email: string };
  openTasks: number;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    installRipple();
  }, []);
  useEffect(() => {
    const root = document.querySelector(".content");
    if (!root) return;
    const stamp = () => {
      root.querySelectorAll("table").forEach((table) => {
        if (table.closest(".bg-letter, .bg-request")) return;
        const heads = [...table.querySelectorAll("thead th")].map((cell) => cell.textContent?.replace(/\s+/g, " ").trim() ?? "");
        if (!heads.some(Boolean)) return;
        table.querySelectorAll("tbody tr").forEach((row) => {
          [...row.children].forEach((cell, index) => {
            if (!(cell instanceof HTMLTableCellElement) || cell.tagName !== "TD") return;
            const label = heads[index] ?? "";
            if (cell.getAttribute("data-label") !== label) cell.setAttribute("data-label", label);
          });
        });
      });
    };
    stamp();
    const observer = new MutationObserver(stamp);
    observer.observe(root, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, []);
  return (
    <div className="shell">
      <aside className="sidebar">
        <Sidebar user={user} openTasks={openTasks} />
      </aside>
      {open ? (
        <div className="drawer">
          <button className="drawer-backdrop" type="button" aria-label="Close navigation" onClick={() => setOpen(false)} />
          <aside className="drawer-panel">
            <Sidebar user={user} openTasks={openTasks} onNavigate={() => setOpen(false)} />
          </aside>
        </div>
      ) : null}
      <div className="main-col">
        <Topbar user={user} onMenu={() => setOpen(true)} />
        <div className="content">{children}</div>
      </div>
    </div>
  );
}
