import { ApiError } from "@client/api/client";

export function Loading() {
  return (
    <p className="panel muted" role="status">
      Loading…
    </p>
  );
}

/** Shown in place of a page whose data could not be fetched. */
export function LoadFailed({ error, retry }: { error: Error; retry: () => void }) {
  return (
    <section className="panel stack">
      <h1>{error instanceof ApiError && error.status === 404 ? "Not found" : "This page could not be loaded"}</h1>
      <p>{error.message}</p>
      <button className="btn" onClick={() => retry()}>
        Try again
      </button>
    </section>
  );
}
