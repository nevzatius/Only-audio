# Faz 1 sözleşmesi: iskelet + YouTube + Twitch adaptörleri

Bu dosya ajanlar arası arayüzdür. Buradaki adlar, mesajlar ve eşikler değiştirilmez; değişmesi gerekiyorsa dur ve orkestratöre bildir. Arka plan: [recon.md](recon.md), [../CLAUDE.md](../CLAUDE.md).

Derleme adımı yok. Uzantı düz JS. Yeni npm paketi eklenmez. `playwright install` çalıştırılmaz.

## Dosya sahipliği

| Dosyalar | Sahip |
|---|---|
| `playwright.config.ts`, `tests/helpers/**`, `tests/youtube.spec.ts`, `tests/twitch.spec.ts` | Ajan A |
| `extension/manifest.json`, `extension/background/**`, `extension/shared/**`, `extension/popup/**`, `extension/content/**`, `extension/rules/**`, `tests/unit/**` | Ajan B |
| `extension/adapters/youtube/**` | Ajan C |
| `extension/adapters/twitch/**` | Ajan D |
| `eslint.config.mjs`, `package.json` | Orkestratör |

Başka ajanın dosyasına dokunma; orada hata görürsen raporla.

## Storage şeması (`chrome.storage.local`)

```js
{ enabled: true, sites: { youtube: true, twitch: true } }   // varsayılan: hepsi açık
```

`extension/shared/settings.js` (ES modülü; service worker, popup ve birim testleri içe aktarır):

- `DEFAULTS`
- `normalize(raw)` → eksik/bozuk alanları varsayılanla doldurur
- `isSiteActive(settings, site)` → `enabled && sites[site]`
- `SITES` → `{ youtube: {...}, twitch: {...} }` (aşağıdaki kayıt tablosu)

## Service worker (`extension/background/sw.js`, `type: module`)

Kurulumda, başlangıçta ve `chrome.storage.onChanged`'de `sync()`:

| Site | Etkinse | Değilse |
|---|---|---|
| youtube | `chrome.scripting.registerContentScripts({id:'oa-youtube-main', js:['adapters/youtube/main.js'], matches:['*://www.youtube.com/*'], world:'MAIN', runAt:'document_start'})` | kaydı kaldır |
| twitch | aynı kalıp, `id:'oa-twitch-main'`, `js:['adapters/twitch/main.js']`, `matches:['*://www.twitch.tv/*']`; ayrıca `updateEnabledRulesets` ile `twitch` kural kümesini aç | kaydı kaldır, kural kümesini kapat |

`sync()` idempotent olmalı (zaten kayıtlıysa hata vermemeli). Kapalıyken sayfaya MAIN world kodu hiç girmez.

Statik DNR kümesi `extension/rules/twitch.json` (kimlik `twitch`, manifestte `enabled: true`): `usher.ttvnw.net/api/v2/channel/hls/` isteklerine `queryTransform.addOrReplaceParams` ile `allow_audio_only=true` (recon §2, §MV3 notları). İzinler: `storage`, `scripting`, `declarativeNetRequestWithHostAccess`; host: `*://*.youtube.com/*`, `*://*.twitch.tv/*`, `*://*.ttvnw.net/*`.

Geçersiz kural JSON'u uzantıyı sessizce yüklenmez kılar; JSON'u doğrula.

## MAIN ↔ izole dünya mesajları (`window.postMessage`, aynı pencere)

MAIN → izole (adaptör durumu; her değişimde ve `oa:hello` alındığında yeniden gönderilir):

```js
{ source: 'only-audio/main', type: 'status',
  site: 'youtube' | 'twitch',
  mode: 'audio' | 'fallback' | 'off' | 'pending',
  reason: string,            // ör. 'hook', 'live', 'hook-failed', 'no-audio-variant', 'user-restore'
  playerSelector: string }   // kapağın yerleşeceği kapsayıcı: YouTube '#movie_player', Twitch '.video-player__container' (yoksa '.video-player')
```

İzole → MAIN:

```js
{ source: 'only-audio/ext', type: 'hello' }     // köprü yüklendi, durumu yeniden gönder
{ source: 'only-audio/ext', type: 'restore' }   // kullanıcı kapaktaki düğmeye bastı: videoya dön
```

Her iki taraf `event.source === window` ve `source` alanını doğrular.

## Köprü ve kapak (`extension/content/bridge.js`, `cover.css`; manifestte statik, izole dünya, `document_start`, iki site)

