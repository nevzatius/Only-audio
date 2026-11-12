# Keşif: Brave için MV3 "audio-only" uzantısı

Tarih: 2026-11-11. Ortam: Brave 1.99.56 (Chromium 157.0.8103.50), Windows 10, oturum açılmamış temiz profil, Brave Shields varsayılan ayarda, pencere 1300×900.

Etiketler: **[ölçüldü]** = bu makinede Brave ile canlı doğrulandı. **[kaynak]** = yalnızca dış kaynaktan, burada doğrulanmadı.

Ölçülmeyenler: işlem düzeyinde bellek ve CPU. Aşağıdaki kazançlar ağ baytı ve çözülen video karesi (`getVideoPlaybackQuality().totalVideoFrames`) üzerinden verilmiştir.

## Özet kararlar

| Site | trueAudioOnly | Yol | Fallback | Durum |
|---|---|---|---|---|
| YouTube VOD | **Evet** | MAIN world kancası: oynatıcının `audio_only` player değişkeni | 144p (`setPlaybackQualityRange('tiny')`) | [ölçüldü] |
| YouTube canlı | **Hayır (bu kancayla)** | Kanca sonsuz arabelleğe almada kalıyor | 144p; ~4,4× daha az bayt | [ölçüldü] |
| Twitch canlı | **Evet** | DNR ile usher isteğine `allow_audio_only=true` + oynatıcıda `setQuality(audio_only)` | 160p (`setQuality`) | [ölçüldü], 4 denemede 3 başarı |
| Kick canlı | **Evet** | DNR ile IVS playback isteğine `allow_audio_only=true` + `setQuality(audio_only)` | 160p (`setQuality`) | [ölçüldü], 2 denemede 2 başarı |

DNR'ın rolü: YouTube'da işe yaramaz; Twitch ve Kick'te yalnızca master playlist isteğine sorgu parametresi eklemek için kullanılır. Hiçbir sitede "video parçasını engelle" yaklaşımı kullanılmıyor.

## 1) YouTube

### Akış yapısı

- Web istemcisi (`c=WEB`, `cver=2.20261106.00.00`) VOD'da da canlıda da **SABR** kullanıyor. Player yanıtında `serverAbrStreamingUrl` var, 40 adaptif formatın hiçbirinde doğrudan URL yok, HLS/DASH manifesti yok. [ölçüldü]
- Medya istekleri: sayfanın ana iş parçacığından `fetch` ile `POST https://*.googlevideo.com/videoplayback?...&sabr=1&alr=yes&rn=<sayaç>`. Gövde protobuf (~2 KB), yanıt `application/vnd.yt-ump`. [ölçüldü]
- URL'de `itag`, `mime`, `range` yok. Ses ve video aynı URL kalıbından geliyor; yanıtların çoğunda ikisi **aynı UMP yanıtında** karışık (ör. VOD'da `251+397`, canlıda `140+247`). [ölçüldü]
- İstek gövdesi → `clientAbrState` (alan 1) → alan 40 etkin iz modu. Web oynatıcı varsayılanda **3** gönderiyor (kaynaklarda "0/boş = ikisi" yazıyor, ölçüm 3 gösterdi). `1` = yalnız ses. [ölçüldü]
- Canlı yayın da aynı SABR POST kalıbı (ses itag 140, video 244/247). [ölçüldü]
- Yanıtlarda `STREAM_PROTECTION_STATUS` (UMP parça 58) var: 1 = tamam, 2 = bekliyor, 3 = attestation gerekli. 3 gelince sunucu medya göndermeyi kesiyor. Test altyapısı bölümüne bakın. [ölçüldü]

### declarativeNetRequest ile video parçası engelleme: çalışmaz

- DNR koşulları URL, yöntem, kaynak türü, başlatan alan adı ve yanıt başlığıyla sınırlı; istek gövdesine bakamıyor. [kaynak: Chrome DNR referansı]
- Ses/video ayrımı URL'de değil protobuf gövdesinde ve yanıt içinde. URL ile ayırt edilecek bir "video parçası" isteği yok. [ölçüldü]
- Tüm `videoplayback` isteklerini engellemek sesi de keser. Sonuç: YouTube'da DNR kullanılmayacak.

