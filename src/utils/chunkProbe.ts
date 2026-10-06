// When a lazy page fails to import and reloading does not fix it, the browser's
// error says nothing about why: Safari's is just "Importing a module script
// failed." for a 404, a blocked request, a non-JS response, a parse failure
// and an evaluation throw alike - and Sentry drops that string as deploy churn
// (BENIGN_ERROR). Owner-reported 2026-10-05: /draft dead on iOS Safari after
// every reload while every chunk was on gh-pages and imported fine in Chromium.
// This probe names the file and the failure so the error screen (and a Sentry
// message worded to survive the benign filter) carries something actionable.

export interface ChunkProbeResult {
  file: string;
  /** HTTP status, or null when the request itself threw (blocked, offline). */
  status: number | null;
  contentType: string;
  /** Present only for a file that failed one of the checks. */
  problem?: string;
}

const MAX_FILES = 40;

// The chunks Vite tried to load: its preload helper adds a modulepreload link
// for every JS dependency of a dynamic import (the page chunk included) before
// importing it, so these are exactly the files the failed import needed.
export function attemptedChunkUrls(doc: Document = document): string[] {
  const urls = new Set<string>();
  doc.querySelectorAll<HTMLLinkElement>('link[rel="modulepreload"]').forEach(link => {
    if (link.href && /\.js(\?|$)/.test(link.href)) urls.add(link.href);
  });
  return [...urls].slice(0, MAX_FILES);
}

function fileName(url: string): string {
  return url.split('?')[0].split('/').pop() ?? url;
}

function messageOf(err: unknown): string {
  return err instanceof Error ? `${err.name}: ${err.message}` : String(err);
}

// Fetch each file fresh (status + type: catches 404s, HTML error pages and
// blocked requests), then import a cache-busted copy of each one that fetched
// fine. A fresh URL is a fresh module record, so it re-runs the parse and
// evaluation the original import did, and an engine that hid the real error
// behind the generic one surfaces it here.
export async function probeChunks(urls: string[]): Promise<ChunkProbeResult[]> {
  const stamp = Date.now();
  return Promise.all(
    urls.map(async (url): Promise<ChunkProbeResult> => {
      const file = fileName(url);
      let res: Response;
      try {
        res = await fetch(url, { cache: 'no-store' });
      } catch (err) {
        return { file, status: null, contentType: '', problem: `request blocked or dropped (${messageOf(err)})` };
      }
      const contentType = res.headers.get('content-type') ?? '';
      if (!res.ok) return { file, status: res.status, contentType, problem: `HTTP ${res.status}` };
      if (!/javascript/i.test(contentType)) {
        return { file, status: res.status, contentType, problem: `served as ${contentType || 'no content-type'}` };
      }
      try {
        await import(/* @vite-ignore */ `${url}${url.includes('?') ? '&' : '?'}probe=${stamp}`);
      } catch (err) {
        return { file, status: res.status, contentType, problem: `fetched fine, import threw ${messageOf(err)}` };
      }
      return { file, status: res.status, contentType };
    }),
  );
}

// One line per bad file; a clean sweep says so, which itself narrows the cause
// to the browser's first attempt (a cached bad response, a one-off block).
// Files that failed to fetch lead: every chunk importing one of them fails its
// import too, so those import lines are usually the fallout, not the cause.
export function summarizeProbe(results: ChunkProbeResult[]): string {
  const importOnly = (r: ChunkProbeResult) => (r.problem?.startsWith('fetched fine') ? 1 : 0);
  const bad = results.filter(r => r.problem).sort((a, b) => importOnly(a) - importOnly(b));
  if (results.length === 0) return 'No chunk requests found to check.';
  if (bad.length === 0) return `All ${results.length} files load fine when retried.`;
  return bad.map(r => `${r.file}: ${r.problem}`).join('\n');
}
