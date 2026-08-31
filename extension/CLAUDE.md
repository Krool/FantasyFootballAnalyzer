# extension/ notes

A small MV3 browser extension (see `extension/README.md`) that reads the ESPN
`espn_s2`/SWID cookies so private-league import can auto-fill instead of
sending people into DevTools. Consumed by `src/components/LeagueForm.tsx`,
gated by the optional `VITE_ESPN_EXTENSION_ID` (unset = the feature stays
dormant). Published to the extension stores by hand; it is not part of either
deploy pipeline. Its `externally_connectable` allowlist hardcodes the frontend
domain, so a domain change means editing `manifest.json`, `background.js`, and
`popup.js` too.

The shipped allowlist (`manifest.json` + `background.js`) carries ONLY the
production domain — never localhost. On a store-installed extension a
localhost entry lets any local server (someone else's `npm run dev`) silently
pull the user's ESPN session cookies (found by security review, 2026-08-25).
To test locally: add `http://localhost:5173` / `:4173` to both lists in an
unpacked copy, and strip them before packing a release. The frontend's
install-detection uses the cookie-free `ping` message; only the auto-fill
click reads cookies.