### trueAudioOnly: MAIN world kancası (VOD'da çalışıyor)

`document_start`'ta sayfa bağlamında `Object.prototype.audio_only` getter'ı `'1'` döndürünce oynatıcı SABR'dan yalnız ses istiyor (yöntem: `ganeshkumar269/audio-only-for-youtube`). [ölçüldü]

Big Buck Bunny (`aqz-KE-bpKQ`), 480p'de oynuyor (oynatıcı boyutu 854×480), 90 sn:

| | googlevideo baytı | İstenen itag | Çözülen kare | `videoWidth` | Alan 40 |
|---|---|---|---|---|---|
| Kancasız | 12,93 MB (ses 3,76 + video 9,16) | 251 + 397 | 1555* | 854 | 3 |
| Kancalı | 3,12 MB (yalnız ses) | 251 | 0 | 0 | 1 |

\* Bu çalıştırmada sekme 45 sn gizliydi; görünür kalsaydı ~2700 olurdu.

- 60. saniyede kancalı 2,16 MB, kancasız ~8,4 MB. Yaklaşık 4× az bayt; daha yüksek çözünürlükte fark büyür.
- Kancalıyken oynatma kesintisiz sürdü (90 sn'de `currentTime` 89).

### Canlıda kanca çalışmıyor

Lofi Girl canlı yayını (`/@LofiGirl/live`), iki denemede aynı sonuç: [ölçüldü]

- Oynatıcı alan 40 = 1 ile istek atıyor, sunucu yalnız ses (itag 140, parça başı ~82 KB) gönderiyor.
- Ama `video.buffered` boş kalıyor, `readyState` 0, oynatıcı durumu 3 (arabelleğe alıyor). 60+ sn boyunca oynatma başlamadı. `seekToLiveHead()` + `playVideo()` düzeltmedi.
- Neden bilinmiyor (ses parçaları SourceBuffer'a eklenmiyor gibi görünüyor).

Canlı için fallback ölçümü, 60 sn:

| | Bayt hızı | Not |
|---|---|---|
| Varsayılan (720p'ye çıktı) | ~121 KB/sn | 7,29 MB / 60 sn |
| `setPlaybackQualityRange('tiny','tiny')` → 144p (itag 278) | ~27 KB/sn | Geçişte ~5 sn yeniden arabelleğe alma |
| Kuramsal yalnız ses | ~16 KB/sn | Ulaşılamadı |

### Riskler

- `audio_only` belgelenmemiş bir player değişkeni; YouTube adını değiştirirse kanca sessizce etkisiz kalır. Uzantı bunu algılamalı (`videoWidth > 0` veya kare sayısı artıyorsa kanca tutmamıştır).
- `Object.prototype`'a özellik eklemek sayfadaki başka kodu etkileyebilir (ör. `'audio_only' in obj` kontrolleri). Reklam oynatımıyla etkileşimi ölçülmedi (Shields reklamları engelliyordu).
- Kanca oynatıcı yüklenmeden kurulmalı; açma/kapama videonun yerinde yeniden yüklenmesini gerektirir.
- Canlı yayında kanca oynatmayı kırıyor: uzantı canlıyı algılayıp (`getVideoData().isLive`) kancayı devre dışı bırakmalı, 144p'ye düşmeli.
- Yalnızca `www.youtube.com` ölçüldü; `music.youtube.com`, gömülü oynatıcı ve oturum açmış/Premium hesap ölçülmedi.

## 2) Twitch

### Akış yapısı

- Master playlist: `GET https://usher.ttvnw.net/api/v2/channel/hls/<kanal>.m3u8` (usher v2). Parametreler: `allow_source, platform=web, player_backend=mediaplayer, player_version=1.59.0-rc.1, supported_codecs=av1,h265,h264, playlist_include_framerate, include_unavailable, transcode_mode=cbr_v1, sig, token, ...`. **`allow_audio_only` yok.** [ölçüldü]
- Playlist ve segment isteklerinin tamamı **Worker içinden** çıkıyor (`blob:https://www.twitch.tv/...` worker'ları). Segmentler `*.cloudfront.hls.ttvnw.net`, medya playlist'leri `*.playlist.ttvnw.net`. [ölçüldü]
- Varsayılan master'da `audio_only` varyantı listelenmiyor ama `com.amazon.ivs.unavailable-media` oturum verisinde duruyor: `{"STABLE-VARIANT-ID":"audio_only","BANDWIDTH":160000,"CODECS":"mp4a.40.2","FILTER_REASONS":["FR_AUDIO_DISALLOWED"]}`. Yani sunucuda var, web isteği izin vermediği için süzülüyor. [ölçüldü]
- Oynatıcının kalite listesi (kanal `eslcs`): 1080p60, 720p60, 480p, 360p, 160p. Web arayüzünde "yalnız ses" seçeneği yok. [ölçüldü]

### trueAudioOnly yolu

1. DNR `redirect` + `queryTransform` ile usher isteğine `allow_audio_only=true` eklenir. İmza (`sig`) bozulmuyor; master'a `audio_only` (160 kbps AAC) ekleniyor. Worker kaynaklı istek olmasına rağmen DNR kuralı uygulandı (`resourceTypes: ["xmlhttprequest"]`, `urlFilter: "||usher.ttvnw.net/api/v2/channel/hls/"`). [ölçüldü]
2. MAIN world'de oynatıcı örneği bulunur: `.video-player` öğesinin React fiber'ından 23 üst düğümde `mediaPlayerInstance` prop'u. `getQualities()` → `audio_only` → `setAutoQualityMode(false)` + `setQuality(q)`. [ölçüldü]

Worker `fetch` kancası gerekmedi; content script worker'a giremediği için bu önemli bir sadeleşme.

Ölçüm (`eslcs`, otomatik kalite 720p60'a oturdu):

| | Bayt hızı | Çözülen kare | `videoWidth` |
|---|---|---|---|
| Varsayılan 720p60 | ~440 KB/sn | 60 kare/sn | 1280 |
| 160p (fallback) | ~40 KB/sn | 30 kare/sn | 284 |
| audio_only | ~34 KB/sn | 0 | 0 |

audio_only ile 160p arasındaki ağ farkı küçük (~%15); asıl fark video çözmenin tamamen durması.

### Riskler

- **Güvenilirlik:** 4 geçişten 1'inde oynatıcı `setQuality(audio_only)` sonrası duraklamış halde kaldı (`paused`, `currentTime` 0, segment indirme durdu). Neden bilinmiyor; o denemede geçiş öncesi kalite 1080p kaynaktı. Uzantı geçişten sonra oynatmayı doğrulamalı, gerekirse `play()` / 160p'ye düşmeli.
- React fiber yolu ve `mediaPlayerInstance` adı belgelenmemiş; Twitch arayüz güncellemesiyle kırılabilir.
- `allow_audio_only` parametresinin sunucuda kabulü Twitch'in tercihine bağlı; kaldırılırsa fallback 160p.
- Transcode'u olmayan küçük kanallarda 160p bulunmayabilir (yalnız kaynak kalite). Ölçülmedi. [kaynak]
- Reklam arası sırasında davranış ölçülmedi (preroll'de yayın gömülü reklamla başladı; geçiş reklamdan sonra yapıldı).
- Gizli sekmede sayfa içinden okunan `document.visibilityState` Twitch'te `visible` kaldı (YouTube'da `hidden` döndü). Neden doğrulanmadı. Görünürlük MAIN world'den değil, uzantı tarafından (`chrome.tabs`) belirlenmeli.
- VOD ve klipler ölçülmedi.

## 3) Kick

### Akış yapısı

- Oynatıcı Amazon IVS Web SDK **1.56.2** (`https://kick.com/ivs/1.56.2/amazon-ivs-wasmworker.min.js`). [ölçüldü]
- Master playlist: `GET https://<id>.us-west-2.playback.live-video.net/api/video/v1/us-west-2.<hesap>.channel.<id>.m3u8?token=<JWT>&platform=web&player_version=1.56.2&supported_codecs=av1,h265,h264&...`. **Worker içinden** çekiliyor. Segmentler `*.cloudfront.hls.live-video.net`. [ölçüldü]
- Kalite listesi (kanal `adinross`): 1080p60 (kaynak), 720p60, 480p, 360p, 160p. Varsayılanda `audio_only` yok. [ölçüldü]

### trueAudioOnly yolu

1. DNR `queryTransform` ile playback isteğine `allow_audio_only=true` (`urlFilter: ".playback.live-video.net/api/video/v1/"`). Token bozulmuyor, kalite listesine `audio_only/160000/mp4a.40.2` ekleniyor. [ölçüldü] IVS dokümanı bunu BASIC/STANDARD kanallar için tarif ediyor, web SDK ≥ 1.24 gerekiyor. [kaynak]
2. MAIN world'de IVS oynatıcı örneği bulunur. `<video id="video-player">`'ın üst fiber'larında prop olarak **yok**; kök fiber ağacı taranınca (776 düğüm) bir bileşenin hook durumunda `hook[5].current.value` altında bulundu. `setAutoQualityMode(false)` + `setQuality(q)`. [ölçüldü]

Ölçüm (`adinross`, otomatik kalite 720p60):

| | Bayt hızı | Çözülen kare | `videoWidth` |
|---|---|---|---|
| Varsayılan 720p60 | ~450 KB/sn | 60 kare/sn | 1280 |
| 160p (fallback) | ~41 KB/sn | 30 kare/sn | 284 |
| audio_only | ~34 KB/sn | 0 | 0 |

### Kanala göre audio_only bayt hızı (Faz 2b, 2026-11-11)

Uzantı yüklüyken, geçişten sonra 30 sn pencere. Dört kanalda da kare artışı 0, `videoWidth` 0. [ölçüldü]

| Kanal | Segment (.ts) | Playlist | Toplam |
|---|---|---|---|
| adinross | 217 kbps | ~3,5 KB/sn | 30,7 kB/sn |
| sxb | 219 kbps | ~3,7 KB/sn | 31,2 kB/sn |
| ceybie | 318 kbps | ~4,0 KB/sn | 43,8 kB/sn |
| baran | 331 kbps | ~3,5 KB/sn | 45,0 kB/sn |

- Oynatıcı her kanalda `audio_only` için `bitrate: 160000` bildiriyor; gerçek hız kanalın kaynak sesine göre değişiyor. Bildirilen değere güvenilmez.
- Twitch'te de aynı etki: `eliasn97` kanalında audio_only 41,7 kB/sn (kare 0, `videoWidth` 0).
- Sonuç: sabit 40 KB/sn test eşiği bazı kanallarda hiçbir uygulamayla tutmaz; testlerde bayt eşiği 60 KB/sn yapıldı (kullanıcı onayı). Yalnız-ses ile 160p ayrımı bayttan değil kare sayısı ve `videoWidth`'ten yapılır.
- Kapak kapsayıcısı: `video#video-player`'ın ebeveyni (`div.relative.aspect-video`); kararlı seçici yok. Kök fiber ağacı 1115 düğüm; oynatıcı hook durumunda bulundu.
- Çerez onayı (OneTrust) katmanı bazı yüklemelerde sayfayı örtüyor; otomasyonda kapatılmalı.
- `initiatorDomains: ["kick.com"]` koşulu Worker kaynaklı playback isteğinde tuttu.

### En düşük kaliteye zorlama

Aynı oynatıcı örneğinde `getQualities()` içinden en düşük `bitrate`'li girdiyi `setQuality` ile seçmek yetiyor; 160p'ye geçiş ~1 sn içinde oldu. `localStorage`/`sessionStorage`'da kalite anahtarı bulunmadı (yalnız IVS cihaz yapılandırma anahtarları). [ölçüldü]

### Riskler

- Oynatıcıya giden yol (hook sırası, `.current.value`) Twitch'tekinden daha kırılgan; sabit yol yerine "`getQualities` ve `setQuality` metodları olan nesneyi ara" şeklinde yapısal arama gerekir.
- Kick'in kanal türünü değiştirmesi veya IVS'in `allow_audio_only`'yi kapatması halinde fallback 160p.
- Yalnız 2 deneme, tek kanal. Cloudflare engeli bu ölçümde çıkmadı; otomasyonda her zaman çıkmayacağı garanti değil.
- VOD/klip ve gizli sekme davranışı Kick'te ölçülmedi.

## 4) Chromium gizli/arka plan sekmede video izini kapatıyor mu?

**Evet, ama yalnız çözmeyi; indirmeyi değil.** [ölçüldü]

- Sekme gizlendikten **~10 sn sonra** çözülen kare sayısı duruyor, sekme geri gelince devam ediyor. YouTube VOD, YouTube canlı ve Twitch'te gözlendi.
  - YouTube VOD: gizlemeden 5 sn sonra 1231 kare, 10 sn sonra 1378, sonraki 35 sn boyunca 1378.
  - Twitch: 10 sn sonra 2199'da sabit.
- İndirme aynı hızda sürüyor:
  - YouTube VOD: 45 sn gizliyken 6,65 → 11,53 MB; ileri tampon 48 → 94 sn'ye büyüdü.
  - Twitch: 35 sn gizliyken 15,9 → 31,7 MB (~450 KB/sn, görünürkenle aynı).
- Mekanizma: `WebMediaPlayerImpl::ShouldDisableVideoWhenHidden` — hem ses hem video olmalı, PiP/yakalama olmamalı, ortalama keyframe aralığı eşiğin altında olmalı; iz kapatma 10 sn ertelenir. [kaynak: Chromium `web_media_player_impl.cc`]

Uzantı açısından sonuç:

- Gizli sekmede video **decode CPU** kazancının çoğu zaten tarayıcıdan geliyor. Uzantının ek kazancı: ağ, MSE tampon belleği, demux ve ilk 10 sn.
- Görünür ama izlenmeyen sekmede (ikinci monitör, başka pencerenin arkası) tarayıcı bir şey yapmıyor; orada kazancın tamamı uzantıdan gelir.
- Bellek/CPU kazancı sayısal olarak henüz ölçülmedi; Faz 1'de görev yöneticisi düzeyinde ölçülmeli.

## Test altyapısı: paketlenmemiş uzantı yükleme

Soru: Playwright `launchPersistentContext` ile Brave'e `--load-extension` / `--disable-extensions-except` kullanarak paketlenmemiş uzantı yüklenebiliyor mu?

**Evet.** Boş bir MV3 uzantısı (service worker + `world: "MAIN"`, `document_start` content script) ek bayrak gerekmeden yüklendi: service worker `chrome-extension://…/sw.js` olarak göründü, MAIN world işareti sayfada okundu. `ignoreDefaultArgs` veya `DisableLoadExtensionCommandLineSwitch` gerekmedi. [ölçüldü]

Ancak `launchPersistentContext` **YouTube testleri için kullanılamaz**: [ölçüldü]

- Bu modda YouTube'un `STREAM_PROTECTION_STATUS` değeri 2 → 3'e gidiyor, sunucu ~3,5 MB'tan sonra medya göndermeyi kesiyor ve ~45. saniyede oynatıcı "Bir hata oluştu" veriyor. İki denemede aynı. Olası neden Playwright'ın otomasyon bayrakları; doğrulanmadı.
- Ayrıca Playwright odak emülasyonu nedeniyle sekme hiç "gizli" olmuyor (`visibilityState` hep `visible`, kareler durmuyor); arka plan davranışı bu modda test edilemiyor.

**Önerilen düzenek (çalıştığı doğrulandı):** Brave'i Playwright dışında başlat, Playwright'ı CDP üzerinden bağla.

```
brave.exe --remote-debugging-port=<port> --user-data-dir=<geçici profil>
          --disable-extensions-except=<uzantı> --load-extension=<uzantı>
          --mute-audio --autoplay-policy=no-user-gesture-required --no-first-run
→ chromium.connectOverCDP('http://127.0.0.1:<port>')
```

- Uzantı yüklendi, MAIN world content script çalıştı, `navigator.webdriver` false, YouTube koruma durumu 1'e oturdu, 75 sn kesintisiz oynattı. [ölçüldü]
- Gizli sekme testi için Playwright sayfa API'si yerine DevTools HTTP uç noktası (`/json/new`, `/json/activate/<id>`) kullanılmalı; bu yolla `visibilityState` gerçekten `hidden` oldu. [ölçüldü]
- Twitch ve Kick'te attestation sorunu yok; orada her iki mod da çalışır.

Dikkat edilecekler:

- Statik DNR kural dosyası geçersiz JSON ise uzantı `--load-extension` ile **sessizce hiç yüklenmiyor** (service worker hedefi oluşmuyor, hata çıkmıyor). Ölçüm sırasında bozuk bir `rules.json` ile yaşandı. Testler önce uzantının yüklendiğini doğrulamalı.
- Her test profili ~200 MB büyüyor; bu keşifte 6 profil 1,15 GB oldu. Profiller çalıştırma sonunda silinmeli.
- Playwright sürümü 1.65.0 zaten `node_modules`'ta; tarayıcı indirmesi yapılmadı.

Denenmeyen alternatifler (gerek kalmadı): CDP `Extensions.loadUnpacked`, `brave://extensions` üzerinden elle yükleme.

## MV3 notları

- DNR `tabIds` koşulu yalnız session kurallarında var; sekme başına aç/kapa için `updateSessionRules` gerekir. [kaynak]
- `redirect.transform.queryTransform.addOrReplaceParams` için hem hedef hem başlatan alan adına host izni gerekir; `declarativeNetRequestWithHostAccess` ile çalıştı. [ölçüldü]
- Worker'dan çıkan `fetch` istekleri DNR'a `xmlhttprequest` türüyle düşüyor. [ölçüldü]
- Content script worker içine enjekte edilemez; bu keşifteki yolların hiçbiri buna ihtiyaç duymuyor.
- context7 bu oturumda bağlı değildi; MV3 bilgisi doğrudan developer.chrome.com'dan alındı.

## Kaynaklar

- Chrome DNR referansı: https://developer.chrome.com/docs/extensions/reference/api/declarativeNetRequest
- Chrome scripting referansı: https://developer.chrome.com/docs/extensions/reference/api/scripting
- SABR istek yapısı (PipePipe belgeleri): https://priveetee.github.io/Docs-PipePipe/extractor/sabr-request.html
- UMP/SABR kitaplığı: https://github.com/LuanRT/googlevideo
- `audio_only` kancası örneği: https://github.com/ganeshkumar269/audio-only-for-youtube
- yt-dlp SABR indirici PR'ı: https://github.com/yt-dlp/yt-dlp/pull/13515
- Twitch usher v2 geçişi: https://github.com/hua0512/rust-srec/pull/1283
- Twitch worker kancası örneği: https://github.com/ryanbr/TwitchAdSolutions
- Kick kalite zorlama (Enhancer): https://github.com/enhancer-app/enhancer/pull/223
- IVS Player, audio-only: https://docs.aws.amazon.com/ivs/latest/LowLatencyUserGuide/player.html
- Chromium `web_media_player_impl.cc`: https://github.com/chromium/chromium/blob/main/third_party/blink/renderer/platform/media/web_media_player_impl.cc
- Chrome 61 arka plan video izi: https://developer.chrome.com/blog/media-updates-in-chrome-61
