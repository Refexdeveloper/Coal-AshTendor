import { useEffect } from "react";
import { Navigate, useSearchParams } from "react-router-dom";
import { ApiError, useApi } from "@client/api/client";
import { LoginForm } from "@client/components/feature/login-form";
import { Loading } from "@client/components/base/loading";

function safeNext(value: string | null, fallback: string) {
  return value && value.startsWith("/") && !value.startsWith("//") ? value : fallback;
}

export default function LoginPage() {
  const [search] = useSearchParams();
  const session = useApi<unknown>("/me");
  useEffect(() => {
    if (session.data || !session.error) return;
    if (session.error instanceof ApiError && session.error.status === 401) window.location.assign("/auth/refexone/launch");
  }, [session.data, session.error]);
  if (search.get("admin") === "1") return <Navigate to={`/admin/login?next=${encodeURIComponent(safeNext(search.get("next"), "/admin"))}`} replace />;
  const next = safeNext(search.get("next"), "/");
  if (session.data) return <Navigate to={next} replace />;
  if (!session.error) return <Loading />;
  if (session.error instanceof ApiError && session.error.status === 401) {
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
          </section>
        </div>
      </main>
    );
  }
  return (
    <main className="login">
      <section className="panel stack">
        <h1>The server could not be reached</h1>
        <p>{session.error.message}</p>
      </section>
    </main>
  );
}

/** Password sign-in. Not linked from the Refex One page. */
export function AdminLoginPage() {
  const [search] = useSearchParams();
  const session = useApi<unknown>("/me");
  const next = safeNext(search.get("next"), "/admin");
  if (session.data) return <Navigate to={next} replace />;
  if (!session.error) return <Loading />;
  return (
    <main className="login">
      <div className="login-card">
        <LoginForm defaultNext="/admin" />
      </div>
    </main>
  );
}
