# Fantasy Football Analyzer — ESPN Helper

Tiny MV3 extension whose only job is to read your `espn_s2` and `SWID` cookies
from `espn.com` and hand them to the Fantasy Football Analyzer web app when it
asks. Replaces the manual DevTools step on the ESPN onboarding flow.

## What it does

1. You log into espn.com in this browser like normal.
2. You open the Analyzer web app and pick the ESPN tab.
3. The web app probes the extension via `chrome.runtime.sendMessage`.
4. Extension reads the two cookies and returns them.
5. Web app auto-fills both fields. One click instead of six manual steps.

## What it does NOT do

- No network calls of its own
- No analytics
- No cookie storage (cookies stay where they are; we just read them when asked)
- No access to anything outside `*.espn.com` / `*.go.com` (the host permissions
  in `manifest.json` are the only origins we can touch)
- Only responds to messages from `https://krool.github.io/*` (set via
  `externally_connectable` plus a belt-and-suspenders origin check in
  `background.js`)

## Local development install

### Chrome / Edge / Brave

1. Visit `chrome://extensions`
2. Toggle "Developer mode" on (top right)
3. Click "Load unpacked"
4. Pick this `extension/` directory
5. Copy the extension ID shown on the card. Set it in your dev environment:
   ```
   VITE_ESPN_EXTENSION_ID=abcdefghijklmnopqrstuvwxyz123456
   ```
   (or hardcode in `src/components/LeagueForm.tsx`)
6. Reload the Analyzer web app. The "Auto-fill from extension" button should appear.

### Firefox

Firefox uses the WebExtensions API which is compatible. Load via
`about:debugging#/runtime/this-firefox` > "Load Temporary Add-on" and pick
`manifest.json`.

## Publishing

### Chrome Web Store

1. Add proper icons before publishing — Chrome Web Store requires 128x128 PNG
   minimum. Drop them at `extension/icons/icon16.png`, `icon48.png`, `icon128.png`
   and add an `"icons"` block to `manifest.json`.
2. Zip the contents of this directory (not the directory itself).
3. Pay the one-time $5 developer fee at the
   [Chrome Web Store Developer Dashboard](https://chrome.google.com/webstore/devconsole/).
4. Upload the zip. Review usually takes 1-3 business days.
5. Once published, copy the extension ID from the listing URL and set
   `VITE_ESPN_EXTENSION_ID` in Vercel/build env before deploying the web app.

### Firefox Add-ons (AMO)

1. Same icons + manifest changes.
2. Zip the directory contents.
3. Upload at [addons.mozilla.org/developers](https://addons.mozilla.org/en-US/developers/).
4. Listed extensions go through manual review (~days). Self-distributed XPIs
   are signed automatically but won't appear in search.

## Architecture notes

- `manifest_version: 3` — required by Chrome Web Store as of 2024.
- `permissions: ["cookies"]` is the only permission. Combined with
  `host_permissions` for `espn.com` / `go.com`, this lets us call
  `chrome.cookies.get({url: "https://www.espn.com", name: "espn_s2"})`.
  We cannot read cookies for any other site.
- `externally_connectable.matches` is the security boundary. Only listed
  origins can `chrome.runtime.sendMessage(EXT_ID, ...)`.
- `background.js` runs as a service worker (no persistent process).
- `popup.html` is optional UX so users can see whether they're logged into
  espn.com without leaving the extension icon.
