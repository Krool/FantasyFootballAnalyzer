import { Component, type ErrorInfo, type ReactNode } from 'react';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('ErrorBoundary caught:', error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          minHeight: '100vh',
          padding: '2rem',
          textAlign: 'center',
          color: 'var(--bone)',
          backgroundColor: 'var(--ink)',
          fontFamily: 'var(--font-display)',
        }}>
          <h1 style={{
            fontFamily: 'var(--font-headline)',
            fontSize: '3rem',
            textTransform: 'uppercase',
            lineHeight: 0.85,
            marginBottom: '1rem',
          }}>Something<br/>Broke.</h1>
          <p style={{ color: 'var(--bone-dim)', fontStyle: 'italic', marginBottom: '1.5rem', maxWidth: '500px' }}>
            {this.state.error?.message || 'An unexpected error occurred.'}
          </p>
          <button
            onClick={() => window.location.reload()}
            style={{
              padding: '0.7rem 1.4rem',
              border: '2px solid var(--lime)',
              background: 'var(--lime)',
              color: 'var(--ink)',
              fontFamily: 'var(--font-mono)',
              fontWeight: 700,
              fontSize: '0.78rem',
              textTransform: 'uppercase',
              letterSpacing: '0.18em',
              boxShadow: '4px 4px 0 var(--bone)',
              cursor: 'pointer',
            }}
          >
            Reload Page
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}
