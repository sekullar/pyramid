# Pyramid

An all-black, AI-assisted notebook. Your notes are plain Markdown files in a folder you choose; the AI helps you
summarize, rewrite, fix and compare them. Windows desktop app first, an Android app and Wi-Fi sync later.
[Türkçe README](README.tr.md)

> **Status: early development.** The notebook itself works; the AI features are being built.

## Features

- **Plain Markdown files.** One `.md` file per note, sub-folders are notebooks. No database, no lock-in: back up or
  move your notes by copying the folder. A small front matter block (`id`, `created`, `updated`, `tags`) is added so
  notes can be matched across devices later.
- **Write, preview or both**, with autosave. Deleted notes go to the Recycle Bin.
- **Search** across titles, text and tags.
- **Edits outside Pyramid are picked up** automatically.
- **Turkish / English**, pure black theme.

Planned: AI on your notes (summarize, rewrite, fix, compare several notes) with local Ollama first and then Claude,
OpenAI and Gemini with your own API keys; an Android app that pairs with the desktop app over the same Wi-Fi.
See [docs/PLAN.md](docs/PLAN.md).

## Repository layout

| Folder | What |
| --- | --- |
| `desktop/` | Windows app (Electron + React) |
| `android/` | Android app (planned) |
| `docs/` | Plans and notes |

## Development

```bash
cd desktop
npm install
npm start        # build the UI and open the app
npm run dist     # installer in desktop/release/
```

Notes live in `Documents\Pyramid` by default; change it in Settings. For development you can point the app at another
folder with the `PYRAMID_NOTES_DIR` environment variable.

Releases are built by GitHub Actions: pushing a tag such as `v0.1.0` builds and publishes the installer.

## License

MIT
