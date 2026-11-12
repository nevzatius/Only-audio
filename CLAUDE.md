# Only-audio

Brave için MV3 "audio-only" uzantısı. Amaç: arka planda (veya izlenmeyen sekmede) video akışını indirmeden ve çözmeden yalnız sesi oynatmak; bellek, CPU ve ağ kullanımını düşürmek. Hedef siteler: YouTube, Twitch, Kick; yeni siteler adaptör olarak eklenebilmeli.

Keşif sonuçları ve ölçümler: [docs/recon.md](docs/recon.md). Site davranışı hakkında karar vermeden önce orayı oku.

## Kısıtlar

- **Tarayıcı indirme yok.** `playwright install` çalıştırma. Sistemdeki Brave kullanılır: `C:\Program Files\BraveSoftware\Brave-Browser\Application\brave.exe`.
- **Disk kısıtlı.** Yeni bağımlılık eklemeden önce sor. Geçici dosyalar ve test profilleri repo dışında tutulur; her test profili ~200 MB büyür, çalıştırma sonunda silinir.
- Kullanıcının gerçek Brave profiline dokunma; testler her zaman ayrı `--user-data-dir` ile çalışır.
- Playwright 1.65 `node_modules`'ta kurulu; başka test çatısı ekleme.

## Site kararları (özet)

| Site | Yol | Fallback |
|---|---|---|
| YouTube VOD | MAIN world kancası (`audio_only` player değişkeni → SABR yalnız ses) | 144p |
| YouTube canlı | Kanca oynatmayı kırıyor; kullanma | 144p |
| Twitch | DNR ile usher'a `allow_audio_only=true` + oynatıcıda `setQuality(audio_only)` | 160p |
| Kick | DNR ile IVS playback'e `allow_audio_only=true` + `setQuality(audio_only)` | 160p |

**YouTube'da DNR ile video parçası engelleme işe yaramaz.** SABR'da ses ve video aynı `POST /videoplayback` URL'sinden, çoğu zaman aynı yanıtta gelir; ayrım istek gövdesindedir ve DNR gövdeye bakamaz. YouTube adaptörü MAIN world kancası kullanır. DNR yalnız URL düzeyinde iş görebildiği yerde kullanılır (Twitch/Kick master playlist sorgu parametresi).

Chromium gizli sekmede ~10 sn sonra video çözmeyi zaten durdurur ama indirmeye devam eder. Uzantının kazancı ağ, tampon belleği ve görünür-ama-izlenmeyen sekmelerdir.

## Önerilen klasör yapısı

```
extension/
  manifest.json
  background/        service worker: sekme durumu, DNR session kuralları, aç/kapa
  content/           izole dünya köprüsü (uzantı ↔ MAIN world mesajlaşma)
  injected/          MAIN world kancaları (document_start)
  adapters/
    youtube/
    twitch/
    kick/
  rules/             statik DNR kuralları
tests/               Playwright + sistem Brave'i
docs/
```

Her adaptör aynı arayüzü sunar: etkinleştir, devre dışı bırak, durumu doğrula (çözülen kare sayısı ve `videoWidth` ile), fallback'e düş.

## Test düzeneği

Brave'i Playwright dışında başlat, CDP ile bağlan:

```
brave.exe --remote-debugging-port=<port> --user-data-dir=<geçici profil>
          --disable-extensions-except=<extension/> --load-extension=<extension/>
          --mute-audio --autoplay-policy=no-user-gesture-required --no-first-run
→ chromium.connectOverCDP('http://127.0.0.1:<port>')
```

- `launchPersistentContext` uzantıyı yükler ama YouTube'da kullanma: attestation başarısız olur, oynatma ~45. saniyede hata verir. Sekme gizleme de bu modda test edilemez (odak emülasyonu).
- Sekmeyi gizlemek için DevTools HTTP uç noktası: `/json/new`, `/json/activate/<id>`.
- Geçersiz DNR kural JSON'u uzantının sessizce yüklenmemesine yol açar; testler önce uzantı service worker'ının var olduğunu doğrulamalı.
- Başarı ölçütü ağ baytı ve `getVideoPlaybackQuality().totalVideoFrames`; `document.visibilityState`'e sayfa içinden güvenme (Twitch'te gizliyken `visible` döndü).
