<!-- ===== HEADER: everything inside this div is centered ===== -->
<!-- THEME-AWARE IMAGES: every image in this header sits inside a <picture> tag.
     GitHub picks the <source> whose media query matches the viewer's theme:
       (prefers-color-scheme: dark)  -> dark-mode version
       (prefers-color-scheme: light) -> light-mode version
     The <img> at the end is the fallback for places that ignore <picture> (e.g. some apps).
     When you edit an image, change BOTH <source> URLs and the <img> fallback. -->
<div align="center">

<!-- ANIMATED TITLE: capsule-render draws a waving gradient banner that fades the title in.
     "text=" is the title, "color=0:HEX%2C100:HEX" is the gradient (start,end), "fontColor=" is the text.
     IMPORTANT: the comma in the gradient MUST be written as %2C. Inside srcset a plain comma
     splits the URL in two, which breaks the banner (it renders black with no title).
     Dark:  deep purple -> blue gradient, white text.
     Light: pastel purple -> pastel blue gradient, deep indigo text. -->
<picture>
	<source media="(prefers-color-scheme: dark)" srcset="https://capsule-render.vercel.app/api?type=waving&height=220&color=0:7C3AED%2C100:2563EB&section=header&text=hayase-extension&fontSize=56&fontColor=ffffff&animation=fadeIn&fontAlignY=38">
	<source media="(prefers-color-scheme: light)" srcset="https://capsule-render.vercel.app/api?type=waving&height=220&color=0:C4B5FD%2C100:93C5FD&section=header&text=hayase-extension&fontSize=56&fontColor=312E81&animation=fadeIn&fontAlignY=38">
	<img src="https://capsule-render.vercel.app/api?type=waving&height=220&color=0:7C3AED%2C100:2563EB&section=header&text=hayase-extension&fontSize=56&fontColor=ffffff&animation=fadeIn&fontAlignY=38" alt="hayase-extension" />
</picture>

<!-- ANIMATED SUBTITLE: readme-typing-svg types out each line, pauses, then moves to the next.
     "lines=" holds the sentences separated by ";" (spaces are written as "+").
     Dark: A78BFA (light purple). Light: 6D28D9 (deep purple). -->
<picture>
	<source media="(prefers-color-scheme: dark)" srcset="https://readme-typing-svg.demolab.com?font=Fira+Code&weight=500&size=20&duration=3000&pause=1200&color=A78BFA&center=true&vCenter=true&width=640&height=40&lines=Torrent+sources+for+Hayase;English+subs+%C2%B7+English+dubs;Non-English+%C2%B7+CJK+fansubs;Nyaa+%C2%B7+SeaDex+%C2%B7+SubsPlease+%C2%B7+acg.rip+%26+more">
	<source media="(prefers-color-scheme: light)" srcset="https://readme-typing-svg.demolab.com?font=Fira+Code&weight=500&size=20&duration=3000&pause=1200&color=6D28D9&center=true&vCenter=true&width=640&height=40&lines=Torrent+sources+for+Hayase;English+subs+%C2%B7+English+dubs;Non-English+%C2%B7+CJK+fansubs;Nyaa+%C2%B7+SeaDex+%C2%B7+SubsPlease+%C2%B7+acg.rip+%26+more">
	<img src="https://readme-typing-svg.demolab.com?font=Fira+Code&weight=500&size=20&duration=3000&pause=1200&color=A78BFA&center=true&vCenter=true&width=640&height=40&lines=Torrent+sources+for+Hayase;English+subs+%C2%B7+English+dubs;Non-English+%C2%B7+CJK+fansubs;Nyaa+%C2%B7+SeaDex+%C2%B7+SubsPlease+%C2%B7+acg.rip+%26+more" alt="Torrent sources for Hayase: English subs, English dubs, non-English and CJK fansubs" />
</picture>

<br />

<!-- BADGES: shields.io draws them. Each one is a clickable, theme-aware image.
     The only difference between dark and light is "labelColor=" (the left half):
     Dark: 1e2327 (near-black). Light: E5E7EB (light gray; shields switches the text to dark by itself).
     <a ...><picture> and </picture></a> stay on the same lines so no stray underlined space appears.
     Order: Version (static: update the number in all three URLs when you bump it),
     Extensions (live count from index.json), Sources (live check-sources.yml status),
     Stars (live), License (static).
     DO NOT put comments or blank lines between the badges below: either one breaks the row
     and stacks every badge on its own line. -->
