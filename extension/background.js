// Service worker: only job is to answer "get the user's ESPN cookies"
// when the Fantasy Football Analyzer web app asks for them.
//
// We never store cookies, never send them anywhere, never make network calls.
// The web origin asking is gated by manifest.externally_connectable.

const ESPN_URL = 'https://www.espn.com';

async function readCookie(name) {
  // chrome.cookies.get returns null if the cookie isn't set or the user isn't logged in.
  const cookie = await chrome.cookies.get({ url: ESPN_URL, name });
  return cookie ? cookie.value : null;
}

async function readEspnCookies() {
  const [espnS2, swid] = await Promise.all([
    readCookie('espn_s2'),
    readCookie('SWID'),
  ]);
  return { espnS2, swid };
}

chrome.runtime.onMessageExternal.addListener((message, sender, sendResponse) => {
  // Belt-and-suspenders: even though externally_connectable gates the origin,
  // double-check sender.url is from an allowed origin before answering.
  // Compare parsed origins, not string prefixes: a prefix test accepts
  // lookalikes ("http://localhost:1234@evil.example/") that an origin equality
  // check rejects. Must stay in sync with externally_connectable in
  // manifest.json — and with the live frontend domain.
  const ALLOWED_ORIGINS = new Set([
    'https://fantasyfootballanalyzer.app',
    'http://localhost:5173',
    'http://localhost:4173',
  ]);
  let senderOrigin = '';
  try {
    senderOrigin = new URL(sender?.url || '').origin;
  } catch {
    senderOrigin = '';
  }
  if (!ALLOWED_ORIGINS.has(senderOrigin)) {
    sendResponse({ error: 'origin-not-allowed' });
    return false;
  }

  if (message?.type === 'ping') {
    sendResponse({ ok: true, version: chrome.runtime.getManifest().version });
    return false;
  }

  if (message?.type === 'get-espn-cookies') {
    readEspnCookies()
      .then(({ espnS2, swid }) => {
        if (!espnS2 || !swid) {
          sendResponse({ error: 'no-cookies', espnS2: null, swid: null });
        } else {
          sendResponse({ espnS2, swid });
        }
      })
      .catch((err) => {
        sendResponse({ error: String(err?.message || err) });
      });
    // Return true to keep the message channel open for the async response.
    return true;
  }

  sendResponse({ error: 'unknown-message-type' });
  return false;
});
