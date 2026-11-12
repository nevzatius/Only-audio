import { normalize, originPatternFor, patternHost, isBuiltInHost } from '../shared/settings.js';

const enabledEl = document.getElementById('toggle-enabled');
const siteEls = {
  youtube: document.getElementById('toggle-youtube'),
  twitch: document.getElementById('toggle-twitch'),
  kick: document.getElementById('toggle-kick'),
};
const noteEl = document.getElementById('note');
const hostEl = document.getElementById('current-host');
const siteBtn = document.getElementById('toggle-site');
const siteMsgEl = document.getElementById('site-msg');
const listEl = document.getElementById('custom-list');

let settings = normalize({});
let currentPattern = null; // aktif sekmenin eklenebilir kalıbı (yoksa null)

async function readSettings() {
  return normalize(await chrome.storage.local.get(['enabled', 'sites', 'customSites']));
}

function showMsg(text) {
  siteMsgEl.textContent = text;
  siteMsgEl.hidden = !text;
}

function renderCustom() {
  const added = currentPattern !== null && settings.customSites.includes(currentPattern);
  siteBtn.disabled = currentPattern === null;
  siteBtn.textContent = added ? 'Bu siteyi kaldır' : 'Bu siteyi ekle';

  listEl.replaceChildren();
  for (const p of settings.customSites) {
    const li = document.createElement('li');
    const name = document.createElement('span');
    name.textContent = patternHost(p);
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = 'Kaldır';
    btn.addEventListener('click', () => removeSite(p));
    li.append(name, btn);
    listEl.append(li);
  }
}

function render() {
  enabledEl.checked = settings.enabled;
  for (const [name, el] of Object.entries(siteEls)) {
    el.checked = settings.sites[name];
    el.disabled = !settings.enabled;
  }
  document.querySelector('.sites').classList.toggle('disabled', !settings.enabled);
  renderCustom();
}

async function detectTab() {
  let url = '';
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    url = (tab && tab.url) || '';
  } catch (_e) {}
  currentPattern = originPatternFor(url);
  let host = '';
  try {
    host = new URL(url).hostname;
  } catch (_e) {}
  hostEl.textContent = host || '—';
  if (!currentPattern) {
    showMsg(host && isBuiltInHost(host) ? 'Bu site için yerleşik destek var.' : 'Bu sayfa eklenemez.');
  }
}

async function load() {
  settings = await readSettings();
  await detectTab();
  render();
}

async function save() {
  const cur = await readSettings();
  settings = normalize({
    enabled: enabledEl.checked,
    sites: Object.fromEntries(Object.entries(siteEls).map(([n, el]) => [n, el.checked])),
    customSites: cur.customSites, // şemadaki öteki alanlar korunur
  });
  await chrome.storage.local.set(settings);
  render();
  noteEl.hidden = false;
}

function addSite(pattern) {
  // permissions.request kullanıcı jestinden çağrılmalı: tıklama işleyicisinin ilk işi bu.
  chrome.permissions.request({ origins: [pattern] }).then(
    async (granted) => {
      if (!granted) {
        showMsg('İzin verilmedi.');
        return;
      }
      const cur = await readSettings();
      settings = normalize({ ...cur, customSites: [...cur.customSites, pattern] });
      await chrome.storage.local.set(settings);
      showMsg('');
      render();
      noteEl.hidden = false;
    },
    () => showMsg('İzin istenemedi.'),
  );
}

async function removeSite(pattern) {
  const cur = await readSettings();
  settings = normalize({ ...cur, customSites: cur.customSites.filter((p) => p !== pattern) });
  await chrome.storage.local.set(settings); // önce ayar: açık sekmedeki kapak hemen kalkar
  try {
    await chrome.permissions.remove({ origins: [pattern] });
  } catch (_e) {}
  showMsg('');
  render();
}

siteBtn.addEventListener('click', () => {
  if (!currentPattern) return;
  if (settings.customSites.includes(currentPattern)) removeSite(currentPattern);
  else addSite(currentPattern);
});

enabledEl.addEventListener('change', save);
for (const el of Object.values(siteEls)) el.addEventListener('change', save);
load();
