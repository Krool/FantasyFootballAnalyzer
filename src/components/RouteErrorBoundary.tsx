import { Component, type ErrorInfo, type ReactNode } from 'react';
import { logger } from '@/utils/logger';
import { captureError, captureMessage } from '@/utils/sentry';
import { attemptedChunkUrls, probeChunks, summarizeProbe } from '@/utils/chunkProbe';

interface Props {
  children: ReactNode;
  // Changes (e.g. the current pathname) reset the boundary, so navigating
  // away from a crashed page recovers without a full reload.
  resetKey: string;
}

interface State {
  hasError: boolean;
  error: Error | null;
  /** Which chunk failed and how, once the probe finishes (chunk failures only). */
  diagnosis: string | null;
}

// A dynamic import that 404s after a redeploy (stale chunk hashes on gh-pages)
// needs a reload, not a retry. Each browser phrases the failure differently:
// Chrome "Failed to fetch dynamically imported module", Firefox "error loading
// dynamically imported module", Safari "Importing a module script failed",
// plus webpack-era "Loading chunk N failed".
function isChunkFailure(error: Error | null): boolean {
  return /(failed to fetch|error loading) dynamically imported module|importing a module script failed|loading chunk/i.test(
    error?.message ?? '',
  );
}

// Per-route boundary: a render crash inside one page must not take down the
// header, the loaded league, or an in-progress draft session. The app-level
// ErrorBoundary stays as the last resort.
export class RouteErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null, diagnosis: null };
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
    // Reaching this screen means the stale-chunk reloads already ran out, so
    // the failure is not a passing redeploy. Find out which file and why:
    // the browser's own message rarely says, and Sentry drops it as noise.
    if (isChunkFailure(error)) void this.diagnose();
  }

  private async diagnose() {
    try {
      const results = await probeChunks(attemptedChunkUrls());
      const diagnosis = summarizeProbe(results);
      if (this.state.hasError) this.setState({ diagnosis });
      // Worded to stay clear of sentry.ts's BENIGN_ERROR filter, which would
      // drop anything echoing the browser's chunk-failure strings.
      captureMessage(`Route chunk import diagnosis: ${results.filter(r => r.problem).length} of ${results.length} files bad`, 'error', {
        resetKey: this.props.resetKey,
        userAgent: navigator.userAgent,
        results,
      });
    } catch {
      // Diagnostics are best-effort; the Reload button still works.
    }
  }

  componentDidUpdate(prevProps: Props) {
    if (prevProps.resetKey !== this.props.resetKey && this.state.hasError) {
      this.setState({ hasError: false, error: null, diagnosis: null });
    }
  }

  render() {
    if (this.state.hasError) {
      const { error, diagnosis } = this.state;
      const chunkFailure = isChunkFailure(error);
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
              ? 'Part of the app did not load. Either the connection dropped it or a new version shipped while you were here. Reload to pick it up.'
              : error?.message || 'An unexpected error occurred.'}{' '}
            Your league data and any draft in progress are safe.
          </p>
          <button
            type="button"
            onClick={() =>
              chunkFailure ? window.location.reload() : this.setState({ hasError: false, error: null, diagnosis: null })
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
          {chunkFailure && diagnosis && (
            <pre
              style={{
                marginTop: '1.5rem',
                maxWidth: 520,
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-word',
                textAlign: 'left',
                color: 'var(--bone-dim)',
                fontFamily: 'var(--font-mono)',
                fontSize: '0.7rem',
              }}
            >
              {diagnosis}
            </pre>
          )}
        </div>
      );
    }

    return this.props.children;
  }
}
