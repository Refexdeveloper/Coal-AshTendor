import { Component, type ReactNode } from "react";

export default function MainError({ error, reset }: { error: Error; reset: () => void }) {
  return (
    <section className="panel stack">
      <h1>This page could not be loaded</h1>
      <p>{error.message}</p>
      <button className="btn" onClick={() => reset()}>
        Try again
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

  render() {
    if (this.state.error) return <MainError error={this.state.error} reset={() => this.setState({ error: null })} />;
    return this.props.children;
  }
}
