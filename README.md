# hayase-extension

[![License: MIT](https://img.shields.io/badge/license-MIT-green.svg)](https://github.com/tanzim2000/hayase-extension/blob/main/LICENSE)
[![Version](https://img.shields.io/badge/version-2.1.0-blue.svg)](https://github.com/tanzim2000/hayase-extension/blob/main/index.json)
[![Extensions](https://img.shields.io/badge/extensions-9-orange.svg)](https://github.com/tanzim2000/hayase-extension/blob/main/index.json)
[![Build](https://github.com/tanzim2000/hayase-extension/actions/workflows/rebuild-dist.yml/badge.svg)](https://github.com/tanzim2000/hayase-extension/actions/workflows/rebuild-dist.yml)
[![Stars](https://img.shields.io/github/stars/tanzim2000/hayase-extension?style=social)](https://github.com/tanzim2000/hayase-extension/stargazers)


A collection of torrent source extensions for [Hayase](https://github.com/hayase-app/hayase) — covering English subs, English dubs, non-English languages, and CJK fansubs.

|⭐ Found this useful?|
|--|
|Star the repo and share with others — it helps others discover it!|

> **Disclaimer:** This project is for educational purposes only. It provides source code for search extensions that interface with publicly available torrent indexers. It does not host, distribute, or link to any copyrighted content. Users are solely responsible for ensuring their use complies with applicable laws and the terms of service of any indexer they connect to.

---

## Installation

1. Open Hayase and go to **Settings → Extensions**
2. Click **Add Repository**
3. Paste the following URL:

```
https://raw.githubusercontent.com/tanzim2000/hayase-extension/refs/heads/main/index.json
```

4. All available extensions will appear. Enable the ones you want.

---

## Extensions

<!-- LAST_CHECKED -->
> 🕐 Sources last verified: August 10, 2026 at 07:46 UTC
<!-- /LAST_CHECKED -->

### Torrent Sources

| Name | Description | Media | Languages |
|---|---|---|---|
| **Nyaa** | Main anime torrent tracker. Sub-focused English releases. | Sub | 🇺🇸 🇯🇵 |
| **Nyaa (Dub)** | Same as Nyaa but searches for English-dubbed releases. | Dub | 🇺🇸 |
| **Nyaa (Non-English)** | Nyaa's non-English category. Set your language keyword in options (e.g. `Arabic`, `Hindi`, `Bangla`). | Dub | 🇸🇦 🇪🇬 🇮🇳 🇧🇩 + more |
| **SeaDex** | Community-curated best and alt releases, matched by AniList ID. High accuracy. | Sub | 🇺🇸 🇯🇵 |
| **Tokyo Toshokan** | One of the oldest anime indexes. Great for older and classic shows. | Sub | 🇺🇸 🇯🇵 |
| **AnimeTosho** | ID-based search via AniDB. Mirrors Nyaa and Tokyo Toshokan with high accuracy. | Sub | 🇺🇸 🇯🇵 |
| **SubsPlease** | Weekly simulcast releases from a trusted fansub group. Consistent, high quality. | Sub | 🇺🇸 |
| **acg.rip** | Chinese anime tracker. Great for CJK fansubs not found on Nyaa. | Sub | 🇨🇳 🇯🇵 |
| **Sukebei** | Nyaa's adult content sister site. Hentai anime and doujinshi. | Sub | 🇺🇸 🇯🇵 |

### Extension Options

Some extensions have configurable options, accessible from **Settings → Extensions → [Extension Name]**.

#### Nyaa (Non-English)
| Option | Description | Default |
|---|---|---|
| `keyword` | Language keyword appended to every search query. Set this to your language, e.g. `Arabic`, `Hindi`, `Bangla`. | *(empty)* |
| `category` | Nyaa category ID. Default is `1_3` (Non-English Translated). | `1_3` |
| `domain` | Base URL. Change to a mirror if nyaa.si is blocked in your region. | `https://nyaa.si` |

#### Nyaa / Nyaa (Dub)
| Option | Description | Default |
|---|---|---|
| `domain` | Base URL. Change to a mirror if nyaa.si is blocked in your region. | `https://nyaa.si` |
| `filter` | Quality filter. `0` = all, `1` = no remakes, `2` = trusted only. | `0` |

#### acg.rip
| Option | Description | Default |
|---|---|---|
| `domain` | Base URL. Override only if acg.rip moves domains. | `https://acg.rip` |

#### SubsPlease
| Option | Description | Default |
|---|---|---|
| `resolution` | Preferred resolution: `480`, `720`, or `1080`. Leave empty to use Hayase's setting. | `1080` |

#### Sukebei
| Option | Description | Default |
|---|---|---|
| `domain` | Sukebei base URL. Change to a mirror if blocked. | `https://sukebei.nyaa.si` |
| `category` | Category: `1_1` = Hentai, `2_2` = Real Life Videos, `0_0` = All. | `1_1` |
| `filter` | Quality filter. `0` = all, `1` = no remakes, `2` = trusted only. | `0` |

---

## Building from Source

### Prerequisites

- [Node.js](https://nodejs.org/) v24
- npm

### Setup

```bash
# Clone the repo
git clone https://github.com/tanzim2000/hayase-extension.git
cd hayase-extension

# Install dependencies
npm install
```

### Build

```bash
# Build all extensions into dist/ (minified, production-ready)
npm run build

# Watch mode — rebuilds automatically on every save (not minified, easier to debug)
npm run watch
```

Built files are output to `dist/`. Each file is fully self-contained and ready for Hayase to load.

---

## Contributing

Contributions are welcome! Here's how to add a new extension or improve an existing one.

### Setting Up

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

### Adding a New Extension

**1. Write your source file**

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

**2. Register it in build.mjs**

Open `build.mjs` and add your extension to `entryPoints`:

```js
entryPoints: {
  nyaasi:        'src/nyaasi.js',
  // ... existing entries ...
  yourextension: 'src/yourextension.js',  // ← add this
},
```

**3. Add an entry to index.json**

Add a new object to the array in `index.json`:

```json
{
  "manifestVersion": 2,
  "name": "Your Extension",
  "id": "tanzim.yourextension",
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

**4. Build and test**

```bash
npm run build
```

Load the built extension locally in Hayase to verify it works before submitting.

**5. Open a pull request**

Push your branch and open a pull request against `main`. Describe what the extension does and what source it connects to.

### Conventions

#### Extension ID Format

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

#### Accuracy

Set the `accuracy` field honestly. Hayase uses it to rank and filter results for the user, so misrepresenting it directly affects the experience.

| Value | When to use |
|---|---|
| `"high"` | The source uses ID-based matching (e.g. AniList ID, AniDB ID). Results are precise. |
| `"medium"` | Some ID mapping is used but not perfect, or it's a single trusted source with very consistent naming. |
| `"low"` | Pure string/keyword search. Results can be noisy or include false positives. |

**Do not set `"high"` unless the source genuinely uses ID-based matching.** If in doubt, use `"low"`.

### Guidelines

- Use `query.fetch` instead of global `fetch` — this is required for CORS to work inside Hayase's sandboxed environment
- Always handle errors with user-friendly messages (these are shown directly to the user in Hayase)
- Apply `query.exclusions` to filter out unwanted results
- Add dev comments explaining non-obvious decisions, especially any trade-offs

---

## Known Issues

- **Tokyo Toshokan** is currently not working. See the [Issues](https://github.com/tanzim2000/hayase-extension/issues) section for details and progress.

---

## Why No NZB Support?

NZB sources like AltHub and NZBGeek require a personal API key to search, which means every user has to register, generate a key, and paste it into the extension settings before it works. That's friction I didn't want to impose.

That said, if you want to add NZB support yourself, contributions are absolutely welcome — see the [Contributing](#contributing) section above.

---

## Acknowledgements

- **[sinnafuls/hayase-ext](https://github.com/sinnafuls/hayase-ext)** — the project that inspired this one. Several ideas (including acg.rip support and the NZB extension approach) came from looking at his work.
- **[Claude](https://claude.ai)** (Anthropic) — assisted with architecture decisions, code, and documentation throughout this project.

---

## License

[MIT](https://github.com/tanzim2000/hayase-extension/blob/main/LICENSE) © tanzim2000
