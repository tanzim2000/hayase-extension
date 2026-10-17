# Contributing to hayase-extension

Contributions are welcome! This guide covers adding a new source or improving an existing one.

**Contents:** [Setting up](#setting-up) · [Building](#building) · [Adding a new source](#adding-a-new-source) · [Conventions](#conventions) · [Ground rules](#ground-rules)

---

## Setting up

You'll need:

- [Node.js](https://nodejs.org/) v24
- npm

1. [Fork](https://github.com/tanzim2000/hayase-extension/fork) the repository
2. Clone your fork:
   ```bash
   git clone https://github.com/YOUR_USERNAME/hayase-extension.git
   cd hayase-extension
   npm install
   ```
3. Create a new branch for your changes:
   ```bash
   git checkout -b my-new-extension
   ```

## Building

```bash
# Build all extensions into dist/ (minified, production-ready)
npm run build

# Watch mode — rebuilds automatically on every save (not minified, easier to debug)
npm run watch
```

Built files are output to `dist/`. Each file is fully self-contained and ready for Hayase to load.

---

## Adding a new source

### 1. Write your source file

Create `src/yourextension.js`. Your extension must export a default object with these methods:

```js
export default {
  async test(query) {
    // Check if the source is reachable. Return true if OK, throw a
    // user-friendly error message if not.
  },

  async single(query, options = {}) {
    // Single episode search. Return TorrentResult[].
  },

  async batch(query, options = {}) {
    // Batch/season pack search. Return TorrentResult[].
  },

  async movie(query, options = {}) {
    // Movie search. Return TorrentResult[].
  },
}
```

The `query` object Hayase passes in includes:
- `query.titles` — array of title variants (romaji, English, Japanese)
- `query.episode` — episode number
- `query.resolution` — preferred resolution (`'1080'`, `'720'`, etc.)
- `query.exclusions` — keywords to filter out of results
- `query.anilistId` — AniList ID
- `query.fetch` — use this instead of global `fetch` for CORS to work

Each result in the returned array should look like:
```js
{
  title: 'string',       // torrent name
  link: 'string',        // magnet link or .torrent URL
  hash: 'string',        // info hash
  size: 0,               // size in bytes
  seeders: 0,
  leechers: 0,
  downloads: 0,
  accuracy: 'high',      // 'high', 'medium', or 'low'
  date: new Date(),
}
```

See the existing source files in `src/` for real examples.

### 2. Register it in `build.mjs`

Open `build.mjs` and add your extension to `entryPoints`:

```js
entryPoints: {
  nyaasi:        'src/nyaasi.js',
  // ... existing entries ...
  yourextension: 'src/yourextension.js',  // ← add this
},
```

### 3. Add an entry to `index.json`

Add a new object to the array in `index.json`:

```json
{
  "manifestVersion": 2,
  "name": "Your Extension",
  "id": "anime.yourextension",
  "version": "1.0.0",
  "description": "Short description of what this source is.",
  "type": "torrent",
  "accuracy": "medium",
  "updatePeers": true,
  "ratio": 0,
  "media": "sub",
  "languages": ["US", "JP"],
  "url": "<base64 encoded URL of the source site>",
  "icon": "https://example.com/favicon.ico",
  "update": "https://raw.githubusercontent.com/tanzim2000/hayase-extension/refs/heads/main/index.json",
  "code": "https://raw.githubusercontent.com/tanzim2000/hayase-extension/refs/heads/main/dist/yourextension.js"
}
```

> The `url` field should be the source site's base URL encoded in Base64. You can encode it quickly in your browser console: `btoa('https://example.com')`

### 4. List it in the README

The README's source table is a live dashboard: a GitHub bot (`scripts/check-sources.mjs`) checks every source each week and fills in its **Status** badge. For your source to show up there:

- Add a row to the **Torrent Sources** table. The name in the first cell must be **bold** and match the `name` in `index.json` exactly, or the bot can't find the row. Put anything in the Status cell; the next run replaces it.
- If your source has options, add a collapsible block for it under **Extension Options**, in the same order as the table.

There are instructions in comments inside the README, next to both sections.

### 5. Build and test

```bash
npm run build
```

Load the built extension locally in Hayase to verify it works before submitting.

### 6. Open a pull request

Push your branch and open a pull request against `main`. Describe what the extension does and what source it connects to.

---

## Conventions

### Extension ID format

Every extension ID must follow this pattern:

```
{mediaType}.{sourceName}
{mediaType}.{sourceName}.{variant}
```

| Segment | Description |
|---|---|
| `mediaType` | The type of content the extension serves. Use `anime` for anime. `movie` and `tv` are reserved for future use. |
| `sourceName` | A short, lowercase identifier for the source site. e.g. `nyaasi`, `seadex`, `acgrip`. |
| `variant` | Optional. Used when multiple entries share the same source. e.g. `dub`, `nonenglish`. |

**Examples:**
```
anime.nyaasi
anime.nyaasi.dub
anime.nyaasi.nonenglish
movie.nyaasi        ← reserved for future use
tv.nyaasi           ← reserved for future use
```

IDs must be unique. Once published, **do not change an extension's ID** — Hayase uses it internally to store user settings and track installed extensions. Changing it is a breaking change for existing users.

### Accuracy

Set the `accuracy` field honestly. Hayase uses it to rank and filter results for the user, so misrepresenting it directly affects the experience.

| Value | When to use |
|---|---|
| `"high"` | The source uses ID-based matching (e.g. AniList ID, AniDB ID). Results are precise. |
| `"medium"` | Some ID mapping is used but not perfect, or it's a single trusted source with very consistent naming. |
| `"low"` | Pure string/keyword search. Results can be noisy or include false positives. |

**Do not set `"high"` unless the source genuinely uses ID-based matching.** If in doubt, use `"low"`.

---

## Ground rules

- Use `query.fetch` instead of global `fetch` — this is required for CORS to work inside Hayase's sandboxed environment
- Set the manifest `url` to the exact site your extension fetches from. Hayase only allows cross-origin requests to that site, so a request to any other domain fails with "Failed to fetch". `check-sources.mjs` flags a mismatch.
- Always handle errors with user-friendly messages (these are shown directly to the user in Hayase)
- Apply `query.exclusions` to filter out unwanted results
- Add dev comments explaining non-obvious decisions, especially any trade-offs
