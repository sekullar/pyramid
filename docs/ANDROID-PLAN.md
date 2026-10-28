# Pyramid Android ve not eşitleme: plan

Yazıldığı gün: 2026-10-28. Bu belge, "nerede kaldık, sıradaki ne" sorusuna dönüp bakmak için. Henüz **hiçbir kod yazılmadı**,
yalnızca planlandı. Genel plan için bkz. [PLAN.md](PLAN.md); bu belge onun "Mobil ve eşleşme" bölümünün ayrıntısıdır.

## Hedef
Pyramid'in masaüstü sürümündeki her şeyi yapan bir Android uygulaması, üç ek özellikle:
1. Telefonda **yerel yapay zekâ modeli** (Gemma ailesi) seçeneği.
2. Telefon ve bilgisayar **aynı Wi-Fi'deyken notlar iki yönlü eşitlenir**. İki tarafta da farklı notlar yazılmış olabilir,
   hiçbiri kaybolmadan birleşir.
3. Bulut sağlayıcılar (Claude, OpenAI, Gemini) ve bilgisayardaki Ollama telefondan da kullanılabilir.

## Telefon (test cihazı)
Samsung SM-A366B, Snapdragon 6 Gen 3, 7,5 GB RAM (ölçüm anında ~2,7 GB boş), ~16 GB boş depolama. Android 16.

## 1) Telefonda yerel model
Ölçülmedi, aşağıdakiler tahmindir.

| Seçenek | Boyut | Beklenti |
| --- | --- | --- |
| Gemma 3 1B | ~0,6 GB | Hızlı. Kısa özet ve yazım düzeltme için yeterli, Türkçesi zayıf kalabilir. |
| Gemma 3n E2B / Gemma 4 E2B | ~2,6 GB | Telefon için tasarlanmış, daha kaliteli. |
| Gemma 3 4B (istenen) | ~2,5-3 GB (4 bit) + bağlam | Çalışır ama RAM'e sığması zor, Android arka planda öldürebilir. |

- Çalıştırıcı: Google **LiteRT-LM** (GPU/CPU). Gemma 3 4B için hazır LiteRT paketi **bulunamadı**; yoksa llama.cpp + GGUF
  gerekir (ikinci çalıştırıcı, uygulama büyür).
- Mid-range telefonda 4B için yayımlanmış hız ölçümü bulunamadı. Doğru karar için **önce ölçmek** gerekir (aşama 0).
- 1-4B modeller uzun notta ve Türkçede zayıf kalabilir. Çoklu not karşılaştırması telefonda ağır: telefonda uzunluk
  sınırlanır ve kullanıcı uyarılır.
- Yerel model indirilirken kullanıcı onayı alınır (yüzlerce MB - birkaç GB). İndirilen dosya uygulamanın klasöründe durur.

### Telefon için diğer AI yolları
- **Bulut** (Claude, OpenAI, Gemini): doğrudan telefondan, anahtar telefonda şifreli saklanır.
- **Bilgisayarın Ollama'sı**: aynı Wi-Fi'de telefon işi masaüstüne yaptırır. Anahtar ve model telefona gitmez.
  Yerel model yavaş kaldığında en iyi seçenek bu olabilir.
- Her AI işleminde, metnin telefonda mı, bilgisayarda mı, bulutta mı işlendiği görünür (masaüstündeki gibi).

