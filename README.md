<a id="top"></a>

<!-- ===== HEADER: everything inside this div is centered ===== -->
<!-- COLORS: taken from the Hayase app's splash-screen flash (sampled from a screen recording).
       FD0000  Hayase red (the red half of the glitch logo)
       00FAFA  Hayase cyan (the cyan half of the glitch logo)
       770C0C  deep red (the glowing background of the flash)
       080808  Hayase black (the splash background after the flash)
       C40D0D  darker red, used only in light mode so text stays readable on white
     THEME-AWARE IMAGES: every image sits inside a <picture> tag. GitHub picks the <source>
     whose media query matches the viewer's theme (dark or light). The <img> is the fallback.
     When you edit an image, change BOTH <source> URLs and the <img> fallback.
     RULES THAT BREAK THINGS IF IGNORED:
       1. Inside srcset, never write a plain comma. Use %2C instead (a comma splits the URL).
       2. Keep each <a ...><picture>...</picture></a> on ONE line. Line breaks inside a link
          show up as small underlined gaps next to the badge.
       3. No comments or blank lines between badges in a row, or each badge gets its own line. -->
<div align="center">

<!-- ANIMATED TITLE (capsule-render): "color=" is the background, "fontColor=" is the title.
     Dark and light: Hayase red fading into Hayase cyan (the two halves of the logo), white title. -->
<picture><source media="(prefers-color-scheme: dark)" srcset="https://capsule-render.vercel.app/api?type=waving&height=220&color=0:FD0000%2C100:00FAFA&section=header&text=hayase-extension&fontSize=56&fontColor=FFFFFF&animation=fadeIn&fontAlignY=38"><source media="(prefers-color-scheme: light)" srcset="https://capsule-render.vercel.app/api?type=waving&height=220&color=0:FD0000%2C100:00FAFA&section=header&text=hayase-extension&fontSize=56&fontColor=FFFFFF&animation=fadeIn&fontAlignY=38"><img src="https://capsule-render.vercel.app/api?type=waving&height=220&color=0:FD0000%2C100:00FAFA&section=header&text=hayase-extension&fontSize=56&fontColor=FFFFFF&animation=fadeIn&fontAlignY=38" alt="hayase-extension" /></picture>

<!-- ANIMATED SUBTITLE (readme-typing-svg): "lines=" holds the sentences separated by ";"
     (spaces are written as "+"). Dark: 00FAFA cyan. Light: C40D0D red (cyan is unreadable on white). -->
<picture><source media="(prefers-color-scheme: dark)" srcset="https://readme-typing-svg.demolab.com?font=Fira+Code&weight=500&size=20&duration=3000&pause=1200&color=00FAFA&center=true&vCenter=true&width=640&height=40&lines=Torrent+sources+for+Hayase;English+subs+%C2%B7+English+dubs;Non-English+%C2%B7+CJK+fansubs;Nyaa+%C2%B7+SeaDex+%C2%B7+SubsPlease+%C2%B7+acg.rip+%26+more"><source media="(prefers-color-scheme: light)" srcset="https://readme-typing-svg.demolab.com?font=Fira+Code&weight=500&size=20&duration=3000&pause=1200&color=C40D0D&center=true&vCenter=true&width=640&height=40&lines=Torrent+sources+for+Hayase;English+subs+%C2%B7+English+dubs;Non-English+%C2%B7+CJK+fansubs;Nyaa+%C2%B7+SeaDex+%C2%B7+SubsPlease+%C2%B7+acg.rip+%26+more"><img src="https://readme-typing-svg.demolab.com?font=Fira+Code&weight=500&size=20&duration=3000&pause=1200&color=00FAFA&center=true&vCenter=true&width=640&height=40&lines=Torrent+sources+for+Hayase;English+subs+%C2%B7+English+dubs;Non-English+%C2%B7+CJK+fansubs;Nyaa+%C2%B7+SeaDex+%C2%B7+SubsPlease+%C2%B7+acg.rip+%26+more" alt="Torrent sources for Hayase: English subs, English dubs, non-English and CJK fansubs" /></picture>

<br />

<!-- BADGES (shields.io): left half is "labelColor=", right half is "color=".
     Dark labels: 080808 (Hayase black). Light labels: E5E7EB (light gray, shields makes the text dark).
     Version uses Hayase red, Extensions uses Hayase cyan (shields picks dark text on cyan by itself). Sources turns green/red by itself, Stars is amber, License is green.
     Order: Version (static: bump the number in all three URLs), Extensions (live count from
     index.json), Sources (live check-sources.yml status), Stars (live), License (static). -->
