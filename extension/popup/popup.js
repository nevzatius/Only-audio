import { normalize } from '../shared/settings.js';

const enabledEl = document.getElementById('toggle-enabled');
const siteEls = {
  youtube: document.getElementById('toggle-youtube'),
  twitch: document.getElementById('toggle-twitch'),
  kick: document.getElementById('toggle-kick'),
};
const noteEl = document.getElementById('note');

function render(settings) {
  enabledEl.checked = settings.enabled;
  for (const [name, el] of Object.entries(siteEls)) {
    el.checked = settings.sites[name];
    el.disabled = !settings.enabled;
  }
  document.querySelector('.sites').classList.toggle('disabled', !settings.enabled);
}

async function load() {
  const raw = await chrome.storage.local.get(['enabled', 'sites']);
  render(normalize(raw));
}

async function save() {
  const settings = normalize({
    enabled: enabledEl.checked,
    sites: Object.fromEntries(Object.entries(siteEls).map(([n, el]) => [n, el.checked])),
  });
  await chrome.storage.local.set(settings);
  render(settings);
  noteEl.hidden = false;
}

enabledEl.addEventListener('change', save);
for (const el of Object.values(siteEls)) el.addEventListener('change', save);
load();
