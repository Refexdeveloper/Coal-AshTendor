import { useActionState, useEffect } from "react";
import { loginAction } from "@client/lib/actions";
import type { ActionState } from "@client/lib/action-state";
import { Submit } from "@client/components/base/submit";

export function LoginForm() {
  const [state, action] = useActionState(loginAction, null as ActionState);
  // A full load so the shell fetches the new session from scratch.
  useEffect(() => {
    if (state?.ok) window.location.assign("/");
  }, [state]);
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
