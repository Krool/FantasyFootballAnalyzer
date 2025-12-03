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
  // Track league connected
  leagueConnected: (platform: string, leagueId: string) => {
    trackEvent("league_connected", {
      platform, // 'espn', 'sleeper', 'yahoo'
      league_id: leagueId,
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
};
