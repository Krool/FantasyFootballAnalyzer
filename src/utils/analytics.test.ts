import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Analytics, trackEvent } from './analytics';

beforeEach(() => {
  // Each test installs its own gtag; clean slate avoids cross-test leakage.
  delete (window as { gtag?: unknown }).gtag;
});

describe('trackEvent', () => {
  it('forwards to window.gtag when present', () => {
    const gtag = vi.fn();
    window.gtag = gtag;

    trackEvent('hello', { foo: 'bar' });

    expect(gtag).toHaveBeenCalledWith('event', 'hello', { foo: 'bar' });
  });

  it('is a no-op when window.gtag is missing', () => {
    expect(() => trackEvent('hello', { foo: 'bar' })).not.toThrow();
  });

  it('passes undefined params through unchanged', () => {
    const gtag = vi.fn();
    window.gtag = gtag;

    trackEvent('plain');

    expect(gtag).toHaveBeenCalledWith('event', 'plain', undefined);
  });
});

describe('Analytics named helpers', () => {
  it('leagueConnected emits platform only (no league id, for privacy)', () => {
    const gtag = vi.fn();
    window.gtag = gtag;

    Analytics.leagueConnected('sleeper', 'L1');

    expect(gtag).toHaveBeenCalledWith('event', 'league_connected', {
      platform: 'sleeper',
    });
  });

  it('connectAttempt emits platform only', () => {
    const gtag = vi.fn();
    window.gtag = gtag;

    Analytics.connectAttempt('espn');

    expect(gtag).toHaveBeenCalledWith('event', 'connect_attempt', {
      platform: 'espn',
    });
  });

  it('connectError emits platform and a coarse error_type, no message text', () => {
    const gtag = vi.fn();
    window.gtag = gtag;

    Analytics.connectError('yahoo', 'auth_expired');

    expect(gtag).toHaveBeenCalledWith('event', 'connect_error', {
      platform: 'yahoo',
      error_type: 'auth_expired',
    });
  });

  it('pdfExported emits report_type', () => {
    const gtag = vi.fn();
    window.gtag = gtag;
    Analytics.pdfExported('draft');
    expect(gtag).toHaveBeenCalledWith('event', 'pdf_exported', { report_type: 'draft' });
  });

  it('pageView carries the query string for campaign attribution', () => {
    const gtag = vi.fn();
    window.gtag = gtag;
    window.history.replaceState(null, '', '/rankings?utm_source=reddit&utm_medium=post');

    Analytics.pageView('/rankings');

    expect(gtag).toHaveBeenCalledWith('event', 'page_view', {
      page_path: '/rankings?utm_source=reddit&utm_medium=post',
      page_location: `${window.location.origin}/rankings?utm_source=reddit&utm_medium=post`,
      page_title: document.title,
    });
    window.history.replaceState(null, '', '/');
  });

  it('pageView drops the share-link league id but keeps campaign params', () => {
    const gtag = vi.fn();
    window.gtag = gtag;
    window.history.replaceState(null, '', '/rankings?league=sleeper:1234567890&utm_source=reddit');

    Analytics.pageView('/rankings');

    expect(gtag).toHaveBeenCalledWith('event', 'page_view', {
      page_path: '/rankings?utm_source=reddit',
      page_location: `${window.location.origin}/rankings?utm_source=reddit`,
      page_title: document.title,
    });
    window.history.replaceState(null, '', '/');
  });

  it('pageView strips the query string on OAuth-return routes', () => {
    const gtag = vi.fn();
    window.gtag = gtag;
    window.history.replaceState(null, '', '/yahoo-success?state=abc123');

    Analytics.pageView('/yahoo-success');

    expect(gtag).toHaveBeenCalledWith('event', 'page_view', {
      page_path: '/yahoo-success',
      page_location: `${window.location.origin}/yahoo-success`,
      page_title: document.title,
    });
    window.history.replaceState(null, '', '/');
  });

  it('every helper silently no-ops when gtag is absent', () => {
    // Sanity check that the wrapper never throws even when the analytics
    // script failed to load (e.g., behind an ad blocker).
    expect(() => {
      Analytics.leagueConnected('espn', 'L1');
      Analytics.connectAttempt('sleeper');
      Analytics.connectError('sleeper', 'network');
      Analytics.pdfExported('teams');
      Analytics.pageView('/rankings');
    }).not.toThrow();
  });
});
