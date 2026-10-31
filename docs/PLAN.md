# Pyramid - Plan

AI destekli, tamamen siyah temalı, Markdown tabanlı not defteri. Önce Windows masaüstü, sonra mobil ve aynı Wi-Fi'de eşleşme.
Sentinel Hub kataloğuna eklenecek (Spotlight, Dynamic Bar, Phoneix ile aynı Release düzeni).

## Ad ve kimlik
- Ad: **Pyramid**. Kısa, akılda kalır, "bilgi piramidi" (veri → bilgi → anlayış) çağrışımı notlar + yapay zekaya uyar.
  Dikkat: Python'da aynı adlı bir web çatısı var, arama sonuçlarında karışabilir; masaüstü uygulaması için sorun değil.
- Logo: siyah zemin, beyaz üçgen. Üçgenin tek başına "uyarı/oynat" gibi okunmaması için iki yüzlü yapmayı öneriyorum:
  sol yüz beyaz, sağ yüz hafif gri (piramidin ışık/gölge yüzü). Minimal, tek renkli ailede kalır.
- Tema: saf siyah (`#000`), yüzeyler `#0a0a0a`, ince `#1c1c1c` çizgiler, vurgu beyaz. Mavi aile (Hub, Phoneix) ile bilerek ayrı.

## Teknoloji
Electron + React + JavaScript (Vite), Hub'daki projelerle aynı yapı. Veritabanı yok.

## Notlar
- Her not bir `.md` dosyası, kullanıcının seçtiği bir klasörde (varsayılan `Belgeler\Pyramid`). Alt klasörler = defterler.
- Dosyanın başında YAML başlığı: `id` (UUID, eşleşme için), `created`, `updated`, `tags`.
- Klasör izlenir: Pyramid dışında düzenlenen not da güncellenir. Yedekleme/taşıma = klasörü kopyalamak.