<a href="https://github.com/tanzim2000/hayase-extension/blob/main/index.json"><picture><source media="(prefers-color-scheme: dark)" srcset="https://img.shields.io/badge/version-2.1.0-FD0000?style=for-the-badge&labelColor=080808"><source media="(prefers-color-scheme: light)" srcset="https://img.shields.io/badge/version-2.1.0-FD0000?style=for-the-badge&labelColor=E5E7EB"><img src="https://img.shields.io/badge/version-2.1.0-FD0000?style=for-the-badge&labelColor=080808" alt="Version" /></picture></a>
<a href="https://github.com/tanzim2000/hayase-extension/blob/main/index.json"><picture><source media="(prefers-color-scheme: dark)" srcset="https://img.shields.io/badge/dynamic/json?url=https%3A%2F%2Fraw.githubusercontent.com%2Ftanzim2000%2Fhayase-extension%2Frefs%2Fheads%2Fmain%2Findex.json&query=%24.length&label=extensions&style=for-the-badge&color=00FAFA&labelColor=080808"><source media="(prefers-color-scheme: light)" srcset="https://img.shields.io/badge/dynamic/json?url=https%3A%2F%2Fraw.githubusercontent.com%2Ftanzim2000%2Fhayase-extension%2Frefs%2Fheads%2Fmain%2Findex.json&query=%24.length&label=extensions&style=for-the-badge&color=00FAFA&labelColor=E5E7EB"><img src="https://img.shields.io/badge/dynamic/json?url=https%3A%2F%2Fraw.githubusercontent.com%2Ftanzim2000%2Fhayase-extension%2Frefs%2Fheads%2Fmain%2Findex.json&query=%24.length&label=extensions&style=for-the-badge&color=00FAFA&labelColor=080808" alt="Extensions" /></picture></a>
<a href="https://github.com/tanzim2000/hayase-extension/actions/workflows/check-sources.yml"><picture><source media="(prefers-color-scheme: dark)" srcset="https://img.shields.io/github/actions/workflow/status/tanzim2000/hayase-extension/check-sources.yml?style=for-the-badge&label=sources&labelColor=080808"><source media="(prefers-color-scheme: light)" srcset="https://img.shields.io/github/actions/workflow/status/tanzim2000/hayase-extension/check-sources.yml?style=for-the-badge&label=sources&labelColor=E5E7EB"><img src="https://img.shields.io/github/actions/workflow/status/tanzim2000/hayase-extension/check-sources.yml?style=for-the-badge&label=sources&labelColor=080808" alt="Sources status" /></picture></a>
<a href="https://github.com/tanzim2000/hayase-extension/stargazers"><picture><source media="(prefers-color-scheme: dark)" srcset="https://img.shields.io/github/stars/tanzim2000/hayase-extension?style=for-the-badge&labelColor=080808&color=F59E0B"><source media="(prefers-color-scheme: light)" srcset="https://img.shields.io/github/stars/tanzim2000/hayase-extension?style=for-the-badge&labelColor=E5E7EB&color=F59E0B"><img src="https://img.shields.io/github/stars/tanzim2000/hayase-extension?style=for-the-badge&labelColor=080808&color=F59E0B" alt="Stars" /></picture></a>
<a href="https://github.com/tanzim2000/hayase-extension/blob/main/LICENSE"><picture><source media="(prefers-color-scheme: dark)" srcset="https://img.shields.io/badge/license-MIT-22C55E?style=for-the-badge&labelColor=080808"><source media="(prefers-color-scheme: light)" srcset="https://img.shields.io/badge/license-MIT-22C55E?style=for-the-badge&labelColor=E5E7EB"><img src="https://img.shields.io/badge/license-MIT-22C55E?style=for-the-badge&labelColor=080808" alt="MIT License" /></picture></a>

<br />
<!-- ONE-LINE DESCRIPTION -->
A collection of torrent source extensions for <a href="https://github.com/hayase-app/hayase">Hayase</a>, covering English subs, English dubs, non-English languages, and CJK fansubs.

</div><br />

> **Disclaimer:** This project is for educational purposes only. It provides source code for search extensions that interface with publicly available torrent indexers. It does not host, distribute, or link to any copyrighted content. Users are solely responsible for ensuring their use complies with applicable laws and the terms of service of any indexer they connect to.

---

<!-- QUICK-LINK NAV: same badge style as the header row.
     Dark: 080808 (Hayase black chip). Light: E5E7EB (light gray chip, dark text).
     Each href="#name" must match a heading below, lowercased, with spaces turned into "-".
     Example: "## Known Issues" -> #known-issues -->
