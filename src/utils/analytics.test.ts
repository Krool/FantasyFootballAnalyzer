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

  it('draftAnalyzed emits team_count', () => {
    const gtag = vi.fn();
    window.gtag = gtag;
    Analytics.draftAnalyzed(12);
    expect(gtag).toHaveBeenCalledWith('event', 'draft_analyzed', { team_count: 12 });
  });

  it('tradeAnalyzed emits trade_count', () => {
    const gtag = vi.fn();
    window.gtag = gtag;
    Analytics.tradeAnalyzed(5);
    expect(gtag).toHaveBeenCalledWith('event', 'trade_analyzed', { trade_count: 5 });
  });

  it('pdfExported emits report_type', () => {
    const gtag = vi.fn();
    window.gtag = gtag;
    Analytics.pdfExported('draft');
    expect(gtag).toHaveBeenCalledWith('event', 'pdf_exported', { report_type: 'draft' });
  });

  it('every helper silently no-ops when gtag is absent', () => {
    // Sanity check that the wrapper never throws even when the analytics
    // script failed to load (e.g., behind an ad blocker).
    expect(() => {
      Analytics.leagueConnected('espn', 'L1');
      Analytics.draftAnalyzed(10);
      Analytics.tradeAnalyzed(3);
      Analytics.waiversAnalyzed(100);
      Analytics.teamViewed('t1');
      Analytics.pdfExported('teams');
      Analytics.pageViewed('home');
    }).not.toThrow();
  });
});
