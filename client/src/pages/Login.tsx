import { Navigate } from "react-router-dom";
import { ROLES } from "@client/lib/labels";
import { useApi } from "@client/api/client";
import type { PublicUser } from "@client/lib/types";
import { LoginForm } from "@client/components/feature/login-form";

export default function LoginPage() {
  const { data } = useApi<{ users: PublicUser[] }>("/auth/team");
  const session = useApi<unknown>("/me");
  const users = data?.users ?? [];
  if (session.data) return <Navigate to="/" replace />;
  return (
    <main className="login">
      <div className="login-card">
        <div>
          <p className="lede">Coal & Ash</p>
          <h1>Tender management</h1>
          <p className="lede">Sign in with the role that matches the work on your desk.</p>
        </div>
        <LoginForm />
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
