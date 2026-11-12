# Faz 5: sekme bazlı ses kontrolcüsü (v0.4.0)

Popup'ta "Ses" bölümü: ses çalan ve sessize alınmış sekmeler, sekme başına 0–100 kaydırıcı, sessize alma düğmesi, başlığa tıklayınca sekmeye geçme. Ses yükseltme (>%100, `tabCapture`) kapsam dışıdır.

## Kararlar

- **Yeni izin yok.** `storage` (session dahil), `tabs.query/update`, `windows.update` ek izin istemez. Bedeli: `tabs` izni olmadığından `tab.url/title/favIconUrl` yalnız host iznimiz olan sitelerde ve aktif sekmede dolu gelir. İzinsiz sitedeki sesli sekme listelenir (`audible`/`muted` sorguları izin istemez) ama başlıksız ve adressizdir; kaydırıcı devre dışıdır, sessize alma çalışır. "Bu siteyi ekle" yalnız adresi görünen (aktif) sekmede önerilir; diğerlerinde sekmeye geçip popup'ı açmak söylenir.
- **Sessize alma yalnız `chrome.tabs.update({muted})`.** Her sitede çalışır, sayfa geri alamaz, öğelerin `muted` değerine dokunulmaz. Öğe düzeyinde yedek yazılmadı: `tabs.update` yalnız sekme yokken hata verir.
- **Ses özelliği "Uzantı açık" anahtarından bağımsızdır.** Eklenen siteler için betik ayrı kayıtlıdır (`oa-vol-<hash>`; `oa-generic-` sayımı değişmez), yalnız izne bağlıdır.
- **Geçersiz kılma yalnız popup'tan değer verilince başlar;** %100'e getirmek kaydı siler ve sitenin kendi ses çubuğunu serbest bırakır.

## Mimari

- **Durum:** `chrome.storage.session`, `vol:<tabId>` → `{volume}`. İçerik betikleri session depolamaya erişemez; tek sahip service worker ([background/volume.js](../extension/background/volume.js)). Sekme kapanınca anahtar silinir (`tabs.onRemoved`).
- **Mesajlar** ([shared/volume.js](../extension/shared/volume.js) `MSG`): `get` (içerik → SW, `sender.tab.id` ile), `set` (popup → SW; yalnız uzantı sayfası gönderebilir, SW kaydeder ve sekmeye `apply` iletir), `apply` / `ping` (SW/popup → içerik).
- **İçerik betiği** ([content/volume.js](../extension/content/volume.js), izole dünya, `document_start`, yalnız üst çerçeve): tüm `video`/`audio` öğelerinin `volume` değerini ayarlar; `MutationObserver` sonradan eklenenleri yakalar; `document` üzerinde yakalama aşamasında `volumechange`, `loadedmetadata`, `loadstart`, `play`, `playing` dinlenir ve yalnız fark varsa yeniden yazılır (döngü yok).
- **Kapsam:** yerleşik siteler için statik `content_scripts` girdisi (`*.youtube.com`, `*.twitch.tv`, `*.kick.com`); eklenen siteler için `syncVolumeScripts` (izin doğrulanmış kalıplar).
- **Popup** ([popup/volume.js](../extension/popup/volume.js)): `tabs.query({audible:true})` ∪ `tabs.query({muted:true})` ∪ değer atanmış sekmeler (`storage.session` anahtarları; sesi durmuş sekmenin sesi geri açılabilsin diye); her sekme sınıflanır: `ok` (izin var, içerik betiği `ping`e yanıt verdi), `no-permission` (adres görünür, izin yok → "Bu siteyi ekle"), `no-access` (adres gizli), `unreachable` (izin var, betik yok → sayfayı yenileyin). Liste açılışta kurulur; sonradan sessizleşen satır popup kapanana dek kalır.

## Testler

- [tests/unit/volume-logic.spec.ts](../tests/unit/volume-logic.spec.ts): saf işlevler.
- [tests/volume.spec.ts](../tests/volume.spec.ts) (proje `volume`, retries 0): iki sekmede yalnız hedefin `video.volume` değeri 0.3 olur (popup kaydırıcısıyla); sessize alma; sonradan eklenen `video`/`audio` ve site geri yazarsa yeniden uygulama, %100'de serbest bırakma; yenilemede kalıcılık ve sekme kapanınca silme; izinsiz sitede devre dışı kaydırıcı; YouTube'da SPA geçişinden sonra değerin korunması.
- **`--mute-audio` ve `tab.audible`:** bu bayrakla Chromium sekmeyi sesli saymaz (deneyle doğrulandı). Bu yüzden `launchBrave({ muteAudio: false })` seçeneği eklendi ve yalnız yerel fixture testleri kullanır; fixture'ın tonu ~-50 dB'dir (kulaklıkta bile duyulmaz, Chromium'un -72 dB sessizlik eşiğinin üstünde). YouTube testi `--mute-audio` ile çalışır; `tab.audible`a bağlı değildir.
- Eklenen site yolu (`customSites` → `oa-vol-*`) ve host iznini içeren geçici uzantı kopyası, `generic.spec.ts` ile aynı düzenektir (izin istemi CDP ile tıklanamaz).

## Bilinen sınırlar

[known-issues.md](known-issues.md) "Ses kontrolcüsü" bölümüne bakın.
