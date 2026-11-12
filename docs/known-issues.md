# Bilinen sorunlar

## Kick: Cloudflare bot kontrolü testi engelleyebilir

`tests/kick.spec.ts`, kick.com bir Cloudflare/bot kontrolü sayfası döndürürse `test.skip` ile atlanır. Atlama gerekçesi test çıktısında görünür ("Kick Cloudflare/bot kontrolü sayfası döndürdü…" + gözlenen belirti).

- **Algılama** (`kickBotCheck`, [tests/helpers/sites.ts](../tests/helpers/sites.ts)): `cf-mitigated` yanıt başlığı, "Just a moment…" / "Attention Required" sayfa başlığı ya da Kick uygulaması yüklenmemişken challenge formu.
- **Engel aşılmaz.** UA veya bayrak değişikliği, stealth eklentisi, tekrar döngüsü kullanılmaz. Atlanan çalıştırma Kick adaptörünü doğrulamış sayılmaz; test engelsiz bir ağda/zamanda yeniden çalıştırılmalıdır.
- **Kapsam:** Engel otomasyona özgüdür (temiz, geçici profil; oturum yok). Uzantının kendisini etkilemez.

### Gözlem günlüğü

| Tarih | Sonuç |
|---|---|
| 2026-11-11 | Engel çıkmadı (keşif ölçümü, recon §3; Faz 2b çalıştırmaları). |

## Twitch: oynatma başlar başlamaz audio_only geçişi oynatıcıyı öldürüyordu (düzeltildi)

**Belirti:** `tests/twitch.spec.ts` kanala bağlı olarak (ör. shadowkekw) aralıklı başarısız oluyordu: `readyState 0`, `paused`, `currentTime 0`, pencerede 0 bayt; bazen sayfada Hata #4000. Düzeltmeden önceki kayıtlı çalıştırmalarda yaklaşık yarısında görüldü.

**Neden (ölçüldü):** Adaptör içerik oynamaya başlar başlamaz (`currentTime` ≈ 0,5 sn) `audio_only` uyguluyordu. `playing()` neredeyse anında doğru döndüğü için ısınma beklemesi devreye girmiyordu ve oynatıcı sessizce ölüyordu. Oynatmanın 7,8 sn ve 31 sn'sinde yapılan geçişler sorunsuz toparlandı. Kontroller: yalnız DNR açık (adaptör betiği kapalı) 4/4 temiz; adaptör tamamen kapalıyken de temiz.

**İlk hipotez çürütüldü:** Reklam sırasındaki geçişin sorun olduğu düşünüldü; başarısız çalıştırma `ad=false` iken de oluştu, bu yüzden reklam koruması eklenmedi.

**Düzeltme:** `extension/adapters/twitch/main.js`: oynatma başladıysa içerik en az `MIN_PLAY_SEC` (5 sn) oynamadan kalite değiştirilmez. Oynatma hiç başlamazsa eski `WARMUP_MS` davranışı sürer.

**Doğrulama:** shadowkekw üzerinde gerçek test 6/6 geçti.

**Kick (aynı koruma, nedensellik kanıtlanmadı):** Kick adaptörü aynı örüntüyü paylaşıyor ve her çalıştırmada kaliteyi oynatmanın 0,1–1,8. sn'sinde uyguluyordu. Düzeltmeden önce 5 gerçek çalıştırmanın 2'sinde pencere ortasında oynatma duraksadı (`currentTime` artışı +10 ve +31, normal +46,5; ikincisinde bayt sınırı 56 bayt aşıldı). Tanı çalıştırmalarında (4) duraksama yakalanmadı, bu yüzden bu başarısızlıkların erken geçişten mi yoksa canlı yayın dalgalanmasından mı geldiği doğrulanmadı. Aynı `MIN_PLAY_SEC` koruması Kick'e de eklendi; sonrasında 6/6 geçti. Küçük örneklem: sorun yeniden görülürse bu notu gözden geçirin.

## YouTube canlı: ileri arabellek 10 sn eşiğini aşıyor (açık)

**Belirti:** `LIVE_MAX_BUFFER_SEC = 10` eşiğiyle canlı test kırmızı: reklamsız 144p içerikte ileri arabellek 15–33 sn (v0.3.1 çalıştırmasında 26,7 sn). Bu YouTube'un kendi canlı hedefidir; testin diğer iki ölçütü (currentTime artışı, ≤144p) geçer.

**Denenen ve geri alınan çözüm (v0.3.0):** `MediaSource.addSourceBuffer` sarılıp `currentTime + 8 sn` ötesi `SourceBuffer.remove` ile siliniyordu. Eşiği geçirdi ama oynatıcı kırpılan segmentleri tekrar tekrar istedi: 60 sn pencerede segmentlerin %94'ü tekrar, bayt 90 → 309–445 KB/sn ([results.md](results.md)). **v0.3.1'de kaldırıldı.**

**Şimdiki durum (v0.3.1):** Canlıda yalnız 144p fallback, kırpma yok. Tekrar indirme yok, bayt 50–52 KB/sn (kapalı 90). Bedel: renderer CPU/JS yığını kapalıdan biraz yüksek (results.md). Arabellek eşiği testi kırmızı kalır; eşik değiştirilmedi, karar sahibine bırakıldı. Kırpmadan arabelleği sınırlamanın güvenli bir yolu bulunamadı.

**Geri dönüş:** CPU/bellek kapalıdan kötü sayılırsa canlıda adaptör hiçbir şey yapmamalı (kapak "canlıda devre dışı"); bu uygulanmadı, çünkü ağ kazancı net.

**Test notu:** Çerezsiz profilde reklam çıkabilir (ölçülen reklam: 32 sn ve ~144 sn; reklam akışı 876x493 ve tamamen arabelleğe alınıyor). Testler reklam bitene dek bekler/atlanabilir reklamı atlar; ölçüm yalnız içerikte yapılır.
