// Google Analytics event tracking utilities for Fantasy Football Analyzer

declare global {
  interface Window {
    gtag?: (...args: unknown[]) => void;
  }
}

export function trackEvent(eventName: string, params?: Record<string, unknown>) {
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

  // Track draft analysis viewed
  draftAnalyzed: (teamCount: number) => {
    trackEvent("draft_analyzed", {
      team_count: teamCount,
    });
  },

  // Track trade analysis
  tradeAnalyzed: (tradeCount: number) => {
    trackEvent("trade_analyzed", {
      trade_count: tradeCount,
    });
  },

  // Track waiver analysis
  waiversAnalyzed: (playerCount: number) => {
    trackEvent("waivers_analyzed", {
      player_count: playerCount,
    });
  },

  // Track team card viewed
  teamViewed: (teamId: string) => {
    trackEvent("team_viewed", {
      team_id: teamId,
    });
  },

  // Track PDF export
  pdfExported: (reportType: string) => {
    trackEvent("pdf_exported", {
      report_type: reportType,
    });
  },

  // Track page navigation
  pageViewed: (pageName: string) => {
    trackEvent("page_view", {
      page_name: pageName,
    });
  },

  // SPA page_view with a path-only location. gtag's automatic page_view is off
  // (send_page_view:false in index.html) because its page_location is the raw
  // URL, which on the /yahoo-success OAuth return carries tokens; we send the
  // pathname only so credentials never reach Google Analytics.
  pageView: (path: string) => {
    trackEvent("page_view", {
      page_path: path,
      page_location: (typeof window !== "undefined" ? window.location.origin : "") + path,
      page_title: typeof document !== "undefined" ? document.title : undefined,
    });
  },
};
