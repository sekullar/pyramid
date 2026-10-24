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
