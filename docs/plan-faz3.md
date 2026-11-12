# Faz 3: genel adaptör ve "Bu siteyi ekle/kaldır"

Kullanıcı, yerleşik adaptörü olmayan bir siteyi çalışma anında ekler. O sitede `<video>` gizlenir, kapak gösterilir ve mümkünse en düşük kaliteye çekilir.

## Davranış

- **Ekle:** popup, aktif sekmenin origin kalıbını (`*://host/*`, tam alan adı, port yok sayılır) `chrome.permissions.request` ile ister. İstek tıklama işleyicisinin ilk işidir (kullanıcı jesti). Onaylanırsa kalıp `storage.local.customSites` listesine yazılır.
- **Kaydı service worker yapar** (`syncCustomSites`, [sw.js](../extension/background/sw.js)): kalıp başına iki betik `chrome.scripting.registerContentScripts` ile kaydedilir:
  - `oa-generic-main-<hash>`: MAIN world `adapters/generic/main.js`, `document_start`.
  - `oa-generic-bridge-<hash>`: izole dünya `content/bridge.js` + `content/cover.css`.
  Yalnız izni gerçekten verilmiş kalıplar kaydedilir; `permissions.onAdded/onRemoved` ve `storage.onChanged` eşitlemeyi yeniden çalıştırır (idempotent, mevcut kuyrukla).
- **Kaldır:** önce ayar silinir (bridge `disable` gönderir: açık sekmede kapak hemen kalkar, video geri görünür), sonra `permissions.remove`. Ana "Uzantı açık" anahtarı da aynı yolla geri alır.
- **"Videoya dön":** yerleşik adaptörler gibi sekme oturumu boyunca kalıcıdır (`sessionStorage`).
- **Eklenemeyenler:** http/https dışı sayfalar ve yerleşik alanlar (youtube.com, twitch.tv, kick.com ve alt alan adları). `normalize` bunları `customSites`'tan atar.
- **Yeni eklenen site açık sekmelerde sayfa yenilenince etkinleşir** (kayıtlı betikler yalnız yeni gezinmelerde çalışır). Kaldırma yenileme gerektirmez.

## Genel adaptör ne yapar, ne yapmaz

- Sayfadaki en büyük (oynayan olan baskın) `<video>` seçilir; 50x50 pikselden küçükler yok sayılır. `visibility:hidden !important` verilir, ebeveyni `data-only-audio-player` ile işaretlenir (statikse `position:relative` verilir ve geri alınır).
- **Video indirmeyi ve çözmeyi durdurmaz.** Düz `<video>` için kalite API'si yoktur. Kazanç görünürlük ve kapaktır; tarayıcının gizli video için yaptığı tasarruf (bkz. CLAUDE.md) bunun ötesinde değişmez.
- **En düşük kalite yalnızca en iyi çabadır:** sayfa global kapsamında hls.js benzeri bir örnek (`levels[]`, `currentLevel`, `autoLevelEnabled`) bulunursa en düşük bit hızına sabitlenir (`mode:'fallback'`, `reason:'lowest-quality'`). Bulunamazsa `mode:'audio'`, `reason:'hidden'`. dash.js/Shaka ve modül kapsamındaki oynatıcılar bulunmaz. Bu sınır ölçülmedi, tasarım gereğidir.
- Ebeveyn `<body>` ise kapsayıcı işaretlenmez ve kapak çıkmaz (tüm sayfayı örtmemek için). Bilinen sınır.

## Test ([tests/generic.spec.ts](../tests/generic.spec.ts))

- Fixture: [tests/fixtures/generic.html](../tests/fixtures/generic.html), video dosyası yok: `canvas.captureStream()` ile çalışma anında üretilen canlı akış (repoya 1 MB'den büyük dosya eklenmez). Yerel `node:http` sunucusundan servis edilir; yeni bağımlılık yok.
- Akış: eklenmeden kapak yok → ekle + yenile → kapak görünür, video gizli → kaldır (yenilemeden) → kapak kaybolur, video görünür, kayıtlar silinir → yenileyince de yok. Ayrıca "Videoya dön", ana anahtar ve popup liste/Kaldır testleri.
- **Sınır (önemli):** `permissions.request` yerel tarayıcı istemini açar; CDP ile onaylanamaz. Bu yüzden test uzantıyı geçici bir kopyadan yükler, kopyanın manifest'ine yalnız `*://127.0.0.1/*` host izni ekler ve `customSites`'ı `storage.local`'a doğrudan yazar. **Popup'taki izin istemi ve "Bu siteyi ekle" düğmesinin gerçek tıklama akışı otomatik doğrulanmadı;** elle doğrulanması gerekir (aşağıdaki liste).
- `retries: 0` (yerel, ağsız).

## Elle doğrulama listesi (otomatikleşmeyen)

1. Brave'de uzantıyı yükle, `https://` bir video sitesini aç, popup'ta "Bu siteyi ekle" → tarayıcı izin istemi çıkmalı.
2. İzin verince sayfayı yenile: video gizli, kapak görünür.
3. Popup'ta "Bu siteyi kaldır": kapak yenilemeden kalkmalı; `brave://extensions` → site erişimi'nde izin silinmiş olmalı.
