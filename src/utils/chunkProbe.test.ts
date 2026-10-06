import { afterEach, describe, expect, it, vi } from 'vitest';
import { attemptedChunkUrls, probeChunks, summarizeProbe } from './chunkProbe';

afterEach(() => {
  vi.unstubAllGlobals();
  document.head.innerHTML = '';
});

function preload(href: string, rel = 'modulepreload') {
  const link = document.createElement('link');
  link.rel = rel;
  link.href = href;
  document.head.appendChild(link);
}

describe('attemptedChunkUrls', () => {
  it('lists modulepreloaded JS once each, skipping CSS and other links', () => {
    preload('/assets/DraftPage-abc.js');
    preload('/assets/DraftPage-abc.js');
    preload('/assets/DraftPage-abc.css');
    preload('/assets/fonts.css', 'stylesheet');
    expect(attemptedChunkUrls().map(u => u.split('/').pop())).toEqual(['DraftPage-abc.js']);
  });
});

describe('probeChunks', () => {
  it('flags a 404, an HTML response, and a blocked request without importing them', async () => {
    const responses: Record<string, () => Promise<Response>> = {
      '/a.js': async () => new Response('', { status: 404, headers: { 'content-type': 'text/html' } }),
      '/b.js': async () => new Response('<html>', { status: 200, headers: { 'content-type': 'text/html' } }),
      '/c.js': async () => {
        throw new TypeError('Load failed');
      },
    };
    vi.stubGlobal('fetch', vi.fn((url: string) => responses[url]()));
    const results = await probeChunks(['/a.js', '/b.js', '/c.js']);
    expect(results.map(r => r.problem)).toEqual([
      'HTTP 404',
      'served as text/html',
      'request blocked or dropped (TypeError: Load failed)',
    ]);
    expect(summarizeProbe(results)).toBe(
      'a.js: HTTP 404\nb.js: served as text/html\nc.js: request blocked or dropped (TypeError: Load failed)',
    );
  });

  it('reports a file that fetches as JS but throws when imported', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('', { status: 200, headers: { 'content-type': 'application/javascript' } })),
    );
    const [result] = await probeChunks(['/does-not-exist-chunk.js']);
    expect(result.status).toBe(200);
    expect(result.problem).toMatch(/^fetched fine, import threw /);
  });
});

describe('summarizeProbe', () => {
  it('lists fetch failures ahead of the import failures they cause', () => {
    expect(
      summarizeProbe([
        { file: 'Page.js', status: 200, contentType: 'text/javascript', problem: 'fetched fine, import threw X' },
        { file: 'dep.js', status: 404, contentType: 'text/html', problem: 'HTTP 404' },
      ]),
    ).toBe('dep.js: HTTP 404\nPage.js: fetched fine, import threw X');
  });

  it('says so when every file is fine, or when there was nothing to check', () => {
    expect(summarizeProbe([{ file: 'a.js', status: 200, contentType: 'text/javascript' }])).toBe(
      'All 1 files load fine when retried.',
    );
    expect(summarizeProbe([])).toBe('No chunk requests found to check.');
  });
});
