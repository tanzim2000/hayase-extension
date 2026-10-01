// anirena.js — AniRena torrent extension for Hayase
//
// Searches AniRena (https://www.anirena.com) by reading its normal search page.
//
// Why the search PAGE and not the RSS feed?
//   AniRena's RSS feed has no seeders, leechers or info hash. The search page
//   has seeders, leechers and downloads for every row, so we read that instead.
//   (AniRena also has a JSON API, but it needs a personal API key — the same
//   friction that keeps NZB sources out of this collection.)
//
// Where does the info hash come from?
//   Neither the search page nor the RSS feed shows it. Each torrent's detail
//   page (/torrent/<id>) does, so we open the detail page ONLY for the results
//   we are about to return (at most MAX_HASH_LOOKUPS of them, all at once).
//   If a detail page can't be read, that result falls back to the .torrent URL
//   as its hash — the same trade-off acgrip.js makes (see toResult() below).
//
// Features:
//   - Episode filtering (only the episode you asked for, never other episodes)
//   - Season check ("2nd Season" searches drop releases marked S01)
//   - Correct batch detection (a single "S03E11" release is NOT a batch)
//   - Searches several title spellings at once and merges the results
//     (full title, and the title without "2nd Season" etc.)
//   - Drops look-alike shows (AniRena's search is fuzzy: "Suzume" finds "Susume")
//   - Resolution filtering and exclusion keywords (query.exclusions)
//   - Retry logic with backoff on the search request
//   - Configurable domain, category and sub-category via Hayase options
//   - Debug logging (set DEBUG_MODE = true to enable)
//
// Known limitations:
//   - AniRena's search needs every word of the query to match, and adding an
//     episode number breaks it ("Sousou no Frieren 07" finds nothing). So we
//     search by title only and pick the episode out of the results ourselves.
//   - Very long official titles can find nothing when release groups spell
//     the show differently ("Daidaidaidaidaisuki" vs "Dai Dai Dai Dai Daisuki").
//     Nothing to do about that without guessing.

// ─── Debug ────────────────────────────────────────────────────────────────────
// Set to true to enable detailed logging in Hayase's DevTools console (Ctrl+Shift+I)
// Set back to false before publishing
const DEBUG_MODE = false

const log = {
	_fmt (level, msg, data) {
		if (!DEBUG_MODE) return
		const ts = new Date().toISOString()
		const prefix = `[AniRena][${ts}][${level}]`
		const fn = level === 'ERROR' ? 'error' : level === 'WARN' ? 'warn' : 'log'
		data !== undefined ? console[fn](prefix, msg, data) : console[fn](prefix, msg)
	},
	info:  (msg, data) => log._fmt('INFO',  msg, data),
	warn:  (msg, data) => log._fmt('WARN',  msg, data),
	error: (msg, data) => log._fmt('ERROR', msg, data),
	debug: (msg, data) => log._fmt('DEBUG', msg, data),
}
// ─────────────────────────────────────────────────────────────────────────────

// Default values — can be overridden via Hayase extension options
const DEFAULT_DOMAIN      = 'https://www.anirena.com'
const DEFAULT_CATEGORY    = 'anime'      // AniRena's "cat" search parameter
const DEFAULT_SUBCATEGORY = 'sub-audio'  // "Subtitle(s) and/or Audio(s)". Use "" for all anime (incl. RAW)

// How many rows to ask AniRena for per search (it allows 50, 100 or 250).
// We filter episodes ourselves, so more rows = more chance the episode is in there.
const PER_PAGE = 250

// Most detail pages we will open to read info hashes, per search.
// Each one is an extra request, so we keep this small.
const MAX_HASH_LOOKUPS = 10

// Fetch timeout in ms
const TIMEOUT_MS = 15000

// Max retries on network failure (search page only — detail pages are not retried)
const MAX_RETRIES = 2

// Trackers taken from AniRena's own magnet links.
// Used to build a magnet link once we know the info hash.
const TRACKERS = [
	'udp://tracker-udp.anirena.com:80/announce',
	'https://tracker.anirena.com/announce',
	'http://nyaa.tracker.wf:7777/announce',
	'udp://open.demonii.com:1337/announce',
	'udp://tracker.srv00.com:6969/announce',
]