<div align="center">
<a href="#installation"><picture><source media="(prefers-color-scheme: dark)" srcset="https://img.shields.io/badge/INSTALL-080808?style=for-the-badge"><source media="(prefers-color-scheme: light)" srcset="https://img.shields.io/badge/INSTALL-E5E7EB?style=for-the-badge"><img src="https://img.shields.io/badge/INSTALL-080808?style=for-the-badge" alt="Install" /></picture></a>
<a href="#extensions"><picture><source media="(prefers-color-scheme: dark)" srcset="https://img.shields.io/badge/EXTENSIONS-080808?style=for-the-badge"><source media="(prefers-color-scheme: light)" srcset="https://img.shields.io/badge/EXTENSIONS-E5E7EB?style=for-the-badge"><img src="https://img.shields.io/badge/EXTENSIONS-080808?style=for-the-badge" alt="Extensions" /></picture></a>
<a href="#extension-options"><picture><source media="(prefers-color-scheme: dark)" srcset="https://img.shields.io/badge/OPTIONS-080808?style=for-the-badge"><source media="(prefers-color-scheme: light)" srcset="https://img.shields.io/badge/OPTIONS-E5E7EB?style=for-the-badge"><img src="https://img.shields.io/badge/OPTIONS-080808?style=for-the-badge" alt="Options" /></picture></a>
<a href="#contributing"><picture><source media="(prefers-color-scheme: dark)" srcset="https://img.shields.io/badge/CONTRIBUTE-080808?style=for-the-badge"><source media="(prefers-color-scheme: light)" srcset="https://img.shields.io/badge/CONTRIBUTE-E5E7EB?style=for-the-badge"><img src="https://img.shields.io/badge/CONTRIBUTE-080808?style=for-the-badge" alt="Contribute" /></picture></a>
<a href="#known-issues"><picture><source media="(prefers-color-scheme: dark)" srcset="https://img.shields.io/badge/KNOWN_ISSUES-080808?style=for-the-badge"><source media="(prefers-color-scheme: light)" srcset="https://img.shields.io/badge/KNOWN_ISSUES-E5E7EB?style=for-the-badge"><img src="https://img.shields.io/badge/KNOWN_ISSUES-080808?style=for-the-badge" alt="Known Issues" /></picture></a>
</div>

---

## Installation

Add this repository URL to Hayase:

```
https://raw.githubusercontent.com/tanzim2000/hayase-extension/refs/heads/main/index.json
```

> [!TIP]
> 1. Open Hayase and go to **Settings → Extensions**
> 2. Click **Add Repository** and paste the URL above
> 3. All available extensions appear. Enable the ones you want.

---

## Extensions

<!-- LIVE DASHBOARD: a GitHub Actions bot (scripts/check-sources.mjs) rewrites two things
     in this section on every run:
       1. The LAST cell (Status) of every table row whose first cell has a **bold name**
          that matches a "name" in index.json.
       2. The date between the LAST_CHECKED markers in the note under the table.
     Edit the Description, Media and Languages cells freely: the bot never touches them.
     To add a source: add a row with the icon, the bold name exactly as in index.json, and
     any placeholder in the Status cell. The next run fills it in.
     Icons come from Google's favicon service: change "domain=" to the source's site. -->

### Torrent Sources