<a href="https://github.com/tanzim2000/hayase-extension/blob/main/index.json"><picture>
	<source media="(prefers-color-scheme: dark)" srcset="https://img.shields.io/badge/version-2.1.0-7C3AED?style=for-the-badge&labelColor=1e2327">
	<source media="(prefers-color-scheme: light)" srcset="https://img.shields.io/badge/version-2.1.0-7C3AED?style=for-the-badge&labelColor=E5E7EB">
	<img src="https://img.shields.io/badge/version-2.1.0-7C3AED?style=for-the-badge&labelColor=1e2327" alt="Version" />
</picture></a>
<a href="https://github.com/tanzim2000/hayase-extension/blob/main/index.json"><picture>
	<source media="(prefers-color-scheme: dark)" srcset="https://img.shields.io/badge/dynamic/json?url=https%3A%2F%2Fraw.githubusercontent.com%2Ftanzim2000%2Fhayase-extension%2Frefs%2Fheads%2Fmain%2Findex.json&query=%24.length&label=extensions&style=for-the-badge&color=2563EB&labelColor=1e2327">
	<source media="(prefers-color-scheme: light)" srcset="https://img.shields.io/badge/dynamic/json?url=https%3A%2F%2Fraw.githubusercontent.com%2Ftanzim2000%2Fhayase-extension%2Frefs%2Fheads%2Fmain%2Findex.json&query=%24.length&label=extensions&style=for-the-badge&color=2563EB&labelColor=E5E7EB">
	<img src="https://img.shields.io/badge/dynamic/json?url=https%3A%2F%2Fraw.githubusercontent.com%2Ftanzim2000%2Fhayase-extension%2Frefs%2Fheads%2Fmain%2Findex.json&query=%24.length&label=extensions&style=for-the-badge&color=2563EB&labelColor=1e2327" alt="Extensions" />
</picture></a>
<a href="https://github.com/tanzim2000/hayase-extension/actions/workflows/check-sources.yml"><picture>
	<source media="(prefers-color-scheme: dark)" srcset="https://img.shields.io/github/actions/workflow/status/tanzim2000/hayase-extension/check-sources.yml?style=for-the-badge&label=sources&labelColor=1e2327">
	<source media="(prefers-color-scheme: light)" srcset="https://img.shields.io/github/actions/workflow/status/tanzim2000/hayase-extension/check-sources.yml?style=for-the-badge&label=sources&labelColor=E5E7EB">
	<img src="https://img.shields.io/github/actions/workflow/status/tanzim2000/hayase-extension/check-sources.yml?style=for-the-badge&label=sources&labelColor=1e2327" alt="Sources status" />
</picture></a>
<a href="https://github.com/tanzim2000/hayase-extension/stargazers"><picture>
	<source media="(prefers-color-scheme: dark)" srcset="https://img.shields.io/github/stars/tanzim2000/hayase-extension?style=for-the-badge&labelColor=1e2327&color=F59E0B">
	<source media="(prefers-color-scheme: light)" srcset="https://img.shields.io/github/stars/tanzim2000/hayase-extension?style=for-the-badge&labelColor=E5E7EB&color=F59E0B">
	<img src="https://img.shields.io/github/stars/tanzim2000/hayase-extension?style=for-the-badge&labelColor=1e2327&color=F59E0B" alt="Stars" />
</picture></a>
<a href="https://github.com/tanzim2000/hayase-extension/blob/main/LICENSE"><picture>
	<source media="(prefers-color-scheme: dark)" srcset="https://img.shields.io/badge/license-MIT-22C55E?style=for-the-badge&labelColor=1e2327">
	<source media="(prefers-color-scheme: light)" srcset="https://img.shields.io/badge/license-MIT-22C55E?style=for-the-badge&labelColor=E5E7EB">
	<img src="https://img.shields.io/badge/license-MIT-22C55E?style=for-the-badge&labelColor=1e2327" alt="MIT License" />
</picture></a>

