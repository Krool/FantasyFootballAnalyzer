import { Component, type ErrorInfo, type ReactNode } from 'react';
import { logger } from '@/utils/logger';
import { captureError } from '@/utils/sentry';

interface Props {
  children: ReactNode;
  // Changes (e.g. the current pathname) reset the boundary, so navigating
  // away from a crashed page recovers without a full reload.
  resetKey: string;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

// Per-route boundary: a render crash inside one page must not take down the
// header, the loaded league, or an in-progress draft session. The app-level
// ErrorBoundary stays as the last resort.
export class RouteErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    logger.error('RouteErrorBoundary caught:', error, errorInfo);
    captureError(error, {
      boundary: 'route',
      resetKey: this.props.resetKey,
      componentStack: errorInfo.componentStack,
    });
  }

  componentDidUpdate(prevProps: Props) {
    if (prevProps.resetKey !== this.props.resetKey && this.state.hasError) {
      this.setState({ hasError: false, error: null });
    }
  }

  render() {
    if (this.state.hasError) {
      const error = this.state.error;
      // A dynamic import that 404s after a redeploy (stale chunk hashes on
      // gh-pages) needs a reload, not a retry. Each browser phrases the failure
      // differently: Chrome "Failed to fetch dynamically imported module",
      // Firefox "error loading dynamically imported module", Safari "Importing
      // a module script failed", plus webpack-era "Loading chunk N failed".
      const chunkFailure =
        /(failed to fetch|error loading) dynamically imported module|importing a module script failed|loading chunk/i.test(
          error?.message ?? '',
        );
      return (
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '4rem 2rem',
            textAlign: 'center',
            color: 'var(--bone)',
            fontFamily: 'var(--font-display)',
          }}
        >
          <h2
            style={{
              fontFamily: 'var(--font-headline)',
              fontSize: '2.2rem',
              textTransform: 'uppercase',
              lineHeight: 0.85,
              marginBottom: '1rem',
            }}
          >
            This page broke.
          </h2>
          <p style={{ color: 'var(--bone-dim)', fontStyle: 'italic', marginBottom: '1.5rem', maxWidth: 520 }}>
            {chunkFailure
              ? 'A new version of the app was deployed while you were here. Reload to pick it up.'
              : error?.message || 'An unexpected error occurred.'}{' '}
            Your league data and any draft in progress are safe.
          </p>
          <button
            type="button"
            onClick={() =>
              chunkFailure ? window.location.reload() : this.setState({ hasError: false, error: null })
            }
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
            {chunkFailure ? 'Reload' : 'Try Again'}
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}
