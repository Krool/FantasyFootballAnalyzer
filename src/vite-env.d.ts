/// <reference types="vite/client" />

interface ImportMetaEnv {
  // Sentry client key. Unset in dev and on builds without it, which keeps
  // production error reporting dark (see src/utils/sentry.ts).
  readonly VITE_SENTRY_DSN?: string;
  // Dev-only crocodile button (HomePage). Set in .env.local, never committed.
  readonly VITE_DEV_SLEEPER_LEAGUE_ID?: string;
  readonly VITE_DEV_ESPN_LEAGUE_ID?: string;
  readonly VITE_DEV_ESPN_SEASON?: string;
  readonly VITE_DEV_ESPN_S2?: string;
  readonly VITE_DEV_ESPN_SWID?: string;
  // Short git SHA of the build, defined in vite.config.ts. Used as the Sentry
  // release so an error can be traced back to the exact deploy.
  readonly VITE_BUILD_SHA?: string;
  readonly VITE_BUILD_TIME?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