<br />
<!-- ONE-LINE DESCRIPTION -->
A collection of torrent source extensions for <a href="https://github.com/hayase-app/hayase">Hayase</a>, covering English subs, English dubs, non-English languages, and CJK fansubs.

</div><br />

> **Disclaimer:** This project is for educational purposes only. It provides source code for search extensions that interface with publicly available torrent indexers. It does not host, distribute, or link to any copyrighted content. Users are solely responsible for ensuring their use complies with applicable laws and the terms of service of any indexer they connect to.

---

<!-- QUICK-LINK NAV: same badge style as the header row, theme-aware the same way.
     Dark: 1e2327 (near-black chip). Light: E5E7EB (light gray chip, dark text).
     Each href="#name" must match a heading below, lowercased, with spaces turned into "-".
     Example: "## Building from Source" -> #building-from-source
     SIZE: height="36" on each <img> scales the chip up (shields default is 28). The badges are
     SVGs, so they stay sharp at any size. Change all six numbers together to keep them even. -->
<div align="center">
<a href="#installation"><picture>
	<source media="(prefers-color-scheme: dark)" srcset="https://img.shields.io/badge/INSTALL-1e2327?style=for-the-badge">
	<source media="(prefers-color-scheme: light)" srcset="https://img.shields.io/badge/INSTALL-E5E7EB?style=for-the-badge">
	<img src="https://img.shields.io/badge/INSTALL-1e2327?style=for-the-badge" height="40" alt="Install" />
</picture></a>
<a href="#extensions"><picture>
	<source media="(prefers-color-scheme: dark)" srcset="https://img.shields.io/badge/EXTENSIONS-1e2327?style=for-the-badge">
	<source media="(prefers-color-scheme: light)" srcset="https://img.shields.io/badge/EXTENSIONS-E5E7EB?style=for-the-badge">
	<img src="https://img.shields.io/badge/EXTENSIONS-1e2327?style=for-the-badge" height="40" alt="Extensions" />
</picture></a>
<a href="#extension-options"><picture>
	<source media="(prefers-color-scheme: dark)" srcset="https://img.shields.io/badge/OPTIONS-1e2327?style=for-the-badge">
	<source media="(prefers-color-scheme: light)" srcset="https://img.shields.io/badge/OPTIONS-E5E7EB?style=for-the-badge">
	<img src="https://img.shields.io/badge/OPTIONS-1e2327?style=for-the-badge" height="40" alt="Options" />
</picture></a>
<a href="#building-from-source"><picture>
	<source media="(prefers-color-scheme: dark)" srcset="https://img.shields.io/badge/BUILD-1e2327?style=for-the-badge">
	<source media="(prefers-color-scheme: light)" srcset="https://img.shields.io/badge/BUILD-E5E7EB?style=for-the-badge">
	<img src="https://img.shields.io/badge/BUILD-1e2327?style=for-the-badge" height="40" alt="Build" />
</picture></a>
<a href="#contributing"><picture>
	<source media="(prefers-color-scheme: dark)" srcset="https://img.shields.io/badge/CONTRIBUTE-1e2327?style=for-the-badge">
	<source media="(prefers-color-scheme: light)" srcset="https://img.shields.io/badge/CONTRIBUTE-E5E7EB?style=for-the-badge">
	<img src="https://img.shields.io/badge/CONTRIBUTE-1e2327?style=for-the-badge" height="40" alt="Contribute" />
</picture></a>
<a href="#known-issues"><picture>
	<source media="(prefers-color-scheme: dark)" srcset="https://img.shields.io/badge/KNOWN_ISSUES-1e2327?style=for-the-badge">
	<source media="(prefers-color-scheme: light)" srcset="https://img.shields.io/badge/KNOWN_ISSUES-E5E7EB?style=for-the-badge">
	<img src="https://img.shields.io/badge/KNOWN_ISSUES-1e2327?style=for-the-badge" height="40" alt="Known Issues" />
</picture></a>
</div>

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
> 🕐 Sources last verified: October 12, 2026 at 13:53 UTC
<!-- /LAST_CHECKED -->

### Torrent Sources