## Yapay zeka
- Sağlayıcı soyutlaması: `chat(messages, { model, stream })`. İlk sürüm **Ollama** (yerel, `127.0.0.1:11434`, modeller `/api/tags`'tan listelenir).
- Sonra bulut: **Claude, OpenAI, Gemini**. API anahtarları Electron `safeStorage` ile şifreli saklanır, hiçbir zaman dosyaya düz yazılmaz.
- Model seçimi ayarlardan; her AI işleminin yanında hangi model ve "yerel / bulut" bilgisi görünür.
  Bulut sağlayıcıya yalnızca kullanıcı bir AI işlemi başlattığında, o işlemin metni gönderilir.
- Hata durumları: Ollama kapalı, model yok, anahtar geçersiz, ağ yok için açık mesajlar.

## Arayüz
- Sol: defter/not ağacı + arama. Orta: Markdown editörü (yaz / önizle). Sağ: AI paneli (açılır kapanır).
- **Ana ekran:** son notlar ve **karşılaştırma**: 2+ not seç → AI benzerlik, fark ve çelişkileri çıkarır.
- Seçili metin veya not için: **özetle**, **yeniden yaz**, **düzelt** (öneriyi göster, kullanıcı kabul eder/reddeder, otomatik uygulanmaz).
- TR/EN, ince kaydırma çubuğu, hafif animasyonlar (Hub ile aynı dil).

## Mobil ve eşleşme (sonraki aşama)
- Aynı Wi-Fi'de masaüstü ile eşleşme, notlar iki yönlü yansır.
- Eşleşme: QR ile (Phoneix'teki gibi): QR içinde masaüstünün adresi ve tek seferlik anahtar. Trafik bu anahtarla şifrelenir.
  Phoneix'in `PROTOCOL.md` dosyasındaki yaklaşım temel alınır.
- Eşitleme: iki taraf not listesini (`id`, `updated`, içerik özeti) karşılaştırır, farkı karşılıklı gönderir.
  **Çakışma:** aynı not iki yerde değiştiyse hiçbiri ezilmez, "çakışma kopyası" oluşur. Silinenler için silme kaydı tutulur.
- Mobil uygulama tekniği açık karar (aşağıda).

## Aşamalar
1. **v0.1 Masaüstü çekirdek:** iskelet, siyah tema, not CRUD (`.md` klasörü), editör, Ollama, özetle/yeniden yaz/düzelt,
   TR/EN, Release workflow'u, Hub kataloğuna ekleme.
2. **v0.2:** Claude/OpenAI/Gemini, anahtar yönetimi, ana ekranda not karşılaştırma.
3. **v0.3 Mobil:** Android uygulaması, QR eşleşme, Wi-Fi eşitleme.
4. **Sonra:** Dynamic Bar bildirimi, Phoneix'ten hızlı not, Spotlight'ta not arama, anlam bazlı (vektör) arama.

## Kararlar (netleşti)
- **Mobil ayrı, masaüstü ayrı uygulama:** Android uygulaması yerel (Kotlin) yazılır, Phoneix gibi aynı repoda
  `desktop/` ve `android/` klasörleri. İkisi ortak not biçimi (`.md` + `id`) ve eşleşme protokolünü paylaşır.
  Mobilde yerel Ollama olmaz; telefon AI için bulut anahtarını ya da masaüstündeki Ollama'yı Wi-Fi üzerinden kullanır.
- Not klasörü varsayılan `Belgeler\Pyramid`, Ayarlar'dan değiştirilebilir.
- Logo: siyah zeminde iki yüzlü (beyaz + gri) üçgen, yapıldı (`desktop/build/logo.svg`).
- Repo: github.com/sekullar/pyramid.

## Durum
- v0.1 iskeleti hazır: siyah tema, not klasörü (`.md` + front matter), listeleme/arama/defterler, yaz/önizle/ikisi editörü,
  otomatik kaydetme, silince Geri Dönüşüm Kutusu, TR/EN, ayarlar (dil, klasör).
- Sıradaki: Ollama sağlayıcısı, AI paneli (özetle, yeniden yaz, düzelt), sonra Release ve Hub kataloğuna ekleme.

## Eşitleme ve çakışma (2026-10-31 kararları)
- İki yol: Pyramid'in **kendi eşleşmesi** (QR, Phoneix gerekmez) ve ayarlarda **"Phoneix ile eşitle"** (Phoneix kuruluysa
  mevcut eşleşme/köprü kullanılır, ikinci QR yok; kurulu değilse "Phoneix gerekli" yazar). İkisi de aynı eşitleme
  motorunu kullanır, yalnızca taşıyıcı değişir.
- Otomatik eşitleme **açık**: uygulama açıkken sürekli, kapalıyken Android'in izin verdiği aralıkta (en az 15 dk).
- Karar "saat"e değil içerik özetine (hash) bakar, bu yüzden telefonun saati yanlış olsa da yanlış not kazanmaz.
- Çakışmada hiçbir şey ezilmez: notun kendisi masaüstündeki sürüm olarak kalır, telefondaki sürüm
  "Başlık (çakışma - telefon - tarih)" adıyla ayrı not olur. Bildirim gider.
- **Çakışma arayüzü (sırayla yapılacak):**
  1. Not açılınca üstte uyarı ve seçenekler: *bilgisayardakini tut / telefondakini tut / ikisini ayrı not olarak tut*.
  2. **Birleştir:** son eşitlemedeki ortak metinle karşılaştırıp farklı yerlerdeki değişiklikleri otomatik birleştirir;
     eklenen kısım hafif arka planla ve "Pyramid Mobile'de eklendi" etiketiyle gösterilir (Kabul et / Geri al).
     Aynı satır iki yerde değiştiyse yan yana gösterilir, kullanıcı seçer. Bunun için her iki cihaz son eşitlemedeki
     not **metnini** saklar (şu an yalnızca hash).
- Not açıkken karşıdan değişiklik gelirse editör kilitlenmez, "Bu not başka cihazda değişti" şeridi çıkar.
- Canlı yazma: aynı bağlantıdan, duraklamada (~500 ms) küçük güncellemeler; ayrı bir sistem olmayacak.

## Eşitleme durumu
- Yapıldı (masaüstü, 60 test, `npm test`): karar motoru, şifreli eşitleme sunucusu, QR eşleştirme, not klasörü katmanı,
  yönetici (aç/kapa, cihazlar, çakışma çözümü) ve arayüz: Ayarlar'da "Telefon eşitleme" (açma/kapama, QR, cihaz listesi),
  kenar çubuğunda eşitleme durumu, çakışma şeridi (bilgisayardakini tut / telefondakini tut / tek notta birleştir / ikisini de tut),
  not açıkken başka cihazda değişirse uyarı şeridi. Telefon yerine sahte istemciyle gerçek uygulamada uçtan uca denendi.
- Android iskeleti (`android/`, Kotlin, düz Android arayüzü): not listesi ve arama, yaz/önizle editörü (700 ms otomatik kayıt),
  silme (`.trash` klasörüne), saf siyah tema, TR/EN, ayarlar. Not biçimi ve içerik özeti masaüstüyle birebir aynı; 6 birim test
  (`gradlew testDebugUnitTest`) hash değerlerini masaüstü kodunun ürettiği değerlerle karşılaştırıyor. Gerçek telefonda (SM-A366B) denendi.
- Telefonda eşleştirme ve eşitleme (QR veya pyramid://pair bağlantısı, onay penceresi, 20 sn'de bir otomatik eşitleme, durum satırı,
  silme/çakışma): gerçek telefonda gerçek masaüstü sunucusuyla uçtan uca denendi (yeni not, düzenleme, silme, çakışma). 11 Android birim testi.
- **Harf harfine canlı yazma (opsiyonel ayar, iki tarafta da "Harf harfine canlı yazma"):** kapalıyken eski yol (not açıkken
  ~1,5 sn'de bir eşitleme); açıkken açık not için bilgisayar tek doğru metni tutar, her cihaz küçük değişiklikleri (ekle/sil) gönderir,
  aynı anda yazılanlar OT ile birleşir (`electron/sync/ot.mjs`, telefonda `LiveText.kt`, ortak test vektörleri). Telefon boştayken
  bilgisayarda bekleyen istek açar (haber gelince hemen yanıt), yazınca iptal eder. Dosyayı bilgisayar yazar; normal eşitleme başlarken
  açık notlar diske yazılıp kapatılır. Bağlantı/tutarsızlık olursa o not normal yola döner, hiçbir şey kaybolmaz.
  Bilinen: açık canlı notun dosyası başka bir programla (ör. OneDrive) değiştirilirse bilgisayar kendi metnini yazar (en çok 1 dk sonra bırakır).
- Henüz yok: uygulama kapalıyken arka planda eşitleme (WorkManager), telefonda çakışma çözme arayüzü (şimdilik
  masaüstünde çözülüyor), akıllı birleştirme (ortak metinle üç yönlü; şimdiki "tek notta birleştir" iki metni alt alta koyar),
  defter (alt klasör) eşitleme, id'siz notlar, "Phoneix ile eşitle" (arayüzde "yakında" olarak duruyor).
- Bilinen: Windows güvenlik duvarı ilk açılışta 47820 portu için izin sorabilir; telefonun bağlanması için "Özel ağlar"a izin verilmeli.
