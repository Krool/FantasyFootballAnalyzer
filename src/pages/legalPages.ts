// Copy for the public /privacy and /terms pages (rendered by LegalPage.tsx,
// live and in the build-time prerender). Kept here so the component file only
// exports a component (react-refresh rule), same split as toolLandings.ts.
//
// The privacy page states what the code does, nothing more. When a storage
// key, analytics event, API function, or third-party host changes, change the
// matching line here and bump `updated`. Sources: index.html (GA snippet, CSP),
// src/utils/analytics.ts, src/utils/sentry.ts, src/utils/espnCredentials.ts,
// src/api/yahoo.ts, src/utils/lastConnection.ts, src/utils/leagueCache.ts,
// and api/*.js.

export const LEGAL_CONTACT = 'kroolworld@proton.me';

// A paragraph, or a bullet list when the entry is an array.
export type LegalBlock = string | string[];

export interface LegalSection {
  h: string;
  body: LegalBlock[];
  links?: Array<{ label: string; href: string }>;
}

export interface LegalPageContent {
  path: 'privacy' | 'terms';
  // <title> and meta description for the prerendered page.
  title: string;
  desc: string;
  kicker: string;
  heading: string;
  // ISO date shown as "Last updated".
  updated: string;
  intro: string;
  sections: LegalSection[];
}

