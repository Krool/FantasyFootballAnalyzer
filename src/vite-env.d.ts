/// <reference types="vite/client" />

interface ImportMetaEnv {
  // Sentry client key. Unset in dev and on builds without it, which keeps
  // production error reporting dark (see src/utils/sentry.ts).
  readonly VITE_SENTRY_DSN?: string;
  // Short git SHA of the build, defined in vite.config.ts. Used as the Sentry
  // release so an error can be traced back to the exact deploy.
  readonly VITE_BUILD_SHA?: string;
  readonly VITE_BUILD_TIME?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
