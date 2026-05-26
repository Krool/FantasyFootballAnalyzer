const ANALYZER_URL = 'https://krool.github.io/FantasyFootballAnalyzer/';

const statusEl = document.getElementById('status');
const openEspnBtn = document.getElementById('open-espn');
const openAppBtn = document.getElementById('open-app');

async function refreshStatus() {
  const espnS2 = await chrome.cookies.get({ url: 'https://www.espn.com', name: 'espn_s2' });
  const swid = await chrome.cookies.get({ url: 'https://www.espn.com', name: 'SWID' });

  if (espnS2 && swid) {
    statusEl.textContent = 'ESPN session detected. You\'re good to go.';
    statusEl.className = 'status ok';
  } else {
    statusEl.textContent = 'Not logged into espn.com. Open it and sign in first.';
    statusEl.className = 'status missing';
  }
}

openEspnBtn.addEventListener('click', () => {
  chrome.tabs.create({ url: 'https://www.espn.com/fantasy/football/' });
});

openAppBtn.addEventListener('click', () => {
  chrome.tabs.create({ url: ANALYZER_URL });
});

refreshStatus();
