import { Component, type ReactNode } from "react";

export class ErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch(error: Error) { console.error("UI error:", error.message); }
  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <div className="mx-auto max-w-md p-10 text-center">
        <h1 className="text-2xl font-bold">Something broke on this page</h1>
        <p className="mt-2 text-muted">Reload to try again. If it keeps happening, contact us.</p>
        <button className="btn-primary mt-6" onClick={() => window.location.reload()}>Reload page</button>
      </div>
    );
  }
}
