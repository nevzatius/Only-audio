# Only Audio

**English | [Türkçe](#türkçe)**

---

## English

An MV3 extension for Brave (and other Chromium browsers) that plays only the audio of YouTube, Twitch and Kick streams, so the video is neither downloaded nor decoded.

### Why

Chromium stops decoding video in a hidden tab after about 10 seconds but keeps downloading it. This extension asks the site for audio only, so both the download and the decoding stop. Measured on a visible tab, 60 s window, 2 runs each (details: [docs/results.md](docs/results.md)):

| Site | Network (KB/s) off → on | Decoded frames off → on | Renderer CPU off → on |
|---|---|---|---|
| YouTube VOD | ~112 → ~33 (~3.4x less) | 1809 → 0 | ~17% → ~4% |
| Twitch | ~400 → ~34 (~12x less) | ~3600 → 0 | ~37% → ~32% |
| Kick | ~440 → ~30 (~14x less) | ~3600 → 0 | ~56% → ~50% |

Memory savings are modest: about 10–15% of renderer memory, and run-to-run variation is as large as the difference, so treat it as approximate. Most of a tab's memory is the page itself (JS heap, DOM, player UI), which stays regardless of whether video is fetched.

Not measured: hidden tabs (the test environment never hid a tab), ads, Premium accounts, embedded players. Only tested on Brave (Chromium 120+).

### Supported sites

| Site | Method | True audio-only? | Fallback |
|---|---|---|---|
| YouTube (VOD) | `audio_only` player variable hook in the page context; SABR sends audio only | Yes | 144p |
| YouTube (live) | The hook breaks live playback, so it is not used | No, fallback only | 144p |
| Twitch (live) | `declarativeNetRequest` adds `allow_audio_only=true` to the playlist request + `audio_only` quality in the player | Yes | 160p |
| Kick (live) | Same approach on the IVS playback request | Yes | 160p |
| Other sites (you add them) | Generic adapter: hides `<video>`, shows a cover | No. Download and decoding continue; limited benefit | Best effort |

YouTube live: the 144p fallback cuts network by ~42% (90 → ~51 KB/s) but video is still decoded, and CPU and JS heap are slightly higher than with the extension off. If CPU or memory matter more than bandwidth, turn the extension off for live streams.

The YouTube, Twitch and Kick paths rely on undocumented site internals and can break when the sites change; the fallback then applies. See [docs/recon.md](docs/recon.md).

### Install

1. Download this repo (or the release zip and extract it).
2. Open `brave://extensions` (or `chrome://extensions`).
3. Turn on **Developer mode**.
4. Click **Load unpacked** and select the [extension/](extension/) folder (the one containing `manifest.json`).

The browser reads the extension from that folder; moving or deleting it removes the extension.

### Usage

- Open a supported site; audio-only starts automatically while the extension is on. Tabs that were already open need a reload after toggling.
- The toolbar popup has a master switch and per-site switches (YouTube / Twitch / Kick).
- **Add a site:** open the page, click the extension icon, press **Add this site**, and grant the permission the browser asks for. Reload the page. Remove it with **Remove this site** or from the list in the popup. Built-in sites and non-http(s) pages cannot be added.
- **Back to video:** the cover that replaces the player has a **Back to video** button that restores the normal player.

### Known limits

Details in [docs/known-issues.md](docs/known-issues.md).

- YouTube live is not true audio-only (see above).
- On Twitch and Kick the network difference between `audio_only` and 160p is small (~15%); the real gain is that decoding stops.
- Twitch may occasionally stall after the switch to `audio_only`; the extension waits 5 s of playback before switching.
- Kick may show a Cloudflare bot check to automated browsers; this affects the tests, not the extension.

### Tests

```
npm install      # Playwright and eslint; no browser download
npm test         # npx playwright test
npm run lint
```

Tests use the system Brave (`C:\Program Files\BraveSoftware\Brave-Browser\Application\brave.exe`), started outside Playwright with `--remote-debugging-port` and attached via `chromium.connectOverCDP`. Each run uses a separate temporary `--user-data-dir` that is deleted afterwards; your real profile is not touched. Tests need network access to the live sites.

Packaging: `powershell -File scripts/package.ps1` creates `dist/audio-only-v<version>.zip`.

### Credits and license

Thanks to [ganeshkumar269/audio-only-for-youtube](https://github.com/ganeshkumar269/audio-only-for-youtube) for the YouTube audio-only hook idea; see [THIRD_PARTY.md](THIRD_PARTY.md). License: [MIT](LICENSE).

---

## Türkçe

Brave (ve diğer Chromium tabanlı tarayıcılar) için MV3 uzantısı: YouTube, Twitch ve Kick'te yalnız sesi oynatır; video ne indirilir ne çözülür.

### Neden

Chromium gizli sekmede video çözmeyi ~10 sn sonra durdurur ama indirmeye devam eder. Bu uzantı siteden yalnız ses ister; böylece hem indirme hem çözme durur. Görünür sekmede, 60 sn pencerede, her koşul 2 tekrar ölçüldü (ayrıntı: [docs/results.md](docs/results.md)):

| Site | Ağ (KB/sn) kapalı → açık | Çözülen kare kapalı → açık | Renderer CPU kapalı → açık |
|---|---|---|---|
| YouTube VOD | ~112 → ~33 (~3,4× az) | 1809 → 0 | ~%17 → ~%4 |
| Twitch | ~400 → ~34 (~12× az) | ~3600 → 0 | ~%37 → ~%32 |
| Kick | ~440 → ~30 (~14× az) | ~3600 → 0 | ~%56 → ~%50 |

Bellek kazancı mütevazı: renderer belleğinde yaklaşık %10–15; tekrarlar arası oynaklık farkın kendisi kadar büyük, bu yüzden yaklaşık sayın. Bir sekmenin belleğinin çoğu sayfanın kendisidir (JS yığını, DOM, oynatıcı arayüzü) ve video indirilse de indirilmese de kalır.

Ölçülmeyenler: gizli sekme (ölçüm ortamında sekme gizlenemedi), reklamlar, Premium hesap, gömülü oynatıcı. Yalnız Brave'de (Chromium 120+) denendi.

### Desteklenen siteler

| Site | Yol | Gerçek yalnız ses mi? | Fallback |
|---|---|---|---|
| YouTube (VOD) | Sayfa bağlamında `audio_only` player değişkeni kancası; SABR yalnız ses gönderir | Evet | 144p |
| YouTube (canlı) | Kanca canlı oynatmayı bozduğu için kullanılmaz | Hayır, yalnız fallback | 144p |
| Twitch (canlı) | `declarativeNetRequest` ile playlist isteğine `allow_audio_only=true` + oynatıcıda `audio_only` kalitesi | Evet | 160p |
| Kick (canlı) | IVS playback isteğinde aynı yaklaşım | Evet | 160p |
| Diğer siteler (siz eklersiniz) | Genel adaptör: `<video>` gizlenir, kapak gösterilir | Hayır. İndirme ve çözme sürer; kazanç sınırlı | En iyi çaba |

YouTube canlı: 144p fallback ağı ~%42 azaltır (90 → ~51 KB/sn) ama video yine çözülür; CPU ve JS yığını uzantı kapalıyken olduğundan biraz yüksektir. Bant genişliğinden çok CPU/bellek önemliyse canlı yayınlarda uzantıyı kapatın.

YouTube, Twitch ve Kick yolları belgelenmemiş site iç yapılarına dayanır; site güncellenince kırılabilir, o durumda fallback devreye girer. Bkz. [docs/recon.md](docs/recon.md).

### Kurulum

1. Bu depoyu indirin (ya da sürüm zip'ini çıkarın).
2. `brave://extensions` (veya `chrome://extensions`) adresini açın.
3. **Geliştirici modu**nu açın.
4. **Paketlenmemiş öğe yükle**'ye tıklayıp [extension/](extension/) klasörünü (`manifest.json`'ın bulunduğu klasör) seçin.

Tarayıcı uzantıyı bu klasörden okur; klasörü silerseniz veya taşırsanız uzantı kaybolur.

### Kullanım

- Desteklenen bir siteyi açın; uzantı açıkken yalnız ses otomatik başlar. Önceden açık sekmeler, uzantıyı açıp kapattıktan sonra yenilenmelidir.
- Araç çubuğu popup'ında ana anahtar ve site anahtarları (YouTube / Twitch / Kick) bulunur.
- **Site ekleme:** sayfayı açın, uzantı simgesine tıklayın, **Bu siteyi ekle**'ye basın ve tarayıcının istediği izni verin. Sayfayı yenileyin. Kaldırmak için **Bu siteyi kaldır** ya da popup'taki listeden **Kaldır**. Yerleşik siteler ve http/https dışı sayfalar eklenemez.
- **Videoya dön:** oynatıcının yerini alan kapaktaki **Videoya dön** düğmesi normal oynatıcıyı geri getirir.

### Bilinen sınırlar

Ayrıntı: [docs/known-issues.md](docs/known-issues.md).

- YouTube canlı gerçek yalnız ses değildir (yukarıya bakın).
- Twitch ve Kick'te `audio_only` ile 160p arasındaki ağ farkı küçüktür (~%15); asıl kazanç çözmenin durmasıdır.
- Twitch'te oynatıcı `audio_only` geçişinden sonra ara sıra duraklayabilir; uzantı geçişi oynatmanın ilk 5 sn'sinden sonra yapar.
- Kick, otomasyona Cloudflare bot kontrolü gösterebilir; bu uzantıyı değil testleri etkiler.

### Testler

```
npm install      # Playwright ve eslint; tarayıcı indirilmez
npm test         # npx playwright test
npm run lint
```

Testler sistemdeki Brave'i (`C:\Program Files\BraveSoftware\Brave-Browser\Application\brave.exe`) Playwright dışında `--remote-debugging-port` ile başlatır ve `chromium.connectOverCDP` ile bağlanır. Her çalıştırma ayrı, geçici bir `--user-data-dir` kullanır ve sonunda siler; gerçek profilinize dokunulmaz. Testler canlı sitelere erişim gerektirir.

Paket: `powershell -File scripts/package.ps1` → `dist/audio-only-v<sürüm>.zip`.

### Teşekkür ve lisans

YouTube'da yalnız ses kancası fikri için [ganeshkumar269/audio-only-for-youtube](https://github.com/ganeshkumar269/audio-only-for-youtube) projesine teşekkürler; ayrıntı: [THIRD_PARTY.md](THIRD_PARTY.md). Lisans: [MIT](LICENSE).
