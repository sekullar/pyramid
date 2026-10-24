# Pyramid

Tamamen siyah, yapay zeka destekli bir not defteri. Notların, seçtiğin bir klasördeki düz Markdown dosyalarıdır; yapay zeka
onları özetlemene, yeniden yazmana, düzeltmene ve karşılaştırmana yardım eder. Önce Windows masaüstü uygulaması,
sonra Android uygulaması ve Wi-Fi eşitleme gelecek. [English README](README.md)

> **Durum: erken geliştirme.** Not defteri ve yapay zeka özellikleri çalışıyor; henüz release yok, Android uygulaması planlanıyor.

## Özellikler

- **Düz Markdown dosyaları.** Her not bir `.md` dosyasıdır, alt klasörler defterlerdir. Veritabanı yok, bağımlılık yok:
  notlarını klasörü kopyalayarak yedekler ya da taşırsın. Notların ileride cihazlar arasında eşleşebilmesi için dosyanın
  başına küçük bir başlık bloğu (`id`, `created`, `updated`, `tags`) eklenir.
- **Yaz, önizle ya da ikisi birden**, otomatik kaydetme ile. Silinen notlar Geri Dönüşüm Kutusu'na gider.
- Başlık, metin ve etiketlerde **arama**.
- Pyramid dışında yapılan düzenlemeler **otomatik algılanır**.
- **Türkçe / English**, saf siyah tema.

- **Notlarda yapay zeka:** özetle, yazım düzelt, yeniden yaz (daha açık, kısa, resmi, samimi) ve birden çok notu
  karşılaştır. Tüm notta ya da yalnızca seçtiğin bölümde çalışır, cevabı her zaman notun diliyle verir. Sonuçlar
  kendiliğinden uygulanmaz: Uygula, Kopyala ya da Vazgeç'i sen seçersin.
- **Model seçimi senin:** yerel Ollama (varsayılan `gemma3:12b`) ya da kendi API anahtarınla Claude, OpenAI ve Gemini.
  Anahtarlar Windows (DPAPI) ile şifrelenir, arayüze hiç gösterilmez. Panel, metnin yerelde mi kaldığını yoksa bulut
  sağlayıcıya mı gittiğini her zaman gösterir.

Planlananlar: aynı Wi-Fi'de masaüstü ile eşleşen bir Android uygulaması. Ayrıntı: [docs/PLAN.md](docs/PLAN.md).

> Yerel modellerin hızlı hissettirmesi için güçlü bir ekran kartı gerekir: 8 GB video belleğinde 12B model uzun bir
> not için yaklaşık bir dakika sürer. Bulut sağlayıcılar çok daha hızlıdır.

## Repo yapısı

| Klasör | Ne |
| --- | --- |
| `desktop/` | Windows uygulaması (Electron + React) |
| `android/` | Android uygulaması (planlanıyor) |
| `docs/` | Planlar ve notlar |

## Geliştirme

```bash
cd desktop
npm install
npm start        # arayüzü derler ve uygulamayı açar
npm run dist     # desktop/release/ içinde kurulum dosyası
```

Notlar varsayılan olarak `Belgeler\Pyramid` içinde durur, Ayarlar'dan değiştirilebilir. Geliştirirken uygulamayı başka
bir klasöre `PYRAMID_NOTES_DIR` ortam değişkeniyle yönlendirebilirsin.

Release'ler GitHub Actions ile üretilir: `v0.1.0` gibi bir etiket push'lanınca kurulum dosyası derlenip yayınlanır.

## Lisans

MIT