export const LEGAL_PAGES: Record<'privacy' | 'terms', LegalPageContent> = {
  privacy: {
    path: 'privacy',
    title: 'Privacy | Fantasy Football Analyzer',
    desc:
      'What Fantasy Football Analyzer does with your data: Google Analytics page counts, ' +
      'scrubbed error reports, and how Sleeper, ESPN, and Yahoo logins are handled. ' +
      'No accounts, no ads, no database.',
    kicker: 'Privacy',
    heading: 'Privacy',
    updated: '2026-11-10',
    intro:
      'Fantasy Football Analyzer is a free tool run by Krool World. There are no accounts on ' +
      'this site, no ads, and no database. This page lists what the site does with your data.',
    sections: [
      {
        h: 'What is collected',
        body: [
          'Google Analytics. The site loads Google Analytics 4 to count visits. For each page ' +
            'it sends the page path, the page title, and any utm campaign tags from the link ' +
            'you followed. It also sends four events: a connect attempt, a league connected, a ' +
            'connect error (each with the platform name, and for errors a coarse class such as ' +
            '"not found" or "private league"), and a PDF export. League ids, usernames, ' +
            'tokens, and cookies are not sent, and the rest of the query string is dropped.',
          'Google Analytics sets its own cookies on this domain (_ga and _ga_SXG8M67HPV) to ' +
            'tell one visit from another, and Google receives your IP address and browser ' +
            'details, as any web server does. There is no consent banner. A content blocker ' +
            'or the Google Analytics opt-out add-on stops it, and the site works the same ' +
            'without it.',
          'Error reports. When the app hits an error, it sends a report to Sentry: the error ' +
            'message, the stack trace, your browser and operating system version, the page ' +
            'path, and the last few actions in the app (page changes, clicks, request URLs). ' +
            'Before sending, the app strips query strings, tokens, cookies, GUIDs, and any ' +
            'number of seven or more digits, which covers league ids. The app turns off ' +
            'Sentry\'s option to attach IP addresses and cookies. There is no session replay ' +
            'and no performance tracing. The stripping is automatic and pattern based.',
        ],
        links: [
          { label: 'How Google uses data from sites that use its services', href: 'https://policies.google.com/technologies/partner-sites' },
          { label: 'Google Analytics opt-out add-on', href: 'https://tools.google.com/dlpage/gaoptout' },
          { label: 'Sentry privacy policy', href: 'https://sentry.io/privacy/' },
        ],
      },
      {
        h: 'League logins',
        body: [
          'The site never sees your Sleeper, ESPN, or Yahoo password.',
          [
            'Sleeper: no login. You type a username or league id and your browser calls ' +
              'Sleeper\'s public API directly.',
            'ESPN, public league: your browser calls ESPN\'s API directly with the league id.',
            'ESPN, private league: you paste your espn_s2 and SWID cookies. Those two values ' +
              'give access to your ESPN fantasy account, so the app keeps them only in this ' +
              'tab\'s session storage, which the browser clears when the tab closes. Each ' +
              'request sends them as headers to a proxy function this site runs on Vercel. The ' +
              'function forwards the request to ESPN and returns the answer. It does not store ' +
              'or log the cookies.',
            'Yahoo: you sign in on Yahoo\'s own page. Yahoo sends a one-time code to a ' +
              'function this site runs on Vercel, which exchanges it for an access token and a ' +
              'refresh token and hands both to your browser in the part of the address after ' +
              'the #, which browsers do not send to servers. The app saves them in local ' +
              'storage and leaves that address. Later requests to Yahoo pass through the ' +
              'site\'s proxy function with the access token in a header, and the refresh token ' +
              'is sent to a second function when a new access token is needed. The functions ' +
              'keep nothing; on a failure they log the HTTP status code only.',
          ],
          'The Yahoo login stays on this device until you press the Y! button to disconnect or ' +
            'clear the site\'s data. You can also remove the app\'s access from your Yahoo ' +
            'account settings.',
        ],
      },
      {
        h: 'Stored in your browser',
        body: [
          'The site keeps no server-side copy of anything below. Tokens and cookies leave your ' +
            'device only as described under League logins.',
          [
            'Local storage: the Yahoo access and refresh tokens; how you last connected ' +
              '(platform, league id, ESPN season, Sleeper username and user id) so the form is ' +
              'prefilled next time; cached copies of leagues you loaded (finished seasons for ' +
              'up to 30 days, live seasons for less) and of Yahoo league history; Draft Room ' +
              'sessions, presets, and your queue; target and avoid lists; cached Yahoo auction ' +
              'values; the sound on or off setting.',
            'Session storage, cleared when the tab closes: ESPN cookies, guest mode settings, ' +
              'the one-time value that checks a Yahoo login returned to the tab that started ' +
              'it, and a marker that stops reload loops after a site update.',
          ],
          'Clearing this site\'s data in your browser removes all of it.',
        ],
      },
      {
        h: 'Servers and other companies',
        body: [
          [
            'GitHub Pages hosts the site. GitHub receives your IP address when pages load.',
            'Vercel hosts the proxy functions. Vercel keeps standard request logs: IP address, ' +
              'time, and the request address, which for ESPN includes the league id and season ' +
              'and for Yahoo the league or team being read. This site has no database behind ' +
              'them.',
            'Sleeper, ESPN, and Yahoo receive the requests for your league data.',
            'Team logos load from ESPN\'s image host (a.espncdn.com) and player photos from ' +
              'Sleeper\'s (sleepercdn.com), so those hosts see your IP address.',
            'Google Analytics and Sentry, as described above.',
          ],
          'Fonts are served from this site. There are no ad networks. Nothing is sold or ' +
            'shared beyond the services listed here.',
        ],
      },
      {
        h: 'Share links',
        body: [
          'While a league is loaded, the address bar carries the platform and league id so the ' +
            'link can be shared. It never carries cookies or tokens. Anyone with a link to a ' +
            'Sleeper league or a public ESPN league can load that league, the same data those ' +
            'platforms\' public APIs already return for the id.',
        ],
      },
      {
        h: 'Changes and contact',
        body: [
          'If the site starts handling data differently, this page changes with it and the ' +
            'date at the top moves.',
        ],
      },
    ],
  },
  terms: {
    path: 'terms',
    title: 'Terms | Fantasy Football Analyzer',
    desc:
      'Terms for using Fantasy Football Analyzer: a free tool provided as is, not affiliated ' +
      'with Sleeper, ESPN, Yahoo, or the NFL.',
    kicker: 'Terms',
    heading: 'Terms of use',
    updated: '2026-11-10',
    intro:
      'Fantasy Football Analyzer is a free tool run by Krool World. Using it means you accept ' +
      'the terms on this page.',
    sections: [
      {
        h: 'What you get',
        body: [
          'The site is provided as is, with no warranty of any kind. Grades, rankings, auction ' +
            'values, projections, and trade verdicts are estimates for entertainment. They can ' +
            'be wrong, late, or incomplete. Decisions you make with them, including any that ' +
            'involve money, are yours.',
          'The site can change or go offline at any time. Sleeper, ESPN, and Yahoo can change ' +
            'their APIs without notice, which can break features here.',
        ],
      },
      {
        h: 'Your league accounts',
        body: [
          'Connect only leagues you belong to or are allowed to view. You are responsible for ' +
            'your Sleeper, ESPN, and Yahoo accounts and for following those platforms\' terms.',
          'ESPN cookies give access to your ESPN fantasy account. Paste them only on a device ' +
            'you trust. The privacy page explains how the site handles them.',
        ],
      },
      {
        h: 'Fair use',
        body: [
          'Do not use the site or its proxy functions to scrape in bulk, to reach leagues you ' +
            'have no right to view, to attack or overload the service, or to break the law.',
        ],
      },
      {
        h: 'Other companies',
        body: [
          'This site is not affiliated with, endorsed by, or sponsored by Sleeper, ESPN, ' +
            'Yahoo, FantasyPros, or the NFL. Their names, logos, and data belong to them. ' +
            'Yahoo league data is provided by Yahoo Fantasy.',
        ],
      },
      {
        h: 'Liability',
        body: [
          'To the extent the law allows, Krool World is not liable for any loss or damage ' +
            'arising from your use of the site.',
        ],
      },
      {
        h: 'Changes and contact',
        body: [
          'These terms may change. The date at the top shows the latest version, and using the ' +
            'site after a change means you accept it.',
        ],
      },
    ],
  },
};