## 2) Not eşitleme (aynı Wi-Fi)
- **Eşleştirme:** masaüstü QR gösterir, telefon okutur (Phoneix'teki gibi). QR'da masaüstü adresleri ve tek seferlik
  anahtar var; tüm trafik AES-GCM ile şifrelenir. Temel: Phoneix'in `PROTOCOL.md` dosyası.
- **Ne zaman:** uygulama açılınca, "Şimdi eşitle" düğmesiyle, istenirse arka planda periyodik (en az 15 dk).
  Telefon başlatır, masaüstü yalnızca dinler.
- **Karar mantığı** (her not `id` ile eşleşir; karar saat farkına değil, son eşitlemedeki içerik özetine - hash - dayanır):
  - Yalnızca bir tarafta olan not karşıya kopyalanır.
  - İki tarafta aynıysa hiçbir şey yapılmaz.
  - Son eşitlemeden beri yalnızca bir taraf değiştiyse o taraf kazanır.
  - **İkisi de değiştiyse:** hiçbiri ezilmez. Biri notun kendisinde kalır, diğeri "Başlık (çakışma - telefon - tarih)" adıyla
    ayrı not olarak kaydedilir.
  - **Silme:** silme kaydı tutulur. Diğer taraf notu silinmeden sonra değiştirdiyse not geri gelir.
- Masaüstüne eklenecek: eşitleme sunucusu, QR eşleştirme ekranı, durum/günlük. Bu mantık önce **Node testleriyle**
  kanıtlanır (yeni, silinen, çakışan, saati kaymış durumlar).

## 3) Android uygulaması
- Yerel **Kotlin** (Phoneix gibi), aynı repoda `android/`. Markdown önizleme için hazır kütüphane.
- Ekranlar: defter/not listesi ve arama, yaz/önizle editörü (otomatik kayıt), AI paneli (Özetle, Yeniden yaz, Düzelt,
  Karşılaştır; Uygula/Kopyala/Vazgeç), Ayarlar (dil TR/EN, model, anahtarlar, eşleştirme), Geri Dönüşüm Kutusu, saf siyah tema.
- Notlar uygulamanın kendi klasöründe, masaüstüyle **aynı `.md` + front matter** biçiminde (`id`, `created`, `updated`, `tags`).
- AI komut metinlerini (`desktop/electron/ai/prompts.js`) Kotlin'e birebir aynı alacağız; ikisi ayrışmasın diye test eklenir.
- Yayın: APK, Hub kataloğunda "Telefon uygulamasını indir" bağlantısı olarak durur (Phoneix gibi). APK imza anahtarı **repoya girmez**.

## 4) Aşamalar
0. **Ölçüm turu:** telefonda 1B, E2B ve 4B için hız ve RAM ölçümü, çalıştırıcı kararı.
1. **Masaüstü eşitleme:** sunucu, QR eşleştirme, eşitleme motoru ve testleri.
2. **Android iskelet:** notlar, editör, siyah tema, TR/EN.
3. **Telefonda eşitleme:** istemci, arka plan, gerçek cihaz testi.
4. **AI:** bulut ve bilgisayarın Ollama'sı, sonra cihazdaki model.
5. **Cilalama ve yayın:** Hub kataloğu, release.

1-3 yapay zekâdan bağımsız çalışır: ölçüm sonucu ne çıkarsa çıksın elimizde işe yarar bir uygulama olur.

## Açık kararlar (cevap bekliyor)
1. Ölçüm turuyla mı başlayalım (**önerilen**), yoksa 4B'yi baştan hedefleyip çalıştırıcıyı ona göre mi seçelim?
2. Arka planda otomatik eşitleme olsun mu (pil yer), yoksa yalnızca uygulama açıkken ve düğmeyle mi?
3. Çakışmada "iki kopya" yöntemi uygun mu?

## Pyramid'in şu anki durumu
- Masaüstü: not klasörü, editör, arama, çöp kutusu, TR/EN, AI (Ollama, Claude, OpenAI, Gemini; özetle, düzelt, yeniden yaz,
  karşılaştır) hazır ve itildi (son commit: "Add AI: Ollama, Claude, OpenAI, Gemini ...").
- **Henüz yayın yok:** `v0.1.0` etiketi atılmadı. Hub kataloğunda Pyramid kayıtlı ama indirilebilir sürüm olmadığı için "Kur"
  çalışmaz. Hub'da Pyramid simgesi için de Hub'ın yeni sürümü gerekir.
- Android uygulaması ve eşitleme: yok (bu belge).

## Diğer projelerde 2026-10-28 sonu durumu (hepsi commit/push BEKLİYOR)
Bu gün yapılanlar yerelde duruyor, hiçbiri commit edilmedi ve yayınlanmadı. Önerilen sürümler: Dynamic Bar 0.6.0, Phoneix 0.3.0.

**Dynamic Bar** (`dynamic-bar`): mikrofon/kamera uyarısı, internet kesintisi uyarısı, oyunda bildirim erteleme, `dynbar run`
bildirimi, pil azaldı maskotu, Legion/LOQ klavye ışığı geri bildirimi (Legion Toolkit gerekir, ayarlarda varsayılan kapalı),
ayarlar sayfası sekmelere bölündü.

**Phoneix** (`phoneix`): aramada PC müziğini duraklatma, SMS doğrulama kodu panoya (telefon ayarı, varsayılan kapalı),
masaüstü ve mobil arayüz sadeleştirme (sekmeler, test düğmeleri gizli menüye), mobil dikey kilit (yalnızca Deck/Monitör yatay),
bilgisayar pilinin telefonda görünmesi, iki regex hatası düzeltildi (OTP ve ekran boyutu okuma). APK yeniden derlenmeli
(`android/app/build/outputs/apk/release/app-release.apk`), sürüm 0.3.0 için android versionName/versionCode 3 ve
`desktop/package.json` güncellenecek.

**Sentinel Hub** (`sentinelHub`): Oyun modu (tepsiye iner, kurulu uygulamaları kapatır/geri açar, otomatik oyun algılama,
ayarlarda oyun süreç listesi). Yeni sürüm (0.2.0) çıkarılmadı. Varsayılan oyun süreci `VALORANT-Win64-Shipping.exe` bir
tahmindir, doğrulanmadı.

**Gerçek cihazda test edilmesi gerekenler:** gerçek arama (operatör ve WhatsApp), Resolve'da arka planda render, Valorant'ta
tam ekranda bar gizlenmesi, kamera/mikrofon kartı, SMS doğrulama kodu, klavye ışığı arama ve pil olaylarında, Hub tepsisi
ve oyun modu (gerçek oyunla), telefonda dikey kilit ve bilgisayar pil satırı.

## Sıradaki adım
Yukarıdaki üç açık karara cevap verip **aşama 0 (ölçüm turu)** ile başlamak. Ondan önce istenirse diğer projelerin
commit ve release işi yapılır.
