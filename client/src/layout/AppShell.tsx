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
