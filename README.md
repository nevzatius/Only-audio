# Only Audio

Brave (ve diğer Chromium tabanlı tarayıcılar) için MV3 uzantısı. Hedef: video sitelerinde videoyu indirmeden ve çözmeden **yalnız sesi** oynatmak; ağ, çözme ve tampon belleği kullanımını düşürmek. Oynatıcının yerini bir kapak alır; "Videoya dön" düğmesiyle görüntü geri gelir.

Sürüm: 0.3.0. Ölçüm sonuçları: [docs/results.md](docs/results.md). Bilinen sorunlar: [docs/known-issues.md](docs/known-issues.md).

## Desteklenen siteler

"Gerçek yalnız ses" = sunucudan video hiç istenmez/çözülmez (çözülen kare 0, `videoWidth` 0). "Fallback" = video yine iner, ama en düşük kalitede (YouTube 144p, Twitch/Kick 160p); bunu yalnız gerçek yol çalışmazsa veya kullanılamıyorsa kullanırız.

| Site | Kullanılan yol | Gerçek yalnız ses mi? | Fallback |
|---|---|---|---|
| YouTube (VOD) | Sayfa bağlamında `audio_only` player değişkeni kancası; SABR yalnız ses gönderir | **Evet** | 144p |
| YouTube (canlı yayın) | Kanca oynatmayı bozduğu için **kullanılmaz** | **Hayır, yalnız fallback** | 144p (ileri arabellek 8 sn ile sınırlı; bkz. [bilinen sorunlar](docs/known-issues.md)) |
| Twitch (canlı) | `declarativeNetRequest` ile master playlist isteğine `allow_audio_only=true` + oynatıcıda `audio_only` kalitesi | **Evet** | 160p |
| Kick (canlı) | `declarativeNetRequest` ile IVS playback isteğine `allow_audio_only=true` + oynatıcıda `audio_only` kalitesi | **Evet** | 160p |
| Eklediğiniz siteler | Genel adaptör: `<video>` gizlenir, kapak gösterilir; bulunursa hls.js benzeri oynatıcı en düşük kaliteye çekilir | **Hayır.** İndirme ve çözme durmaz; kazanç görünürlük/kapak, tarayıcının gizli sekme tasarrufu | En düşük kalite yalnızca en iyi çabayla |

Notlar:

- YouTube VOD, Twitch ve Kick yolları belgelenmemiş site iç yapılarına dayanır (player değişkeni, React fiber, IVS oynatıcı örneği). Site güncellemesiyle kırılabilirler; kırılırsa fallback devreye girer. Ayrıntı ve riskler: [docs/recon.md](docs/recon.md).
- YouTube'da video parçasını ağ düzeyinde engellemek mümkün değildir (ses ve video aynı isteğin gövdesinde ayrışır), bu yüzden YouTube'da DNR kullanılmaz.
- Chromium, gizli sekmede video çözmeyi zaten ~10 sn sonra durdurur ama indirmeyi sürdürür. Uzantının asıl kazancı ağ, tampon belleği ve **görünür ama izlenmeyen** sekmelerdedir.

## Kurulum (Brave: "Paketlenmemiş öğe yükle")

1. [Sürüm paketini](#paket-oluşturma) (`dist/audio-only-v0.3.0.zip`) bir klasöre çıkarın, ya da doğrudan bu deponun [extension/](extension/) klasörünü kullanın.
2. Brave'de `brave://extensions` adresini açın.
3. Sağ üstten **Geliştirici modu**nu açın.
4. **Paketlenmemiş öğe yükle**'ye tıklayın ve `manifest.json` dosyasının bulunduğu klasörü seçin (zip'i çıkardıysanız çıkan klasör).
5. "Only Audio" listede görünür; araç çubuğundaki uzantı simgesinden sabitleyebilirsiniz.

Zip'i çıkarmadan yüklenmez: Brave paketlenmemiş uzantıyı klasörden okur. Klasörü sildiğinizde veya taşıdığınızda uzantı kaybolur.

Kullanım: video sitesini açın; uzantı açıkken ses-only otomatik başlar. Açık sekmeler uzantıyı açıp kapatınca yenilenmelidir. Popup'taki **Uzantı açık** anahtarı her şeyi, site anahtarları (YouTube / Twitch / Kick) yalnız ilgili siteyi kapatır.

## Site ekleme

Yerleşik adaptörü olmayan bir sitede:

1. O sitenin sayfasını açın, uzantı simgesine tıklayın.
2. **Bu siteyi ekle**'ye basın; Brave o alan adı için erişim izni ister, onaylayın.
3. Sayfayı yenileyin: `<video>` gizlenir, kapak görünür.

Kaldırmak için aynı sayfada **Bu siteyi kaldır** ya da popup'taki listeden **Kaldır**. Kaldırma sayfa yenilemeden etkili olur ve verilen site izni geri alınır. http/https dışı sayfalar ile yerleşik siteler (youtube.com, twitch.tv, kick.com) eklenemez.

Bu genel adaptör videoyu **indirmeyi durdurmaz** (yukarıdaki tabloya bakın).

## Bilinen sınırlar

Ayrıntı ve ölçümler [docs/known-issues.md](docs/known-issues.md) ve [docs/results.md](docs/results.md) içinde. Özet:

- **YouTube canlı yayın gerçek yalnız ses değil**, yalnızca 144p fallback. **Ölçüldü: şu an ağı azaltmıyor, artırıyor** (ileri arabellek kırpma aynı segmentleri tekrar indiriyor; 90 KB/sn → 309–445 KB/sn). Canlı yayında uzantıyı YouTube için kapatmanız önerilir; ayrıntı: [docs/results.md](docs/results.md), [known-issues](docs/known-issues.md).
- Gizli sekmede bellek/CPU ölçülemedi (ölçüm ortamında sekme gizlenemedi); görünür sekme sonuçları [docs/results.md](docs/results.md)'de.
- Twitch ve Kick'te audio_only ile 160p arasındaki ağ farkı küçüktür (~%15); asıl kazanç video çözmenin tamamen durmasıdır.
- Twitch'te oynatıcı bazen `audio_only` geçişinden sonra duraklayabilir; uzantı geçişi oynatmanın ilk 5 sn'sinden sonra yapar.
- Kick, otomasyona karşı Cloudflare bot kontrolü uygulayabilir; bu uzantıyı değil testleri etkiler.
- Reklam sırasındaki davranış ölçülmedi. VOD/klip (Twitch/Kick), `music.youtube.com`, gömülü oynatıcı ve Premium hesap ölçülmedi.
- Yalnız Brave (Chromium 120+) üzerinde denendi.

## Geliştirme

```
npm install                 # Playwright ve eslint (tarayıcı indirilmez; sistemdeki Brave kullanılır)
npm test                    # Playwright + sistem Brave'i (CDP ile bağlanır); canlı siteler gerekir
npm run lint
node scripts/measure.ts     # Faz 4 ölçümü; sonuçlar docs/results-raw.json, özet docs/results.md
```

Testler ve ölçüm her zaman ayrı bir `--user-data-dir` profili kullanır (çalıştırma sonunda silinir); gerçek Brave profilinize dokunulmaz. Brave yolu: `C:\Program Files\BraveSoftware\Brave-Browser\Application\brave.exe`.

### Paket oluşturma

```
powershell -File scripts/package.ps1      # dist/audio-only-v<sürüm>.zip (sürüm manifest.json'dan)
```

`dist/` git'e eklenmez. Paket yalnız `extension/` içeriğidir (`_metadata/` hariç).
