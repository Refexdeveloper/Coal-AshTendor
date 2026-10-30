import { useEffect } from "react";
import { Outlet, useLocation } from "react-router-dom";
import { AppShell } from "@client/components/layout/AppShell";
import { Loading } from "@client/components/base/loading";
import { useApi } from "@client/lib/api";
import { SessionContext, type Session } from "@client/lib/session";
import { PageBoundary } from "./main-error";

export default function MainLayout() {
  const { data, error, reload } = useApi<Session>("/me");
  const { pathname } = useLocation();
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [pathname]);
  if (!data) {
    return error ? (
      <main className="login">
        <section className="panel stack">
          <h1>The server could not be reached</h1>
          <p>{error.message}</p>
          <button className="btn" onClick={() => void reload()}>
            Try again
          </button>
        </section>
      </main>
    ) : (
      <Loading />
    );
  }
  return (
    <SessionContext.Provider value={data}>
      <AppShell user={data.user} openTasks={data.openTasks}>
        <PageBoundary key={pathname}>
          <Outlet />
        </PageBoundary>
      </AppShell>
    </SessionContext.Provider>
  );
}
