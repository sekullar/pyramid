# Pyramid

An all-black, AI-assisted notebook. Your notes are plain Markdown files in a folder you choose; the AI helps you
summarize, rewrite, fix and compare them. Windows desktop app first, an Android app and Wi-Fi sync later.
[Türkçe README](README.tr.md)

> **Status: early development.** The notebook and the AI features work; there is no release yet and the Android app is still planned.

## Features

- **Plain Markdown files.** One `.md` file per note, sub-folders are notebooks. No database, no lock-in: back up or
  move your notes by copying the folder. A small front matter block (`id`, `created`, `updated`, `tags`) is added so
  notes can be matched across devices later.
- **Write, preview or both**, with autosave. Deleted notes go to the Recycle Bin.
- **Search** across titles, text and tags.
- **Edits outside Pyramid are picked up** automatically.
- **Turkish / English**, pure black theme.

- **AI on your notes:** summarize, fix spelling, rewrite (clearer, shorter, formal, casual) and compare several notes.
  It works on the whole note or just the passage you select, and always answers in the language of the note. Results
  are never applied on their own: you choose Apply, Copy or Discard.
- **Your choice of model:** local Ollama (default `gemma3:12b`) or Claude, OpenAI and Gemini with your own API key.
  Keys are encrypted with Windows (DPAPI) and never shown to the interface. The panel always shows whether the text
  stays local or goes to a cloud provider.

Planned: an Android app that pairs with the desktop app over the same Wi-Fi. See [docs/PLAN.md](docs/PLAN.md).

> Local models need a capable GPU to feel fast: on 8 GB of video memory a 12B model takes about a minute for a long
> note. Cloud providers are much faster.

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