| Name | Description | Media | Languages | Available |
|---|---|---|---|---|
| **Nyaa** | Main anime torrent tracker. Sub-focused English releases. | Sub | 🇺🇸 🇯🇵 | ✅ Yes |
| **Nyaa (Dub)** | Same as Nyaa but searches for English-dubbed releases. | Dub | 🇺🇸 | ✅ Yes |
| **Nyaa (Non-English)** | Nyaa's non-English category. Set your language keyword in options (e.g. `Arabic`, `Hindi`, `Bangla`). | Dub | 🇸🇦 🇪🇬 🇮🇳 🇧🇩 + more | ✅ Yes |
| **SeaDex** | Community-curated best and alt releases, matched by AniList ID. High accuracy. | Sub | 🇺🇸 🇯🇵 | ✅ Yes |
| **Tokyo Toshokan** | One of the oldest anime indexes. Great for older and classic shows, and for batches. | Sub | 🇺🇸 🇯🇵 | ✅ Yes |
| **SubsPlease** | Weekly simulcast releases from a trusted fansub group. Consistent, high quality. | Sub | 🇺🇸 | ✅ Yes |
| **acg.rip** | Chinese anime tracker. Great for CJK fansubs not found on Nyaa. | Sub | 🇨🇳 🇯🇵 | ✅ Yes |
| **AniRena** | Anime tracker that mirrors many Nyaa groups. Returns only the episode you asked for, with real seeders and info hashes. | Sub/Dub | 🇺🇸 🇯🇵 | ✅ Yes |
| **Mikan** | Anime-only tracker for Chinese fansubs. Understands absolute episode numbers and Chinese season names. No seeder counts. | Sub | 🇨🇳 🇹🇼 🇯🇵 | ✅ Yes |
| **Sukebei** | Nyaa's adult content sister site. Hentai anime and doujinshi. | Sub | 🇺🇸 🇯🇵 | ✅ Yes |

> The **Available** column is rewritten automatically by `check-sources.mjs` on every run and reflects whether the source *responds*. it can't detect whether search results are actually good.

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

#### AniRena
| Option | Description | Default |
|---|---|---|
| `domain` | Base URL. Override only if AniRena moves domains. | `https://www.anirena.com` |
| `category` | AniRena category. `anime` = Anime. Leave empty to search every category. | `anime` |
| `subcategory` | Anime sub-category. `sub-audio` = Subtitle(s) and/or Audio(s), `raw` = RAW, empty = all anime. | `sub-audio` |

#### Mikan
| Option | Description | Default |
|---|---|---|
| `domain` | Base URL. Override only if Mikan moves domains. | `https://mikanani.me` |

#### SubsPlease
| Option | Description | Default |
|---|---|---|
| `resolution` | Preferred resolution: `480`, `720`, or `1080`. Leave empty to use Hayase's setting. | `1080` |

#### Sukebei
| Option | Description | Default |
|---|---|---|
| `domain` | Sukebei base URL. Tried first. Leave as-is unless the official site is blocked for you. | `https://sukebei.nyaa.si` |
| `domains` | Optional fallback mirrors, comma-separated. Tried in order if `domain` doesn't respond. | *(empty)* |
| `category` | Category: `1_1` = Hentai, `2_2` = Real Life Videos, `0_0` = All. | `1_1` |
| `filter` | Quality filter. `0` = all, `1` = no remakes, `2` = trusted only. | `0` |

#### Tokyo Toshokan
| Option | Description | Default |
|---|---|---|
| `categories` | Category numbers, comma-separated. `1` = Anime, `11` = Batch, `10` = Non-English, `7` = Raws, `12` = Hentai (Anime). | `1,11` |

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
- Set the manifest `url` to the exact site your extension fetches from. Hayase only allows cross-origin requests to that site, so a request to any other domain fails with "Failed to fetch". `check-sources.mjs` flags a mismatch.
- Always handle errors with user-friendly messages (these are shown directly to the user in Hayase)
- Apply `query.exclusions` to filter out unwanted results
- Add dev comments explaining non-obvious decisions, especially any trade-offs

---

## Known Issues

- **AnimeTosho was retired.** Its feed stopped indexing new releases in early May 2026 and its own notice says it will be shut down. For anything newer, use Nyaa, AniRena, Mikan, Tokyo Toshokan or SubsPlease. If you still have it installed, you can remove it in Hayase.

Found another problem? Open an [issue](https://github.com/tanzim2000/hayase-extension/issues).

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
