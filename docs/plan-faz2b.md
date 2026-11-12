# Faz 2b sözleşmesi: Kick adaptörü

Faz 1 sözleşmesinin ([plan-faz1.md](plan-faz1.md)) eki. Orada tanımlı mesaj biçimi, kapak, storage şeması ve çalışma kuralları aynen geçerlidir; burada yalnız Kick'e özgü ekler var. Arka plan: [recon.md](recon.md) §3.

## Storage ve kayıt tablosu

```js
{ enabled: true, sites: { youtube: true, twitch: true, kick: true } }
```

`SITES.kick`: `id: 'oa-kick-main'`, `js: ['adapters/kick/main.js']`, `matches: ['*://kick.com/*', '*://www.kick.com/*']`, `ruleset: 'kick'`. Service worker tabloyu dolaştığı için değişmez. Popup: `#toggle-kick`.

## DNR

Statik küme `extension/rules/kick.json` (kimlik `kick`): `.playback.live-video.net/api/video/v1/` isteklerine `allow_audio_only=true`, `initiatorDomains: ["kick.com"]` (IVS alan adı Kick'e özel değil). Host izinleri: `*://*.kick.com/*`, `*://*.live-video.net/*`.

## Adaptör (`extension/adapters/kick/main.js`, MAIN, document_start)

- Oynatıcı örneği: sabit yol yok. `video#video-player` fiber'ından köke çıkılır, ağaç taranır; props, `stateNode` ve hook durumunda (`.current`, `.value`, `.current.value`) `getQualities` + `setQuality` + `setAutoQualityMode` metodları olan nesne aranır. Birden çok aday varsa `getHTMLVideoElement()` ana videoyu döndüren seçilir.
- Durum makinesi Twitch ile aynı: oynatma başlayana dek bekle (en çok 20 sn) → `setAutoQualityMode(false)` + `setQuality(audio_only)` → durum `audio`/`dnr`. İlerleme yoksa `play()` → `setQuality` yinele → en düşük bitrate'li video (`fallback`/`stalled`). `audio_only` yoksa `fallback`/`no-audio-variant`.
- `restore`: `setAutoQualityMode(true)`, `sessionStorage['onlyaudio:kick:bypass']='1'`, durum `off`/`user-restore`.
- `site: 'kick'`. `playerSelector`: Kick'te kararlı bir sınıf/kimlik yok; adaptör `video#video-player`'ın ebeveynini `data-only-audio-player` özniteliğiyle işaretler ve `[data-only-audio-player]` gönderir. Köprü kapağı videonun hemen ardına ekler (denetim katmanının altında kalır).

## Test (`tests/kick.spec.ts`): canlı kanal, geçişten sonra 45 sn pencere

Kanal: `KICK_CHANNEL` ortam değişkeni; yoksa `https://kick.com/browse` sayfasındaki canlı kanal bağlantılarından ilki (oynatma başlamazsa sıradaki, en çok 3 aday). Geçiş sayfadan bağımsız ölçülür: `video#video-player` için `videoWidth === 0` ve `currentTime` ilerliyor (en çok 90 sn), sonra 45 sn pencere.

| Ölçüt | Eşik | Kaynak |
|---|---|---|
| `*.live-video.net` bayt hızı (45 sn pencere) | < 60 KB/sn (45 sn'de < 2 700 000 B) | recon §3 "Kanala göre audio_only bayt hızı": hız kanalın kaynak ses bitrate'ine bağlı (ölçülen 31–45 kB/sn). 2026-11-11'de kullanıcı onayıyla 40 → 60 KB/sn. Varsayılan ~450 KB/sn; yalnız-ses/160p ayrımını kare ve videoWidth ölçütleri yapar |
| pencere içi `totalVideoFrames` artışı | = 0 | recon §3 tablo: audio_only 0 |
| `videoWidth` | = 0 | recon §3 tablo: audio_only 0 |
| pencere içi `currentTime` artışı | ≥ 40 | 45 sn pencere, 5 sn pay |

Kapak: `#only-audio-cover[data-mode="audio"]` görünür.

**Eşikler test geçsin diye gevşetilmez.** (Bayt eşiği değişikliği kullanıcı kararıdır; yukarıdaki kaynağa bakın.)

### Cloudflare / bot kontrolü

Gezinmeden sonra challenge sayfası görülürse (`cf-mitigated: challenge` yanıt başlığı, "Just a moment…" başlığı veya uygulama içeriği yokken challenge formu) test `test.skip` ile açık gerekçeyle atlanır ve [known-issues.md](known-issues.md)'ye işlenir. Engel aşılmaya çalışılmaz: UA/bayrak değişikliği, stealth, tekrar döngüsü yok.
