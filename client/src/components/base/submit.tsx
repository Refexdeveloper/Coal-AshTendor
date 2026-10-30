import React from "react";

type FormStatus = { pending: boolean };

/**
 * Pending state for a form action. react-dom's useFormStatus reads a second React
 * copy inside Vite's prebundle, so the status comes from the React instance that is rendering.
 */
export function useFormPending(): FormStatus {
  const dispatcher = (
    React as unknown as {
      __CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE: {
        H: { useHostTransitionStatus: () => FormStatus };
      };
    }
  ).__CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE.H;
  return dispatcher.useHostTransitionStatus();
}

export function Submit({
  children,
  variant = "primary",
  name,
  value,
}: {
  children: React.ReactNode;
  variant?: string;
  name?: string;
  value?: string;
}) {
  const { pending } = useFormPending();
  return (
    <button className={`btn ${variant}`} name={name} value={value} disabled={pending}>
      {pending ? "Saving…" : children}
    </button>
  );
}
