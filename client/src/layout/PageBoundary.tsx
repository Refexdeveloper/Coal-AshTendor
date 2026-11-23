import { Component, type ReactNode } from "react";
import { isStaleBuildError, reloadForNewBuild } from "@client/utils/stale-build";

export default function MainError({ error, reset }: { error: Error; reset: () => void }) {
  const stale = isStaleBuildError(error);
  return (
    <section className="panel stack">
      <h1>{stale ? "A new version of the app is available" : "This page could not be loaded"}</h1>
      <p>{stale ? "The app was updated while this page was open. Reload to continue." : error.message}</p>
      <button className="btn" onClick={() => (stale ? window.location.reload() : reset())}>
        {stale ? "Reload" : "Try again"}
      </button>
    </section>
  );
}

/** Catches render errors in one page so the shell and navigation stay usable. */
export class PageBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error) {
    // A screen from before the last deploy: reload onto the new version instead of showing the error.
    if (isStaleBuildError(error)) reloadForNewBuild();
  }

  render() {
    if (this.state.error) return <MainError error={this.state.error} reset={() => this.setState({ error: null })} />;
    return this.props.children;
  }
}
