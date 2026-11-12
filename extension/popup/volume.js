// Popup "Ses" bölümü: ses çalan ve sessize alınmış sekmeler, sekme başına kaydırıcı ve sessize alma.
// Sessize alma chrome.tabs.update({muted}) ile yapılır (izin gerektirmez, her sitede çalışır);
// kaydırıcı yalnız içerik betiği yüklü sitelerde etkindir. Sözleşme: docs/plan-faz5.md.
import { originPatternFor } from '../shared/settings.js';
import { MSG, STORE_PREFIX, mergeTabs, percentToVolume, volumeToPercent, tabOriginPattern } from '../shared/volume.js';

const listEl = document.getElementById('volume-list');
const emptyEl = document.getElementById('volume-empty');

let addSiteFn = async () => false;

// Not: tab.url/title/favIconUrl yalnız host iznimiz olan sekmelerde (ve aktif sekmede) dolu gelir.
async function classify(tab) {
  const pattern = tabOriginPattern(tab.url);
  if (!pattern) return { state: 'no-access' };
  let granted = false;
  try {
    granted = await chrome.permissions.contains({ origins: [pattern] });
  } catch (_e) {}
  if (!granted) return { state: 'no-permission', addPattern: originPatternFor(tab.url) };
  try {
    const res = await chrome.tabs.sendMessage(tab.id, { type: MSG.PING });
    if (res && res.ok) return { state: 'ok', volume: res.volume };
  } catch (_e) {}
  return { state: 'unreachable' };
}

function hintFor(info, onAdd) {
  const p = document.createElement('p');
  p.className = 'hint';
  if (info.state === 'no-access') {
    p.textContent = "Bu sekme için izin yok: ses kısılamaz. Eklemek için sekmeye geçip popup'ı açın.";
  } else if (info.state === 'no-permission') {
    if (info.addPattern) {
      p.textContent = 'Bu site ekli değil.';
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'add-site';
      b.textContent = 'Bu siteyi ekle';
      b.addEventListener('click', onAdd);
      p.append(b);
    } else {
      p.textContent = 'Bu sayfa eklenemez.';
    }
  } else {
    p.textContent = 'Kontrol edilemiyor; sayfayı yenileyin.';
  }
  return p;
}

function buildRow(tab, info) {
  const li = document.createElement('li');
  li.dataset.tabId = String(tab.id);
  const row = document.createElement('div');
  row.className = 'vrow';

  const fav = document.createElement('img');
  fav.className = 'fav';
  fav.alt = '';
  if (tab.favIconUrl) {
    fav.src = tab.favIconUrl;
    fav.addEventListener('error', () => (fav.style.visibility = 'hidden'));
  } else {
    fav.style.visibility = 'hidden';
  }

  const title = document.createElement('button');
  title.type = 'button';
  title.className = 'title';
  title.textContent = tab.title || '(izinsiz sekme)';
  title.title = tab.title || '';
  title.addEventListener('click', () => {
    chrome.tabs.update(tab.id, { active: true });
    chrome.windows.update(tab.windowId, { focused: true });
  });

  const mute = document.createElement('button');
  mute.type = 'button';
  mute.className = 'mute';
  let muted = Boolean(tab.mutedInfo && tab.mutedInfo.muted);
  const paintMute = () => {
    mute.textContent = muted ? '🔇' : '🔊';
    mute.title = muted ? 'Sesi aç' : 'Sessize al';
    mute.setAttribute('aria-pressed', String(muted));
    li.dataset.muted = String(muted);
  };
  paintMute();
  mute.addEventListener('click', async () => {
    try {
      await chrome.tabs.update(tab.id, { muted: !muted });
      muted = !muted;
      paintMute();
    } catch (_e) {}
  });

  row.append(fav, title, mute);

  const ctl = document.createElement('div');
  ctl.className = 'ctl';
  const slider = document.createElement('input');
  slider.type = 'range';
  slider.min = '0';
  slider.max = '100';
  slider.step = '1';
  slider.setAttribute('aria-label', 'Ses düzeyi');
  const pct = document.createElement('span');
  pct.className = 'pct';
  const paintPct = () => (pct.textContent = slider.value + '%');
  if (info.state === 'ok') {
    slider.value = String(volumeToPercent(info.volume));
    slider.addEventListener('input', () => {
      paintPct();
      chrome.runtime.sendMessage({ type: MSG.SET, tabId: tab.id, volume: percentToVolume(slider.value) }).catch(() => {});
    });
  } else {
    slider.value = '100';
    slider.disabled = true;
  }
  paintPct();
  ctl.append(slider, pct);
  row.append(ctl);

  if (info.state !== 'ok') {
    row.append(
      hintFor(info, async () => {
        if (await addSiteFn(info.addPattern)) await refresh();
      }),
    );
  }
  li.append(row);
  return li;
}

// Değer atanmış sekmeler sesli olmasa da (ör. %0) listede kalır; yoksa sesi geri açılamaz.
async function overriddenTabs() {
  const out = [];
  try {
    const all = await chrome.storage.session.get(null);
    for (const key of Object.keys(all)) {
      if (!key.startsWith(STORE_PREFIX)) continue;
      const id = Number(key.slice(STORE_PREFIX.length));
      if (!Number.isInteger(id)) continue;
      try {
        out.push(await chrome.tabs.get(id));
      } catch (_e) {} // sekme kapanmış; kayıt SW'de silinir
    }
  } catch (_e) {}
  return out;
}

export async function refresh() {
  let tabs = [];
  try {
    const [audible, muted, overridden] = await Promise.all([
      chrome.tabs.query({ audible: true }),
      chrome.tabs.query({ muted: true }),
      overriddenTabs(),
    ]);
    tabs = mergeTabs(audible, muted, overridden);
  } catch (_e) {}
  const infos = await Promise.all(tabs.map(classify));
  listEl.replaceChildren(...tabs.map((t, i) => buildRow(t, infos[i])));
  emptyEl.hidden = tabs.length > 0;
}

export function initVolume({ addSite }) {
  addSiteFn = addSite;
  refresh();
}