// ─── Small text helpers ──────────────────────────────────────────────────────

/**
 * Turn HTML entities back into normal characters.
 * e.g. "Journey&#39;s End" => "Journey's End"
 * @param {string} text
 * @returns {string}
 */
function decodeEntities (text) {
	return text
		.replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
		.replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
		.replace(/&quot;/g, '"')
		.replace(/&apos;/g, "'")
		.replace(/&lt;/g, '<')
		.replace(/&gt;/g, '>')
		.replace(/&nbsp;/g, ' ')
		.replace(/&amp;/g, '&')  // last, so "&amp;lt;" becomes "&lt;" and not "<"
}

/**
 * Remove all HTML tags from a snippet and tidy the spaces.
 * @param {string} html
 * @returns {string}
 */
function stripTags (html) {
	return decodeEntities(html.replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim()
}

/**
 * Parse a size string like "5.7 GB" or "404.4 MB" into bytes.
 * @param {string} sizeStr
 * @returns {number}
 */
function parseSize (sizeStr) {
	if (!sizeStr) return 0
	const match = sizeStr.match(/([\d.]+)\s*(KiB|MiB|GiB|TiB|KB|MB|GB|TB)/i)
	if (!match) return 0
	const value = parseFloat(match[1])
	switch (match[2].toUpperCase()) {
		case 'KIB': case 'KB': return Math.round(value * 1024)
		case 'MIB': case 'MB': return Math.round(value * 1024 ** 2)
		case 'GIB': case 'GB': return Math.round(value * 1024 ** 3)
		case 'TIB': case 'TB': return Math.round(value * 1024 ** 4)
		default: return 0
	}
}

/**
 * Read the biggest number in a table cell.
 *
 * AniRena shows two numbers per cell, e.g. seeders "24(89)":
 *   24   = peers on AniRena's own tracker
 *   (89) = the highest count reported by any external tracker
 * The torrent is shared on all those trackers, so the bigger number is the
 * better guess of how healthy the swarm really is.
 * @param {string} cellText  — e.g. "24(89)" or "1,208(1457)"
 * @returns {number}
 */
function biggestNumber (cellText) {
	const numbers = (cellText.replace(/,/g, '').match(/\d+/g) || []).map(Number)
	return numbers.length ? Math.max(...numbers) : 0
}

// ─── Episode, batch and season checks ────────────────────────────────────────
// titleMatchesEpisode() and looksLikeBatch() are the same as in nyaasi.js.

/**
 * Does this torrent title say it is exactly the given episode?
 *
 * Release titles write the episode in many ways, so we check all of these:
 *   "S03E07"        (season + episode — the most common style these days)
 *   "E07" / "EP07"  (episode only)
 *   "Episode 7"
 *   "- 07"          (classic fansub style: "Show Name - 07 [1080p]")
 *   "[07]"
 *   "第7话"          (Chinese style)
 *
 * The (?!\d) at the end of each pattern means "not followed by another digit",
 * so asking for episode 1 will NOT match episode 11 or EP1180.
 * @param {string} title
 * @param {number} episode
 * @returns {boolean}
 */
function titleMatchesEpisode (title, episode) {
	// Strip leading zeros: "07" and 7 both become "7", then we allow any zeros back in
	const n = String(Number(episode))
	const patterns = [
		`S\\d{1,2}E0*${n}(?!\\d)`,                        // S03E07
		`(?<![A-Za-z])[Ee][Pp]?\\s?0*${n}(?!\\d)`,        // E07, EP07, Ep 7
		`Episode\\s*0*${n}(?!\\d)`,                        // Episode 7
		`[-–]\\s*0*${n}(?:v\\d+)?(?!\\d)(?!\\s?[pP]\\b)`, // - 07, - 07v2 (but not "- 1080p")
		`\\[0*${n}(?:v\\d+)?\\]`,                          // [07]
		`第0*${n}[话話集]`,                                 // 第7话
	]
	return patterns.some(p => new RegExp(p, 'i').test(title))
}

/**
 * Does this torrent title look like a multi-episode pack (a "batch")?
 *
 * We decide in this order:
 *   1. An episode range like "01-12" or "01~12"      → batch
 *   2. The word "batch" or "complete"                → batch
 *   3. Names one episode ("S03E11", "- 09", "[09]",
 *      "E09", "第9话")                                → NOT a batch
 *   4. A bare season tag ("S03", "S3", "Season 3",
 *      "3rd Season") or "Vol.1"                      → batch
 *   5. Anything else                                 → NOT a batch
 * Step 3 comes before step 4 so "[SubsPlease] Show S3 - 09" counts as one episode.
 * @param {string} title
 * @returns {boolean}
 */
function looksLikeBatch (title) {
	// Remove resolutions ("1080p") and codec-style numbers ("x265") first,
	// so they are not mistaken for episode numbers or ranges
	// and Japanese counters like "100-nin" (100 people) so they are not read as a range
	const t = title
		.replace(/\b\d{3,4}p\b/gi, ' ')
		.replace(/\b[xh]\.?26[45]\b/gi, ' ')
		.replace(/\b\d{1,3}-nin\b/gi, ' ')

	// 1. Episode range: "01-12", "01 ~ 12", "S03E01-E12"
	if (/\b\d{1,3}\s*[-~]\s*E?\d{1,3}\b/i.test(t)) return true

	// 2. Explicit words
	if (/\b(batch|complete)\b/i.test(t)) return true

	// 3. A single-episode marker means this is one episode
	const singleEpisode = [
		/S\d{1,2}E\d{1,4}/i,                         // S03E11
		/(?<![A-Za-z])EP?\s?\d{1,4}\b/i,             // E11, EP11, Ep 11
		/\s[-–]\s\d{1,4}(?:v\d+)?(?=[\s[(.]|$)/,     // " - 09", " - 01v2"
		/\[\d{1,4}(?:v\d+)?\]/,                      // [09]
		/第\d+[话話集]/,                              // 第9话
	]
	if (singleEpisode.some(p => p.test(t))) return false

	// 4. Bare season tag ("S03", "Season 3", "3rd Season") or volume, with no episode
	return /\bS\d{1,2}\b|\bSeason\s*\d{1,2}\b|\b\d{1,2}(?:st|nd|rd|th)\s+Season\b|\bvol\.?\s*\d/i.test(t)
}

/**
 * Find a season number written in a title, if there is one.
 *   "Sousou no Frieren 2nd Season"   → 2
 *   "Show Season 3" / "Show S3 - 09" → 3
 *   "Show S02E07"                    → 2
 *   "Sousou no Frieren"              → null (not stated)
 * @param {string} title
 * @returns {number | null}
 */
function seasonOf (title) {
	const patterns = [
		/\bS(\d{1,2})E\d/i,                  // S02E07
		/\bS(\d{1,2})\b/i,                   // S2, S02
		/\b(\d{1,2})(?:st|nd|rd|th)\s+Season\b/i,  // 2nd Season
		/\bSeason\s*(\d{1,2})\b/i,           // Season 2
	]
	for (const p of patterns) {
		const m = title.match(p)
		if (m) return Number(m[1])
	}
	return null
}

/**
 * Remove season wording from a title so AniRena can find releases that spell
 * the season differently. "Sousou no Frieren 2nd Season" → "Sousou no Frieren"
 * @param {string} title
 * @returns {string}
 */
function stripSeason (title) {
	return title
		.replace(/\b\d{1,2}(?:st|nd|rd|th)\s+Season\b/gi, ' ')
		.replace(/\bSeason\s*\d{1,2}\b/gi, ' ')
		.replace(/\bPart\s*\d{1,2}\b/gi, ' ')
		.replace(/\bS\d{1,2}\b/g, ' ')
		.replace(/\s+/g, ' ')
		.trim()
}

/**
 * Clean a title for use as a search query.
 * Keeps Japanese/Unicode characters, removes characters that confuse the search.
 * @param {string} title
 * @returns {string}
 */
function cleanTitle (title) {
	return title
		.replace(/[<>",]/g, ' ')
		.replace(/\s+/g, ' ')
		.trim()
}

/**
 * Build the list of search terms to try, best first, without duplicates.
 *   "Sousou no Frieren 2nd Season" → ["Sousou no Frieren 2nd Season", "Sousou no Frieren"]
 * @param {string[]} titles  — query.titles from Hayase
 * @returns {string[]}
 */
function buildTerms (titles) {
	const terms = []
	const seen = new Set()
	for (const title of titles.slice(0, 3)) {
		if (!title) continue
		for (const term of [cleanTitle(title), cleanTitle(stripSeason(title))]) {
			const key = term.toLowerCase()
			if (term && !seen.has(key)) {
				seen.add(key)
				terms.push(term)
			}
		}
	}
	return terms
}

// ─── Network ─────────────────────────────────────────────────────────────────

/**
 * Fetch a page with timeout and retry logic.
 * Uses query.fetch (passed by Hayase) instead of global fetch —
 * required for CORS to work inside Hayase's sandboxed Web Worker.
 * @param {typeof fetch} fetchFn  — Hayase's fetch function from query.fetch
 * @param {string} url
 * @param {number} [retries]
 * @returns {Promise<Response>}
 */
async function fetchWithRetry (fetchFn, url, retries = MAX_RETRIES) {
	for (let attempt = 0; attempt <= retries; attempt++) {
		const controller = new AbortController()
		const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
		log.info(`Fetch attempt ${attempt + 1}/${retries + 1}`, { url })
		try {
			const res = await fetchFn(url, {
				signal: controller.signal,
				headers: { Accept: 'text/html' },
			})
			clearTimeout(timer)
			if (!res.ok) throw new Error(`AniRena returned HTTP ${res.status}. The site may be down or blocked in your region.`)
			log.info('Fetch OK', { status: res.status, url })
			return res
		} catch (err) {
			clearTimeout(timer)
			log.warn(`Fetch failed (attempt ${attempt + 1})`, { url, error: err.message })
			if (attempt === retries) {
				// Throw user-friendly error on final failure
				if (err.name === 'AbortError') throw new Error(`AniRena request timed out after ${TIMEOUT_MS / 1000}s. The site may be slow or blocked.`)
				if (err.message.startsWith('AniRena')) throw err
				throw new Error(`Could not reach AniRena: ${err.message}`)
			}
			// Backoff: 500ms, 1000ms
			const delay = 500 * (attempt + 1)
			log.debug(`Retrying in ${delay}ms...`)
			await new Promise(r => setTimeout(r, delay))
		}
	}
}

/**
 * Build the search page URL.
 * e.g. https://www.anirena.com/?q=Frieren&cat=anime&sub=sub-audio&per_page=250
 * @param {string} domain
 * @param {string} term
 * @param {object} options  — Hayase extension options
 * @returns {string}
 */
function buildSearchURL (domain, term, options = {}) {
	// "?? " instead of "||" so a deliberately empty subcategory ("") means "all anime"
	const category    = (options.category ?? DEFAULT_CATEGORY).trim()
	const subcategory = (options.subcategory ?? DEFAULT_SUBCATEGORY).trim()
	const params = new URLSearchParams({ q: term })
	if (category) params.set('cat', category)
	if (category && subcategory) params.set('sub', subcategory)
	params.set('per_page', String(PER_PAGE))
	return `${domain}/?${params.toString()}`
}

/**
 * Get the domain from options, without a trailing slash.
 * @param {object} options
 * @returns {string}
 */
function getDomain (options = {}) {
	return (options.domain?.trim() || DEFAULT_DOMAIN).replace(/\/+$/, '')
}

// ─── Parsing the search page ─────────────────────────────────────────────────

/**
 * Get the inner HTML of the <td> that has the given class, from one table row.
 * AniRena writes classes both with and without quotes
 * (class=col-se and class="col-size tl-hide-md"), so we accept both.
 * @param {string} rowHtml
 * @param {string} cls  — e.g. "col-se"
 * @returns {string}
 */
function cell (rowHtml, cls) {
	const re = new RegExp(`<td\\b[^>]*\\bclass=(?:"[^"]*\\b${cls}\\b[^"]*"|'[^']*\\b${cls}\\b[^']*'|${cls}(?=[\\s>]))[^>]*>([\\s\\S]*?)<\\/td>`, 'i')
	const m = rowHtml.match(re)
	return m ? m[1] : ''
}

/**
 * Turn AniRena's search page HTML into a list of plain row objects.
 *
 * Each torrent is a <tr> with data-torrent-id and data-created-ts, e.g.
 *   <tr data-created-ts=1787099819 data-torrent-id=01a01773-...>
 * Inside it:
 *   <div class=tl-name-wrap>  → release group + torrent name
 *   <td class=col-size>       → "5.7 GB"
 *   <td class=col-se>         → seeders   "24(89)"
 *   <td class=col-le>         → leechers  "2(13)"
 *   <td class=col-dl>         → downloads "1208(1457)"
 *
 * @param {string} html
 * @returns {{ id: string, title: string, animeTitle: string, size: number, seeders: number, leechers: number, downloads: number, date: Date }[]}
 */
function parseSearchPage (html) {
	// If the results table is missing, we did not get a normal search page
	// (for example a Cloudflare "checking your browser" page, or a site redesign).
	if (!/class=["']?tl-table/.test(html)) {
		throw new Error('AniRena returned an unexpected page. The site may be showing a browser check or has changed its layout.')
	}

	const rows = []
	const rowRe = /<tr\b([^>]*\bdata-torrent-id=["']?([0-9a-f-]{36})[^>]*)>([\s\S]*?)<\/tr>/gi
	let m
	while ((m = rowRe.exec(html)) !== null) {
		const attrs = m[1]
		const id    = m[2]
		const body  = m[3]

		// Title = "[Group]" link + torrent name link. Add a space between the two.
		const nameWrap = body.match(/<div class=["']?tl-name-wrap["']?>([\s\S]*?)<\/div>/i)
		const title = nameWrap ? stripTags(nameWrap[1].replace(/<\/a>/gi, '</a> ')) : ''
		if (!title) {
			log.warn('Skipped row (no title)', { id })
			continue
		}

		// AniRena's own idea of which anime this is (from MyAnimeList), when it has one.
		// e.g. data-anime-title="Sousou no Frieren 2nd Season"
		const animeAttr = body.match(/data-anime-title=(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i)
		const animeTitle = animeAttr ? decodeEntities(animeAttr[1] ?? animeAttr[2] ?? animeAttr[3]) : ''

		// Upload time: data-created-ts is in seconds since 1970
		const ts = Number((attrs.match(/data-created-ts=["']?(\d+)/) || [])[1])
		const date = Number.isFinite(ts) && ts > 0 ? new Date(ts * 1000) : new Date(0)

		rows.push({
			id,
			title,
			animeTitle,
			size:      parseSize(stripTags(cell(body, 'col-size'))),
			seeders:   biggestNumber(stripTags(cell(body, 'col-se'))),
			leechers:  biggestNumber(stripTags(cell(body, 'col-le'))),
			downloads: biggestNumber(stripTags(cell(body, 'col-dl'))),
			date,
		})
	}

	log.info('parseSearchPage complete', { rows: rows.length })
	return rows
}

// ─── Filters ─────────────────────────────────────────────────────────────────

/**
 * Split text into lowercase words, ignoring punctuation.
 * "Frieren: Beyond Journey's End" → ["frieren", "beyond", "journeys", "end"]
 * @param {string} text
 * @returns {string[]}
 */
function wordsOf (text) {
	return text
		.normalize('NFKC')
		.toLowerCase()
		.replace(/['’]/g, '')
		.split(/[^\p{L}\p{N}]+/u)
		.filter(Boolean)
}

/**
 * Is this row really about the show we searched for?
 *
 * AniRena's search is fuzzy: searching "Suzume" also returns "Yama no Susume"
 * and "Suzumiya Haruhi". So we keep a row only if EVERY word of at least one
 * search term appears in the row's title, or in AniRena's anime title for it.
 *   - Latin words must match as whole words ("suzume" does not match "suzumiya")
 *   - Japanese/Chinese text has no spaces, so there we just check it's contained
 * @param {object} row
 * @param {string[]} terms
 * @returns {boolean}
 */
function matchesAnyTerm (row, terms) {
	const haystacks = [row.title, row.animeTitle].filter(Boolean).map(text => ({
		words: new Set(wordsOf(text)),
		joined: wordsOf(text).join(''),
	}))
	return terms.some(term => {
		const termWords = wordsOf(term)
		if (!termWords.length) return false
		return haystacks.some(h => termWords.every(w =>
			/^[a-z0-9]+$/.test(w) ? h.words.has(w) : h.joined.includes(w)
		))
	})
}

/**
 * Drop rows whose title states a different resolution than the user wants.
 * Rows that don't mention any resolution are kept (we can't tell, so we don't guess).
 * @param {object[]} rows
 * @param {string} resolution  — e.g. '1080', '720', '' (empty = no preference)
 * @returns {object[]}
 */
function filterByResolution (rows, resolution) {
	if (!resolution) return rows
	return rows.filter(r => {
		const found = r.title.match(/\b(2160|1080|720|540|480)p?\b/i)
		return !found || found[1] === String(resolution)
	})
}

/**
 * Drop rows that clearly belong to another season.
 * Only acts when BOTH the search title and the row title state a season.
 * e.g. searching "Sousou no Frieren 2nd Season" drops "Frieren S01E07".
 * @param {object[]} rows
 * @param {number | null} wantedSeason
 * @returns {object[]}
 */
function filterBySeason (rows, wantedSeason) {
	if (wantedSeason == null) return rows
	return rows.filter(r => {
		const s = seasonOf(r.title)
		return s == null || s === wantedSeason
	})
}

/**
 * Keep only single-episode rows for the requested episode.
 * Hayase gives both the season episode number and the absolute one,
 * because some groups number by season ("S03E07") and others by absolute ("- 31").
 * @param {object[]} rows
 * @param {number} episode
 * @param {number} [absoluteEpisode]
 * @returns {object[]}
 */
function filterByEpisode (rows, episode, absoluteEpisode) {
	const numbers = [episode]
	if (absoluteEpisode != null && Number(absoluteEpisode) !== Number(episode)) numbers.push(absoluteEpisode)
	return rows.filter(r => !looksLikeBatch(r.title) && numbers.some(n => titleMatchesEpisode(r.title, n)))
}

/**
 * Remove results whose titles contain any exclusion keyword.
 * Respects query.exclusions — e.g. if the device can't play x265,
 * Hayase adds 'x265' to exclusions and we must honour it.
 * @param {object[]} rows
 * @param {string[]} exclusions
 * @returns {object[]}
 */
function applyExclusions (rows, exclusions) {
	if (!exclusions?.length) return rows
	const lower = exclusions.map(e => e.toLowerCase())
	return rows.filter(r => !lower.some(ex => r.title.toLowerCase().includes(ex)))
}

/**
 * The season stated in any of Hayase's titles for this show, if any.
 * @param {string[]} titles
 * @returns {number | null}
 */
function wantedSeasonOf (titles) {
	for (const t of titles || []) {
		const s = t ? seasonOf(t) : null
		if (s != null) return s
	}
	return null
}

// ─── Info hash lookup ────────────────────────────────────────────────────────

/**
 * Open one torrent's detail page and read its info hash.
 * Never throws — returns null if anything goes wrong, so one bad page
 * can't break the whole search.
 * @param {typeof fetch} fetchFn
 * @param {string} domain
 * @param {string} id  — AniRena torrent id
 * @returns {Promise<string | null>}  — 40-character lowercase hash, or null
 */
async function fetchInfoHash (fetchFn, domain, id) {
	const controller = new AbortController()
	const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
	try {
		const res = await fetchFn(`${domain}/torrent/${id}`, { signal: controller.signal, headers: { Accept: 'text/html' } })
		if (!res.ok) throw new Error(`HTTP ${res.status}`)
		const html = await res.text()
		// The hash sits in <code class=td-ov-stat-hash>…</code>.
		// If that label ever changes, fall back to the first 40-character hex string.
		const m = html.match(/td-ov-stat-hash[^>]*>\s*([0-9a-f]{40})\s*</i) ||
			html.match(/(?<![0-9a-f])([0-9a-f]{40})(?![0-9a-f])/i)
		return m ? m[1].toLowerCase() : null
	} catch (err) {
		log.warn('Hash lookup failed', { id, error: err.message })
		return null
	} finally {
		clearTimeout(timer)
	}
}

/**
 * Turn a parsed row into a Hayase TorrentResult.
 *
 * Hash trade-off (only when the detail page could not be read):
 *   We then use the .torrent URL as both `link` and `hash`, exactly like
 *   acgrip.js. Hayase/webtorrent can add a torrent from its URL and reads the
 *   real hash from the file. The cost: that result won't merge with the same
 *   torrent found by another extension (e.g. Nyaa).
 *
 * @param {object} row
 * @param {string | null} hash
 * @param {string} domain
 * @param {'high' | 'medium' | 'low'} accuracy
 * @param {'batch' | undefined} type
 * @returns {object}
 */
function toResult (row, hash, domain, accuracy, type) {
	const torrentUrl = `${domain}/torrents/${row.id}.torrent`
	const link = hash
		? `magnet:?xt=urn:btih:${hash}&dn=${encodeURIComponent(row.title)}` + TRACKERS.map(t => `&tr=${encodeURIComponent(t)}`).join('')
		: torrentUrl
	const result = {
		title:     row.title,
		link,
		hash:      hash || torrentUrl,  // see hash trade-off above
		seeders:   row.seeders  >= 30000 ? 0 : row.seeders,
		leechers:  row.leechers >= 30000 ? 0 : row.leechers,
		downloads: row.downloads,
		size:      row.size,
		date:      row.date,
		accuracy,
	}
	if (type) result.type = type
	return result
}

/**
 * Look up info hashes for the best rows and turn every row into a result.
 * Rows are sorted by seeders first, so the hash lookups go to the rows
 * people are most likely to pick. Rows beyond MAX_HASH_LOOKUPS still appear,
 * just with the .torrent URL fallback.
 * @param {typeof fetch} fetchFn
 * @param {string} domain
 * @param {object[]} rows
 * @param {'high' | 'medium' | 'low'} accuracy
 * @param {'batch' | undefined} type
 * @returns {Promise<object[]>}
 */
async function finishResults (fetchFn, domain, rows, accuracy, type) {
	const sorted = [...rows].sort((a, b) => b.seeders - a.seeders)
	const hashes = await Promise.all(
		sorted.map((row, i) => i < MAX_HASH_LOOKUPS ? fetchInfoHash(fetchFn, domain, row.id) : null)
	)
	log.info('Hash lookups done', { rows: sorted.length, found: hashes.filter(Boolean).length })
	return sorted.map((row, i) => toResult(row, hashes[i], domain, accuracy, type))
}

// ─── Search flow ─────────────────────────────────────────────────────────────

/**
 * Search every term at the same time, apply `keep` (our filters) to each,
 * and merge everything into one list without duplicates.
 *
 * Why every term and not "stop at the first one that works"?
 *   On AniRena, different terms find different uploads. "Sousou no Frieren
 *   2nd Season" finds the Ironclad release of episode 10, but only the shorter
 *   "Sousou no Frieren" also finds the H3LL and Feibanyama releases of it.
 *
 * If only some terms fail to load, we use the ones that worked.
 * If ALL of them fail, we throw the first error so Hayase can show it.
 * @param {object} query    — AnimeQuery from Hayase
 * @param {object} options  — Hayase extension options
 * @param {string[]} terms
 * @param {(rows: object[]) => object[]} keep
 * @returns {Promise<object[]>}
 */
async function searchAll (query, options, terms, keep) {
	const domain = getDomain(options)

	const outcomes = await Promise.allSettled(terms.map(async term => {
		const res  = await fetchWithRetry(query.fetch, buildSearchURL(domain, term, options))
		const html = await res.text()
		const rows = parseSearchPage(html)
		const kept = keep(rows)
		log.info('Term result', { term, raw: rows.length, kept: kept.length })
		return kept
	}))

	const failures = outcomes.filter(o => o.status === 'rejected')
	if (failures.length === outcomes.length) throw failures[0].reason
	failures.forEach(f => log.warn('A search term failed, using the others', { error: f.reason?.message }))

	// Merge, keeping the first copy of each torrent id
	const byId = new Map()
	for (const o of outcomes) {
		if (o.status !== 'fulfilled') continue
		for (const row of o.value) {
			if (!byId.has(row.id)) byId.set(row.id, row)
		}
	}

	const relevant = [...byId.values()].filter(row => matchesAnyTerm(row, terms))
	const merged = applyExclusions(relevant, query.exclusions)
	log.info('searchAll() merged', { terms: terms.length, rows: merged.length })
	return merged
}

// ─── Extension Export ─────────────────────────────────────────────────────────
// Exported as a plain object — no class, no inheritance.
// Hayase loads this directly from the bundled dist/anirena.js file.

export default {

	/**
	 * Health check — Hayase calls this to verify the extension is working.
	 * Must return true if OK, or throw a descriptive error if not.
	 * Uses the small RSS feed instead of the big search page.
	 */
	async test (query) {
		log.info('test() called')
		const fetchFn = query?.fetch ?? fetch
		const controller = new AbortController()
		const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
		try {
			const res = await fetchFn(`${DEFAULT_DOMAIN}/rss`, { signal: controller.signal })
			if (!res.ok) throw new Error(`AniRena returned HTTP ${res.status}. The site may be down or blocked in your region.`)
			log.info('test() passed')
			return true
		} catch (err) {
			if (err.name === 'AbortError') throw new Error(`AniRena did not respond within ${TIMEOUT_MS / 1000}s. Check your network or whether the site is blocked.`)
			if (err.message.startsWith('AniRena')) throw err
			throw new Error(`Could not reach AniRena: ${err.message}`)
		} finally {
			clearTimeout(timer)
		}
	},

	/**
	 * Single episode search.
	 * Searches by title only (AniRena's search breaks if we add the episode
	 * number), then keeps only releases of the requested episode.
	 */
	async single (query, options = {}) {
		log.info('single() called', { titles: query.titles, episode: query.episode, resolution: query.resolution })
		if (!query.titles?.length) return []

		const season = wantedSeasonOf(query.titles)
		const keep = rows => {
			let kept = filterByResolution(rows, query.resolution || '')
			kept = filterBySeason(kept, season)
			return query.episode != null
				? filterByEpisode(kept, query.episode, query.absoluteEpisodeNumber)
				: kept.filter(r => !looksLikeBatch(r.title))
		}

		const rows = await searchAll(query, options, buildTerms(query.titles), keep)
		// "medium": the episode was checked against the title. Never "high" —
		// that is only for ID-based sources. Without an episode, it's a plain keyword hit.
		const accuracy = query.episode != null ? 'medium' : 'low'
		const results = await finishResults(query.fetch, getDomain(options), rows, accuracy, undefined)
		log.info('single() done', { count: results.length })
		return results
	},

	/**
	 * Batch search — season packs only, never single episodes.
	 * AniRena's search needs every word to match, so adding "batch" to the
	 * query would hide packs that don't say "batch". We search the plain
	 * title and keep what looks like a pack.
	 */
	async batch (query, options = {}) {
		log.info('batch() called', { titles: query.titles, episodeCount: query.episodeCount })
		if (!query.titles?.length) return []

		const season = wantedSeasonOf(query.titles)
		const keep = rows => filterBySeason(filterByResolution(rows, query.resolution || ''), season)
			.filter(r => looksLikeBatch(r.title))

		const rows = await searchAll(query, options, buildTerms(query.titles), keep)
		const results = await finishResults(query.fetch, getDomain(options), rows, 'low', 'batch')
		log.info('batch() done', { count: results.length })
		return results
	},

	/**
	 * Movie search — same title search, no episode or batch logic.
	 */
	async movie (query, options = {}) {
		log.info('movie() called', { titles: query.titles, resolution: query.resolution })
		if (!query.titles?.length) return []

		const keep = rows => filterByResolution(rows, query.resolution || '')
		const rows = await searchAll(query, options, buildTerms(query.titles), keep)
		const results = await finishResults(query.fetch, getDomain(options), rows, 'low', undefined)
		log.info('movie() done', { count: results.length })
		return results
	},
}