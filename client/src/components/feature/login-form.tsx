import { useActionState, useEffect } from "react";
import { useSearchParams } from "react-router-dom";
import { loginAction } from "@client/api/actions";
import type { ActionState } from "@client/api/action-state";
import { Submit } from "@client/components/base/submit";

export function LoginForm() {
  const [search] = useSearchParams();
  const [state, action] = useActionState(loginAction, null as ActionState);
  // A full load so the shell fetches the new session from scratch.
  useEffect(() => {
    if (!state?.ok) return;
    const next = search.get("next") || "/";
    window.location.assign(next.startsWith("/") && !next.startsWith("//") ? next : "/");
  }, [state, search]);
  return (
    <form action={action} className="panel form-grid">
      {state?.error ? <p className="banner bad wide">{state.error}</p> : null}
      <label>
        Email
        <input name="email" type="email" autoComplete="username" required />
      </label>
      <label>
        Password
        <input name="password" type="password" autoComplete="current-password" required />
      </label>
      <div className="wide">
        <Submit>Sign in</Submit>
      </div>
    </form>
  );
}