| Source | Description | Media | Languages | Status |
|---|---|---|---|---|
| <img src="https://www.google.com/s2/favicons?domain=nyaa.si&sz=32" width="16" height="16" alt="" /> **Nyaa** | Main anime torrent tracker. Sub-focused English releases. | Sub | 🇺🇸 🇯🇵 | <img src="https://img.shields.io/badge/online-22C55E?style=flat-square" alt="online" /> |
| <img src="https://www.google.com/s2/favicons?domain=nyaa.si&sz=32" width="16" height="16" alt="" /> **Nyaa (Dub)** | Same as Nyaa but searches for English-dubbed releases. | Dub | 🇺🇸 | <img src="https://img.shields.io/badge/online-22C55E?style=flat-square" alt="online" /> |
| <img src="https://www.google.com/s2/favicons?domain=nyaa.si&sz=32" width="16" height="16" alt="" /> **Nyaa (Non-English)** | Nyaa's non-English category. Set your language keyword in options (e.g. `Arabic`, `Hindi`, `Bangla`). | Dub | 🇸🇦 🇪🇬 🇮🇳 🇧🇩 + more | <img src="https://img.shields.io/badge/online-22C55E?style=flat-square" alt="online" /> |
| <img src="https://www.google.com/s2/favicons?domain=releases.moe&sz=32" width="16" height="16" alt="" /> **SeaDex** | Community-curated best and alt releases, matched by AniList ID. High accuracy. | Sub | 🇺🇸 🇯🇵 | <img src="https://img.shields.io/badge/online-22C55E?style=flat-square" alt="online" /> |
| <img src="https://www.google.com/s2/favicons?domain=tokyotosho.info&sz=32" width="16" height="16" alt="" /> **Tokyo Toshokan** | One of the oldest anime indexes. Great for older and classic shows, and for batches. | Sub | 🇺🇸 🇯🇵 | <img src="https://img.shields.io/badge/online-22C55E?style=flat-square" alt="online" /> |
| <img src="https://www.google.com/s2/favicons?domain=subsplease.org&sz=32" width="16" height="16" alt="" /> **SubsPlease** | Weekly simulcast releases from a trusted fansub group. Consistent, high quality. | Sub | 🇺🇸 | <img src="https://img.shields.io/badge/online-22C55E?style=flat-square" alt="online" /> |
| <img src="https://www.google.com/s2/favicons?domain=acg.rip&sz=32" width="16" height="16" alt="" /> **acg.rip** | Chinese anime tracker. Great for CJK fansubs not found on Nyaa. | Sub | 🇨🇳 🇯🇵 | <img src="https://img.shields.io/badge/online-22C55E?style=flat-square" alt="online" /> |
| <img src="https://www.google.com/s2/favicons?domain=anirena.com&sz=32" width="16" height="16" alt="" /> **AniRena** | Anime tracker that mirrors many Nyaa groups. Returns only the episode you asked for, with real seeders and info hashes. | Sub/Dub | 🇺🇸 🇯🇵 | <img src="https://img.shields.io/badge/online-22C55E?style=flat-square" alt="online" /> |
| <img src="https://www.google.com/s2/favicons?domain=mikanani.me&sz=32" width="16" height="16" alt="" /> **Mikan** | Anime-only tracker for Chinese fansubs. Understands absolute episode numbers and Chinese season names. No seeder counts. | Sub | 🇨🇳 🇹🇼 🇯🇵 | <img src="https://img.shields.io/badge/online-22C55E?style=flat-square" alt="online" /> |
| <img src="https://www.google.com/s2/favicons?domain=sukebei.nyaa.si&sz=32" width="16" height="16" alt="" /> **Sukebei** | Nyaa's adult content sister site. Hentai anime and doujinshi. | Sub | 🇺🇸 🇯🇵 | <img src="https://img.shields.io/badge/online-22C55E?style=flat-square" alt="online" /> |
<div align="center">
       
> 🕐 Last checked: <!-- LAST_CHECKED -->October 17, 2026 at 20:23 UTC<!-- /LAST_CHECKED -->

</div>

> [!IMPORTANT]
> The Status column is refreshed every week by GitHub's bots. **Online** means the source responded, with how long it took. It can't tell whether the search results are actually good, and times are measured from GitHub's servers, so yours may differ.

### Extension Options

<!-- Each extension gets a collapsed <details> block, in the same order as the table above.
     The <summary> line lists the option names so people can scan without opening anything.
     Keep a BLANK LINE after </summary> and before </details>, or the table inside won't render.
     SeaDex has no options, so it has no block. Keep this section in sync with "options" in index.json. -->

Some extensions have options you can change under **Settings → Extensions → [Extension Name]**. Click an extension to see its options. SeaDex has none.

<details>
<summary><b>Nyaa</b> &nbsp;·&nbsp; <code>domain</code> <code>filter</code></summary>

| Option | Description | Default |
|---|---|---|
| `domain` | Base URL. Change to a mirror if nyaa.si is blocked in your region. | `https://nyaa.si` |
| `filter` | Quality filter. `0` = all, `1` = no remakes, `2` = trusted only. | `0` |

</details>

<details>
<summary><b>Nyaa (Dub)</b> &nbsp;·&nbsp; <code>domain</code> <code>filter</code> <code>keyword</code> <code>category</code></summary>

| Option | Description | Default |
|---|---|---|
| `domain` | Base URL. Change to a mirror if nyaa.si is blocked in your region. | `https://nyaa.si` |
| `filter` | Quality filter. `0` = all, `1` = no remakes, `2` = trusted only. | `0` |
| `keyword` | Keyword appended to every search query. | `Dubbed` |
| `category` | Nyaa category ID. Default is `1_2` (Anime - English Translated). | `1_2` |

</details>

