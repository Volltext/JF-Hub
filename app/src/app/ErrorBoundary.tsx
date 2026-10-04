import { Component, type ErrorInfo, type ReactNode } from 'react';

/** Fängt Darstellungsfehler ab, damit nie eine leere weiße Seite bleibt. Daten sind davon nicht betroffen. */
export class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error(error, info.componentStack);
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="lock" role="alert">
        <h1>Hoppla</h1>
        <p className="muted" style={{ textAlign: 'center', maxWidth: 320 }}>
          Da ist etwas schiefgelaufen. Deine Daten sind gespeichert.
        </p>
        <p className="muted" style={{ textAlign: 'center', maxWidth: 320, fontSize: '0.8rem' }}>
          {this.state.error.message}
        </p>
        <button className="btn btn--primary" onClick={() => location.reload()}>
          Neu laden
        </button>
      </div>
    );
  }
}
