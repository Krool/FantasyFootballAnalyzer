// Google Analytics event tracking utilities for Fantasy Football Analyzer

declare global {
  interface Window {
    gtag?: (...args: unknown[]) => void;
  }
}

export function trackEvent(eventName: string, params?: Record<string, unknown>) {
  // A local dev server must not pollute the production GA property (Sentry is
  // PROD-gated the same way). Checked via MODE, not PROD, so the test env -
  // which stubs gtag and asserts calls - stays live.
  if (import.meta.env.MODE === "development") return;
  if (typeof window !== "undefined" && window.gtag) {
    window.gtag("event", eventName, params);
  }
}

// Fantasy Football Analyzer specific events
export const Analytics = {
  // Track league connected. Only the platform, never the league id: the raw id
  // re-identifies which specific league a visitor analyzed, which the
  // "anonymized" privacy promise forbids. The id param stays in the signature so
  // call sites don't change, but it is deliberately not sent.
  leagueConnected: (platform: string, _leagueId?: string) => {
    trackEvent("league_connected", {
      platform, // 'espn', 'sleeper', 'yahoo'
    });
  },

  // Track a connect funnel entry: the form submit (Sleeper/ESPN) or the
  // Yahoo login click. Platform only, same privacy rule as leagueConnected.
  connectAttempt: (platform: string) => {
    trackEvent("connect_attempt", {
      platform,
    });
  },

  // Track a failed connect. error_type is a coarse class, never the raw
  // error text or league id: not_found | private_league | auth_expired |
  // network | rate_limited | other.
  connectError: (platform: string, errorType: string) => {
    trackEvent("connect_error", {
      platform,
      error_type: errorType,
    });
  },

  // Track PDF export
  pdfExported: (reportType: string) => {
    trackEvent("pdf_exported", {
      report_type: reportType,
    });
  },

  // SPA page_view. gtag's automatic page_view is off (send_page_view:false in
  // index.html) because its page_location is the raw URL, which on the
  // /yahoo-success OAuth return carries tokens. We rebuild the location
  // ourselves: pathname plus - except on the OAuth-return routes - the query
  // string, so campaign attribution (?utm_*) works while credentials never
  // reach Google Analytics. The hash is never sent on any route.
  pageView: (path: string) => {
    const search =
      typeof window !== "undefined" && !path.startsWith("/yahoo-") ? window.location.search : "";
    trackEvent("page_view", {
      page_path: path + search,
      page_location: (typeof window !== "undefined" ? window.location.origin : "") + path + search,
      page_title: typeof document !== "undefined" ? document.title : undefined,
    });
  },
};
