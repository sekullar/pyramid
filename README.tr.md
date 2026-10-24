# Pyramid

Tamamen siyah, yapay zeka destekli bir not defteri. Notların, seçtiğin bir klasördeki düz Markdown dosyalarıdır; yapay zeka
onları özetlemene, yeniden yazmana, düzeltmene ve karşılaştırmana yardım eder. Önce Windows masaüstü uygulaması,
sonra Android uygulaması ve Wi-Fi eşitleme gelecek. [English README](README.md)

> **Durum: erken geliştirme.** Not defteri çalışıyor; yapay zeka özellikleri yapım aşamasında.

## Özellikler

- **Düz Markdown dosyaları.** Her not bir `.md` dosyasıdır, alt klasörler defterlerdir. Veritabanı yok, bağımlılık yok:
  notlarını klasörü kopyalayarak yedekler ya da taşırsın. Notların ileride cihazlar arasında eşleşebilmesi için dosyanın
  başına küçük bir başlık bloğu (`id`, `created`, `updated`, `tags`) eklenir.
- **Yaz, önizle ya da ikisi birden**, otomatik kaydetme ile. Silinen notlar Geri Dönüşüm Kutusu'na gider.
- Başlık, metin ve etiketlerde **arama**.
- Pyramid dışında yapılan düzenlemeler **otomatik algılanır**.
- **Türkçe / English**, saf siyah tema.

Planlananlar: notlar üzerinde yapay zeka (özetle, yeniden yaz, düzelt, birden çok notu karşılaştır). Önce yerel Ollama,
sonra kendi API anahtarınla Claude, OpenAI ve Gemini. Ayrıca aynı Wi-Fi'de masaüstü ile eşleşen bir Android uygulaması.
Ayrıntı: [docs/PLAN.md](docs/PLAN.md).

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
