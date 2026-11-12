# Faz 4 ölçüm sonuçları

Tarih: 2026-11-12. Ortam: Brave 1.99.x (Chromium 157), Windows 10, temiz geçici profil, pencere 1300×900, ses kapalı. Ham veri: [results-raw.json](results-raw.json). Betik: [../scripts/measure.ts](../scripts/measure.ts) (`node scripts/measure.ts`).

## Yöntem

- Düzenek: Brave Playwright dışında başlatılır, `connectOverCDP` ile bağlanılır ([recon](recon.md)). Uzantı hep yüklüdür; **"kapalı" = popup ana anahtarının karşılığı `storage.local.enabled=false`** (kapalı koşullarda kare akışı ve `videoWidth > 0` ile doğrulandı).
- Her koşul 2 kez ölçüldü (tekrar 1 / 2). Her koşul yeni profilde, yeni tarayıcıda.
- Hazır olma: oynatma ilerliyor, reklam yok; uzantı açıkken yalnız-ses geçişi tamam (`videoWidth` 0; YouTube canlıda kapak `reason=live`). Ardından 15 sn ısınma, sonra **60 sn ölçüm penceresi**.
- Bayt (KB/sn): CDP `Network` ile ağ baytı (YouTube `googlevideo.com`, Twitch `*.ttvnw.net`, Kick `*.live-video.net`), Worker'lar dahil. Kare: pencere içi `totalVideoFrames` artışı.
- Bellek: `Performance.getMetrics` → `JSHeapUsedSize` (pencere sonu). İşlem belleği: `SystemInfo.getProcessInfo` işlem listesi + Windows `Win32_PerfFormattedData_PerfProc_Process.WorkingSetPrivate` (Görev Yöneticisi "Bellek" sütunu). **Renderer = en büyük renderer işlemi (video sekmesi)**; GPU = GPU işlemi; Toplam = tüm tarayıcı işlemleri (uzantı SW'si ve boş sekmeler dahil, her koşulda aynı). CPU: aynı işlemlerin `cpuTime` farkı / pencere süresi (tek çekirdek yüzdesi).
- Kanallar: Twitch `kato_junichi0817`, Kick `korekore_ch` (başlangıçta izleyici sayısına göre seçildi, tüm koşullarda aynı). YouTube VOD `aqz-KE-bpKQ`, canlı `@LofiGirl/live`. Ölçüm pencerelerinde reklam örneği kaydedilmedi (betik sayar; hiçbir koşulda not düşmedi).

## Gizli sekme: ölçülemedi

Tüm "gizli sekme" koşulları (4 site × kapalı/açık × 2 tekrar) **ölçülemedi**. Bu makinede Brave, arka plana alınan sekmeyi gizli saymadı: `/json/new` + `/json/activate`, `Target.createTarget`/`activateTarget`, pencereyi küçültme ve ikinci büyük pencereyle üstünü kapatma denendi; Playwright olmadan saf CDP ile de `visibilityState` hep `visible` kaldı ve kareler akmaya devam etti. Betiğin ön denetimi (uzantı kapalı YouTube VOD, gizledikten 15 sn sonra 15 sn pencerede) **452 kare** saydı (çözme durmadı), bu yüzden gizli koşullar çalıştırılmadı; ham veride `ölçülemedi` olarak kayıtlı. Nedeni doğrulanmadı (ekran kilidi/oturum durumu olabilir; tahmin). Önceki gizli sekme gözlemi için [recon §4](recon.md) (yalnız kare/bayt; gizliyken bellek hiç ölçülmedi).

## Görünür sekme, 60 sn (iki tekrar: 1 / 2)

| Site | Uzantı | KB/sn | Çözülen kare | videoWidth | JS yığını MB | Renderer MB | GPU MB | Toplam MB | Renderer CPU % | GPU CPU % |
|---|---|---|---|---|---|---|---|---|---|---|
| YouTube VOD | kapalı | 112,5 / 112,6 | 1809 / 1809 | 854 | 53,7 / 55,2 | 287,0 / 289,5 | 76,4 / 77,9 | 524,5 / 533,6 | 17,5 / 16,6 | 6,3 / 5,7 |
| YouTube VOD | açık | 34,3 / 31,7 | 0 / 0 | 0 | 55,0 / 56,1 | 245,6 / 241,1 | 68,1 / 64,1 | 469,6 / 470,0 | 3,9 / 4,2 | 0,1 / 0,1 |
| YouTube canlı | kapalı | 90,9 / 89,9 | 1812 / 1810 | 1280 | 86,2 / 98,0 | 337,8 / 398,9 | 91,5 / 90,4 | 601,6 / 653,3 | 15,1 / 14,8 | 10,8 / 11,4 |
| YouTube canlı | açık (144p fallback) | **444,5 / 308,8** | 1201 / 1212 | 256 | 117,3 / 118,6 | 602,7 / 435,3 | 93,8 / 92,7 | 876,4 / 674,4 | 20,4 / 18,4 | 9,4 / 8,8 |
| Twitch | kapalı | 417,6 / 382,7 | 3616 / 3613 | 1280 | 103,8 / 145,7 | 626,2 / 751,4 | 101,6 / 102,2 | 892,4 / 1024,5 | 36,4 / 37,6 | 18,7 / 18,8 |
| Twitch | açık (audio_only) | 33,8 / 33,9 | 0 / 0 | 0 | 111,9 / 125,7 | 538,8 / 670,5 | 87,4 / 89,3 | 787,8 / 921,4 | 30,5 / 33,5 | 9,7 / 9,1 |
| Kick | kapalı | 439,8 / 440,3 | 3613 / 3612 | 1280 | 65,4 / 69,4 | 542,9 / 549,6 | 119,7 / 134,3 | 914,3 / 942,0 | 55,7 / 56,7 | 53,0 / 54,4 |
| Kick | açık (audio_only) | 30,1 / 30,3 | 0 / 0 | 0 | 62,2 / 86,6 | 455,8 / 504,9 | 106,6 / 110,8 | 759,5 / 867,0 | 51,2 / 49,3 | 43,6 / 43,0 |

Okuma:

- **Ağ ve çözme:** YouTube VOD, Twitch ve Kick'te beklenen kazanç ölçüldü: bayt ~3,4× (VOD), ~12× (Twitch), ~14× (Kick) düştü; çözülen kare 0. Twitch/Kick "kapalı" varsayılan kalitesi 720p–1080p kaynak.
- **Bellek ve CPU:** Renderer belleği açıkken düşük çıktı (VOD ~%15, Twitch/Kick ~%10–15), ama tekrarlar arası oynaklık (Twitch kapalı 626 / 751 MB) fark kadar büyük; Twitch/Kick bellek farkı **kesin sayılmamalı**. En net kazanç YouTube VOD'da: renderer CPU ~%17 → ~%4, GPU CPU ~%6 → ~%0,1. Twitch/Kick açıkken renderer CPU'su yalnız ~%10–15 düştü; kare çözülmemesine rağmen yüksek kalmasının nedeni ölçülmedi. Kick'te GPU CPU yalnız ~%20 azaldı; nedeni ölçülmedi.
- **YouTube canlı uzantı açıkken kapalıdan KÖTÜ:** bayt 3,4–4,9× **arttı** (90 → 309–445 KB/sn); JS yığını ve renderer CPU'su da arttı, renderer belleği iki tekrarda farklı yönde ama ortalamada yüksek. Aşağıya bakın.

## YouTube canlı: arabellek kırpma segmentleri yeniden indirtiyor

Uzantı canlı fallback'te `SourceBuffer.remove` ile `currentTime + 8 sn` ötesini siliyor. Ölçüm, her `/videoplayback` yanıtının UMP `MEDIA_HEADER` parçalarını çözüp (itag, segment sıra no, başlangıç aralığı) üçlüsünün kaç kez geldiğini sayar (`init` segmentleri hariç). Tüm oturum ve 60 sn pencere ayrı sayılır.

| Uzantı | Tekrar | İstek | Çözülen yanıt | Segment (başlık) | Benzersiz | Tekrar eden | Tekrar baytı | Toplam medya | Pencere: segment | Pencere: tekrar | Pencere: tekrar baytı |
|---|---|---|---|---|---|---|---|---|---|---|---|
| kapalı | 1 | 27 | 20/20 | 39 | 38 | 1 | 0,3 MB | 8,6 MB | 22 | 0 | 0 |
| kapalı | 2 | 26 | 18/19 | 38 | 38 | 0 | 0 | 8,2 MB | 22 | 0 | 0 |
| açık | 1 | 170 | 165/169 | 611 | 48 | **563** | 33,8 MB | 37,4 MB | 435 | **409** | 24,6 MB |
| açık | 2 | 182 | 172/181 | 585 | 58 | **527** | 32,5 MB | 36,4 MB | 295 | **275** | 16,7 MB |

Sonuç: **evet, yeniden indiriyor, ve çok.** Kapalıyken hemen hiç tekrar yok (≤1 segment); açıkken 60 sn pencerede gelen segmentlerin %94'ü (409/435 ve 275/295) daha önce alınmışın tekrarı. İndirilen medyanın ~%90'ı tekrar. Bu yüzden 144p fallback'in beklenen ~27 KB/sn'si yerine 309–445 KB/sn ölçüldü; uzantı kapalıyken (720p) 90 KB/sn. Yani canlıda uzantı şu an ağı **azaltmıyor, artırıyor**. Bu betik yalnız ölçer; uzantı koduna dokunulmadı. Bkz. [known-issues.md](known-issues.md).

Sınırlar: UMP başlık alan numaraları (itag 3, sıra no 9, aralık 6, header_id 1) `googlevideo` kitaplığı belgelerinden hatırlanarak alındı; çıktıyla (bilinen itag'ler, artan sıra no, makul medya boyutları) tutarlı ama resmi şemayla doğrulanmadı. "Aralık" alanı 0 geldiği için parçalı teslimden ayırt edilmez; ancak kapalıyken aynı yöntem ≤1 tekrar saydığından sayılan tekrarlar parçalı teslimle açıklanamaz. Tek yayın (Lofi Girl), 2 tekrar. "Toplam medya" bayt sütunu yanıttaki MEDIA parçalarının toplamıdır, ağ baytından (üstteki KB/sn) biraz farklı olabilir.

## Ölçülemeyenler / sınırlar

- Gizli sekme (yukarıda), tüm siteler.
- Twitch/Kick'te sayfa arayüzünün CPU/bellek payı ayrıştırılmadı.
- Tek kanal/yayın, 2 tekrar: oynaklık yüksek; sonuçlar eğilim gösterir, güven aralığı verilmez.