- `mode` `audio` veya `fallback` iken `playerSelector` içine kapak ekler: metin "🎧 Sadece ses", altında "Videoya dön" düğmesi. `fallback`'te küçük not: "düşük kalite".
- Kapak videoyu tamamen örter (opak) ama oynatıcı denetimlerini örtmez/engellemez: kapak `pointer-events: none`, yalnız düğme tıklanabilir.
- Düğme → `restore` mesajı. `mode` `off`/`pending` olunca kapak kaldırılır.
- Kapak kökü: `<div id="only-audio-cover" data-mode="...">`, düğme: `<button id="only-audio-restore">`.
- SPA gezinmesinde oynatıcı düğümü değişebilir; kapak yoksa yeniden eklenir.

## Popup (`extension/popup/`)

Genel aç/kapa + site başına anahtar (`youtube`, `twitch`). `chrome.storage.local`'a yazar. Değişiklikten sonra "Açık sekmeleri yenileyin" notu. Girdi kimlikleri: `#toggle-enabled`, `#toggle-youtube`, `#toggle-twitch`.

## YouTube adaptörü (`extension/adapters/youtube/main.js`, MAIN, document_start)

- `sessionStorage['onlyaudio:yt:bypass']` = `JSON {reason:'user'|'live', videoId}`. Senkron okunur.
- Bypass yoksa: `Object.defineProperty(Object.prototype, 'audio_only', { get(){ return '1' }, set(v){ /* gölgelemeye izin ver: Object.defineProperty(this,'audio_only',{value:v,writable:true,configurable:true,enumerable:true}) */ }, configurable: true, enumerable: false })`. Durum `audio`/`hook`.
- Doğrulama: oynatma başladıktan sonra (`currentTime` ≥ 5 ilerlemişken) `videoWidth > 0` veya `getVideoPlaybackQuality().totalVideoFrames > 0` ise kanca tutmamıştır → `player.setPlaybackQualityRange('tiny','tiny')`, durum `fallback`/`hook-failed`.
- Canlı: `player.getVideoData().isLive` doğruysa ve kanca kuruluysa → bypass `{reason:'live', videoId}` yaz, `location.reload()`. `reason:'live'` ile yüklenince kanca kurulmaz, `tiny` kalite uygulanır, durum `fallback`/`live`.
- `restore`: bypass `{reason:'user', videoId}` yaz; geçerli `currentTime` ile (`t=<sn>s`) sayfayı yeniden yükle. Sonra durum `off`/`user-restore`, kalite sınırı yok.
- SPA gezinmesi (`yt-navigate-finish`): bypass başka bir `videoId` içinse bypass'ı sil ve yeniden yükle (kanca oynatıcıdan önce kurulmalı). Kanca kuruluyken yeni videoda doğrulama ve canlı denetimi yeniden çalışır.
- Oynatıcı: `document.getElementById('movie_player')`. `/watch` dışındaki sayfalarda durum gönderme (`pending`).

## Twitch adaptörü (`extension/adapters/twitch/main.js`, MAIN, document_start)

