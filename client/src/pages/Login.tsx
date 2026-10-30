import { useEffect } from "react";
import { Navigate, useSearchParams } from "react-router-dom";
import { ROLES } from "@client/lib/labels";
import { ApiError, useApi } from "@client/api/client";
import type { PublicUser } from "@client/lib/types";
import { LoginForm } from "@client/components/feature/login-form";
import { Loading } from "@client/components/base/loading";

export default function LoginPage() {
  const [search] = useSearchParams();
  const admin = search.get("admin") === "1";
  const { data } = useApi<{ users: PublicUser[] }>("/auth/team");
  const session = useApi<unknown>("/me");
  const users = data?.users ?? [];
  useEffect(() => {
    if (admin || session.data || !session.error) return;
    if (session.error instanceof ApiError && session.error.status === 401) window.location.assign("/auth/refexone/launch");
  }, [admin, session.data, session.error]);
  const next = search.get("next") || "/";
  if (session.data) return <Navigate to={next.startsWith("/") && !next.startsWith("//") ? next : "/"} replace />;
  if (!session.error) return <Loading />;
  if (!admin && session.error instanceof ApiError && session.error.status === 401) {
    return (
      <main className="login">
        <div className="login-card">
          <div>
            <p className="lede">Coal & Ash</p>
            <h1>Tender management</h1>
            <p className="lede">Signing in with Refex One.</p>
          </div>
          <section className="panel stack">
            <a className="btn" href="/auth/refexone/launch">
              Continue with Refex One
            </a>
            <a href="/login?admin=1">Administrator sign-in</a>
          </section>
        </div>
      </main>
    );
  }
  if (!admin) {
    return (
      <main className="login">
        <section className="panel stack">
          <h1>The server could not be reached</h1>
          <p>{session.error.message}</p>
        </section>
      </main>
    );
  }
  return (
    <main className="login">
      <div className="login-card">
        <div>
          <p className="lede">Coal & Ash</p>
          <h1>Administrator sign-in</h1>
          <p className="lede">Password sign-in is for administration. Everyone else signs in with Refex One.</p>
        </div>
        <LoginForm />
        <p>
          <a href="/auth/refexone/launch">Sign in with Refex One</a>
        </p>
        {users.length ? (
          <section className="panel">
            <h2>Team access</h2>
            <p className="muted">Initial password for every account: CoalAsh@2026</p>
            <div className="accounts">
              {users.map((user) => (
                <span key={user.id}>
                  {user.name} · {ROLES[user.role] ?? user.role}
                  <br />
                  {user.email}
                </span>
              ))}
            </div>
          </section>
        ) : null}
      </div>
    </main>
  );
}