<details>
<summary><b>Nyaa (Non-English)</b> &nbsp;·&nbsp; <code>domain</code> <code>filter</code> <code>keyword</code> <code>category</code></summary>

| Option | Description | Default |
|---|---|---|
| `domain` | Base URL. Change to a mirror if nyaa.si is blocked in your region. | `https://nyaa.si` |
| `filter` | Quality filter. `0` = all, `1` = no remakes, `2` = trusted only. | `0` |
| `keyword` | Language keyword appended to every search query. Set this to your language, e.g. `Arabic`, `Hindi`, `Bangla`. | *(empty)* |
| `category` | Nyaa category ID. Default is `1_3` (Anime - Non-English Translated). | `1_3` |

</details>

<details>
<summary><b>Tokyo Toshokan</b> &nbsp;·&nbsp; <code>categories</code></summary>

| Option | Description | Default |
|---|---|---|
| `categories` | Category numbers, comma-separated. `1` = Anime, `11` = Batch, `10` = Non-English, `7` = Raws, `12` = Hentai (Anime). | `1,11` |

</details>

<details>
<summary><b>SubsPlease</b> &nbsp;·&nbsp; <code>resolution</code></summary>

| Option | Description | Default |
|---|---|---|
| `resolution` | Preferred resolution: `480`, `720`, or `1080`. Leave empty to use Hayase's setting. | `1080` |

</details>

<details>
<summary><b>acg.rip</b> &nbsp;·&nbsp; <code>domain</code></summary>

| Option | Description | Default |
|---|---|---|
| `domain` | Base URL. Override only if acg.rip moves domains. | `https://acg.rip` |

</details>

<details>
<summary><b>AniRena</b> &nbsp;·&nbsp; <code>domain</code> <code>category</code> <code>subcategory</code></summary>

| Option | Description | Default |
|---|---|---|
| `domain` | Base URL. Override only if AniRena moves domains. | `https://www.anirena.com` |
| `category` | AniRena category. `anime` = Anime. Leave empty to search every category. | `anime` |
| `subcategory` | Anime sub-category. `sub-audio` = Subtitle(s) and/or Audio(s), `raw` = RAW, empty = all anime. | `sub-audio` |

</details>

<details>
<summary><b>Mikan</b> &nbsp;·&nbsp; <code>domain</code></summary>

| Option | Description | Default |
|---|---|---|
| `domain` | Base URL. Override only if Mikan moves domains. | `https://mikanani.me` |

</details>

<details>
<summary><b>Sukebei</b> &nbsp;·&nbsp; <code>domain</code> <code>domains</code> <code>category</code> <code>filter</code></summary>

| Option | Description | Default |
|---|---|---|
| `domain` | Sukebei base URL. Tried first. Leave as-is unless the official site is blocked for you. | `https://sukebei.nyaa.si` |
| `domains` | Optional fallback mirrors, comma-separated. Tried in order if `domain` doesn't respond. | *(empty)* |
| `category` | Category: `1_1` = Hentai, `2_2` = Real Life Videos, `0_0` = All. | `1_1` |
| `filter` | Quality filter. `0` = all, `1` = no remakes, `2` = trusted only. | `0` |

</details>

---

## Contributing

Contributions are welcome! See [CONTRIBUTING.md](CONTRIBUTING.md) for how to set up, build, and add or improve a source.

---

## Known Issues

- **AnimeTosho was retired.** Its feed stopped indexing new releases in early May 2026 and its own notice says it will be shut down. For anything newer, use Nyaa, AniRena, Mikan, Tokyo Toshokan or SubsPlease. If you still have it installed, you can remove it in Hayase.

Found another problem? Open an [issue](https://github.com/tanzim2000/hayase-extension/issues).

---

## Why No NZB Support?

NZB sources like AltHub and NZBGeek require a personal API key to search, which means every user has to register, generate a key, and paste it into the extension settings before it works. That's friction I didn't want to impose.

That said, if you want to add NZB support yourself, contributions are absolutely welcome. See [CONTRIBUTING.md](CONTRIBUTING.md).

---

## Acknowledgements

- **[sinnafuls/hayase-ext](https://github.com/sinnafuls/hayase-ext)**: the project that inspired this one. Several ideas (including acg.rip support and the NZB extension approach) came from looking at his work.
- **[Claude](https://claude.ai)** (Anthropic): assisted with architecture decisions, code, and documentation throughout this project.

---

<div align="center">

<sub>Released under the [MIT License](https://github.com/tanzim2000/hayase-extension/blob/main/LICENSE) · © tanzim2000</sub>

</div>