- Oynatıcı örneği: `.video-player` öğesinin React fiber'ından yukarı doğru yapısal arama: `getQualities` ve `setQuality` metodları olan nesne (önce `props.mediaPlayerInstance`). Sabit derinliğe güvenme.
- `getQualities()` içinde `group === 'audio_only'` (veya adı `audio` içeren) varsa: `setAutoQualityMode(false)` + `setQuality(q)`. Durum `audio`/`dnr`.
- Geçiş sonrası doğrulama (recon riski: 4'te 1 duraklamış kalıyor): ~5 sn içinde `currentTime` ilerlemiyorsa `play()`, yine olmazsa `setQuality`'yi bir kez yinele; hâlâ olmazsa en düşük `bitrate`'li video kalitesine düş, durum `fallback`/`stalled`.
- `audio_only` yoksa en düşük `bitrate`'li kalite, durum `fallback`/`no-audio-variant`.
- Reklam/preroll sırasında kalite listesi boş veya farklı olabilir; adaptör hedef kalite tutmuyorsa birkaç saniyede bir yeniden dener (kullanıcı `restore` etmediyse).
- `restore`: `setAutoQualityMode(true)`, `sessionStorage['onlyaudio:tw:bypass']='1'`, durum `off`/`user-restore`; o sekmede yeniden devreye girmez.
- Görünürlük için `document.visibilityState`'e güvenme.

## Test düzeneği (`tests/helpers/brave.ts`)

`launchBrave({ extensionPath })` → `{ browser, context, port, profileDir, close() }`:

- Brave: `C:\Program Files\BraveSoftware\Brave-Browser\Application\brave.exe`, CLAUDE.md'deki bayraklarla, boş port, `--user-data-dir` = `os.tmpdir()/only-audio-profiles/<rastgele>` (repo dışı).
- `chromium.connectOverCDP`. `launchPersistentContext` kullanma (recon §Test altyapısı).
- Uzantı service worker hedefinin var olduğunu doğrula (`chrome-extension://…/background/sw.js`); yoksa açık hata ver.
- `close()`: Brave süreç ağacını öldür, profil dizinini sil (Windows kilitleri için yeniden dene). Test başarısız olsa da çalışmalı.
- `countBytes(page, hostPattern)` → CDP `Network` olaylarından `encodedDataLength` toplayan sayaç. Twitch'te istekler Worker'dan çıkar; sayaç worker isteklerini de saymalı ve bunu doğrulamalısın (segment istekleri sayaca düşüyor mu?).

`playwright.config.ts`: `testDir: 'tests'`, `workers: 1`, `retries: 0`, test zaman aşımı 240 sn, tarayıcı projesi yok.

## Eşikler (sabit; testte yorum olarak kaynağıyla yazılır)

**Bu değerler test geçsin diye gevşetilmez.** Tutmuyorsa dur, ölçtüğün değerlerle orkestratöre raporla.

### `tests/youtube.spec.ts`: `aqz-KE-bpKQ`, 45 sn, sekme görünür

| Ölçüt | Eşik | Kaynak |
|---|---|---|
| googlevideo.com baytı (45 sn'de kümülatif) | < 2,16 MB (2 160 000 B) | recon §1: kancalı 60. sn ölçümü 2,16 MB; kümülatif olduğundan 45. sn altında kalmalı. Kancasız 45. sn: 6,65 MB |
| `totalVideoFrames` | = 0 | recon §1 tablo: kancalı 0 |
| `videoWidth` | = 0 | recon §1 tablo: kancalı 0 |
| `currentTime` | ≥ 40 | recon §1: 90 sn'de 89; 5 sn başlangıç payı |

45 sn, oynatmanın başladığı andan değil, gezinmeden itibaren duvar saatiyle sayılır (recon ölçümü gibi). Kapak da doğrulanır: `#only-audio-cover[data-mode="audio"]` görünür.

### `tests/twitch.spec.ts`: canlı kanal, geçişten sonra 30 sn pencere

Kanal: `TWITCH_CHANNEL` ortam değişkeni; yoksa `https://www.twitch.tv/directory/all?sort=VIEWER_COUNT` sayfasındaki ilk canlı kanal. Geçişi uzantının durum mesajından değil sayfadan bağımsız ölç: `videoWidth === 0` ve `currentTime` ilerliyor olana dek bekle (en çok 90 sn; preroll olabilir), sonra 30 sn pencere.

| Ölçüt | Eşik | Kaynak |
|---|---|---|
| `*.ttvnw.net` bayt hızı (30 sn pencere) | < 60 KB/sn (30 sn'de < 1 800 000 B) | recon §3 "Kanala göre audio_only bayt hızı": hız kanalın kaynak ses bitrate'ine bağlı (ölçülen 31–45 kB/sn). 2026-11-11'de kullanıcı onayıyla 40 → 60 KB/sn. Varsayılan ~440 KB/sn; yalnız-ses/160p ayrımını kare ve videoWidth ölçütleri yapar |
| pencere içi `totalVideoFrames` artışı | = 0 | recon §2 tablo: audio_only 0 |
| `videoWidth` | = 0 | recon §2 tablo: audio_only 0 |
| pencere içi `currentTime` artışı | ≥ 25 | 30 sn pencere, 5 sn pay |

Kapak: `#only-audio-cover[data-mode="audio"]` görünür.

## Çalışma kuralları

- Önce test, sonra kod. Testin önce doğru nedenle başarısız olduğunu gör.
- Kullanıcının gerçek Brave profiline dokunma. Aynı anda birden çok ajan Brave başlatabilir: boş port ve ayrı profil kullan, işin bitince profili sil ve kendi Brave süreçlerini kapat (başkalarınınkini öldürme: `taskkill /IM brave.exe` YASAK; yalnız kendi PID ağacın).
- Geçici dosyalar repo dışında.
- Lint: `npm run lint` (ESLint 10, `eslint.config.mjs`, yalnız `.js/.mjs`). Kodun lint'ten geçmeli.
- Bitince raporla: ne yazdın, hangi komutu çalıştırdın, çıktısı ne, bilinen eksikler.
