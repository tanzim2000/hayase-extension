// tokyotosho.js — Tokyo Toshokan torrent extension for Hayase
//
// Tokyo Toshokan (https://www.tokyotosho.info) is one of the oldest anime
// torrent indexes. Most new releases are re-listed from Nyaa, but it also keeps
// older and odd releases, and a lot of batches. We search its RSS feed:
//   https://www.tokyotosho.info/rss.php?terms=<words>&filter=<categories>
//
// How the search behaves (checked against the live site):
//   - Every word must appear SOMEWHERE in the release — title or description,
//     even inside a CRC like "[35689A56]". So results need checking afterwards.
//   - "filter" picks categories: 1 = Anime, 11 = Batch, 10 = Non-English,
//     7 = Raws, 12 = Hentai (Anime). Several can be joined: "1,11".
//     (The old "type=" parameter is silently ignored by the site.)
//   - At most ~150 items per search, newest first. That's why single() puts the
//     episode number in the search: "One Piece 1000" finds that old episode,
//     plain "One Piece" only finds the newest 150 uploads.
//
// What one RSS item gives us:
//   <title>       — plain text release name (NOT wrapped in CDATA)
//   <category>    — "Anime", "Batch", ...
//   <description> — HTML with the magnet link and "Size: 5.29GB"
//   <pubDate>     — "Tue, 29 Sep 2026 13:32:54 GMT"
//   No seeders or leechers — Hayase fills those in itself (updatePeers).
//
// The magnet's info hash is written in base32 (32 letters/digits, e.g.
// "5UD6APCI..."). Hayase only accepts the 40-character hex form, so we convert.
//
// Features:
//   - Episode filtering (only the episode you asked for, never other episodes)
//   - Absolute episode numbers ("Frieren - 35" = season 2 episode 7)
//   - Correct batch detection, plus the site's own "Batch" category
//   - Season check: a season 2 search never returns season 1 episodes, and a
//     show with no season in its name is treated as season 1
//   - Drops look-alike results that don't contain the show's name
//   - Resolution filtering and exclusion keywords
//   - Retry logic with backoff
//   - Debug logging (set DEBUG_MODE = true to enable)
//
// No "domain" option on purpose: Hayase only allows an extension to fetch from
// the site in its manifest "url" field, so a mirror domain would be blocked.

// ─── Debug ────────────────────────────────────────────────────────────────────
// Set to true to enable detailed logging in Hayase's DevTools console
// Set back to false before publishing
const DEBUG_MODE = false

const log = {
	_fmt (level, msg, data) {
		if (!DEBUG_MODE) return
		const ts = new Date().toISOString()
		const prefix = `[TokyoTosho][${ts}][${level}]`
		const fn = level === 'ERROR' ? 'error' : level === 'WARN' ? 'warn' : 'log'
		data !== undefined ? console[fn](prefix, msg, data) : console[fn](prefix, msg)
	},
	info:  (msg, data) => log._fmt('INFO',  msg, data),
	warn:  (msg, data) => log._fmt('WARN',  msg, data),
	error: (msg, data) => log._fmt('ERROR', msg, data),
	debug: (msg, data) => log._fmt('DEBUG', msg, data),
}
// ─────────────────────────────────────────────────────────────────────────────

// Must stay on the same site as the manifest "url" in index.json (see above)
const BASE_URL = 'https://www.tokyotosho.info'

// Default categories: 1 = Anime, 11 = Batch. Can be changed via Hayase options.
const DEFAULT_CATEGORIES = '1,11'

// The site's "Batch" category number — batch() also searches it on its own
const BATCH_CATEGORY = '11'

// Fetch timeout in ms
const TIMEOUT_MS = 15000

// Max retries on network failure
const MAX_RETRIES = 2

// File types that are never a video (manga scans, archives, books)
const NOT_VIDEO = /\.(zip|rar|7z|cbz|cbr|pdf|epub)$/i

// ─── Small text helpers ──────────────────────────────────────────────────────

/**
 * Turn XML/HTML entities back into normal characters.
 * e.g. "Journey&#039;s End" => "Journey's End"
 * @param {string} text
 * @returns {string}
 */
function decodeEntities (text) {
	return text
		.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
		.replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
		.replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
		.replace(/&quot;/g, '"')
		.replace(/&apos;/g, "'")
		.replace(/&lt;/g, '<')
		.replace(/&gt;/g, '>')
		.replace(/&amp;/g, '&')  // last, so "&amp;lt;" becomes "&lt;" and not "<"
		.trim()
}

/**
 * Get the text inside the first <tag>…</tag> of an RSS item.
 * Works whether or not the text is wrapped in <![CDATA[ ... ]]>.
 * @param {string} item
 * @param {string} tag
 * @returns {string}
 */
function pickTag (item, tag) {
	const m = item.match(new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${tag}>`, 'i'))
	return m ? decodeEntities(m[1]) : ''
}

/**
 * Parse a size string like "5.29GB" or "350.2 MiB" into bytes.
 * @param {string} text
 * @returns {number}
 */
function parseSize (text) {
	const m = text.match(/([\d.]+)\s*(KiB|MiB|GiB|TiB|KB|MB|GB|TB)\b/i)
	if (!m) return 0
	const value = parseFloat(m[1])
	const power = { K: 1, M: 2, G: 3, T: 4 }[m[2][0].toUpperCase()]
	return Math.round(value * 1024 ** power)
}

/**
 * Turn a base32 info hash ("5UD6APCI...", 32 characters) into hex (40 characters).
 *
 * Both are the same 160-bit number, just written differently:
 * base32 uses 5 bits per character, hex uses 4. So we write every base32
 * character out as 5 bits, then read the bits back 4 at a time.
 * @param {string} base32
 * @returns {string | null}  — null if the text isn't valid base32
 */
function base32ToHex (base32) {
	const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'
	let bits = ''
	for (const char of base32.toUpperCase()) {
		const value = ALPHABET.indexOf(char)
		if (value === -1) return null
		bits += value.toString(2).padStart(5, '0')
	}
	let hex = ''
	for (let i = 0; i + 4 <= bits.length; i += 4) {
		hex += parseInt(bits.slice(i, i + 4), 2).toString(16)
	}
	return hex
}

/**
 * Read the info hash out of a magnet link, always as 40-character hex.
 * Handles both forms: hex (40 chars) and base32 (32 chars).
 * @param {string} magnet
 * @returns {string | null}
 */
function hashFromMagnet (magnet) {
	const m = magnet.match(/xt=urn:btih:([a-z0-9]+)/i)
	if (!m) return null
	const raw = m[1]
	if (/^[0-9a-f]{40}$/i.test(raw)) return raw.toLowerCase()
	if (/^[a-z2-7]{32}$/i.test(raw)) return base32ToHex(raw)
	return null
}

/**
 * Get the tracker list (the "tr=" parts) out of a magnet link.
 * @param {string} magnet
 * @returns {string[]}  — tracker URLs, decoded
 */
function trackersFromMagnet (magnet) {
	const query = magnet.split('?')[1] || ''
	return query.split('&')
		.filter(part => part.startsWith('tr='))
		.map(part => {
			try {
				return decodeURIComponent(part.slice(3))
			} catch {
				return part.slice(3)
			}
		})
}

/**
 * Build a magnet link from a hex hash, a name and trackers.
 * @param {string} hash
 * @param {string} title
 * @param {string[]} trackers
 * @returns {string}
 */
function buildMagnet (hash, title, trackers) {
	const tr = trackers.map(t => `&tr=${encodeURIComponent(t)}`).join('')
	return `magnet:?xt=urn:btih:${hash}&dn=${encodeURIComponent(title)}${tr}`
}

// ─── Episode, batch and season checks ────────────────────────────────────────
// Same rules as nyaasi.js / anirena.js / mikan.js.

/**
 * Does this torrent title say it is exactly the given episode?
 *
 * Release titles write the episode in many ways, so we check all of these:
 *   "S02E07"        (season + episode)
 *   "E07" / "EP07"  (episode only)
 *   "Episode 7"
 *   "- 07"          (classic fansub style: "Show Name - 07 [1080p]")
 *   "[07]" / "[07 END]"
 *
 * The (?!\d) at the end of each pattern means "not followed by another digit",
 * so asking for episode 1 will NOT match episode 10 or 1080p.
 * @param {string} title
 * @param {number} episode
 * @returns {boolean}
 */
function titleMatchesEpisode (title, episode) {
	// Strip leading zeros: "07" and 7 both become "7", then we allow any zeros back in
	const n = String(Number(episode))
	const patterns = [
		`S\\d{1,2}E0*${n}(?!\\d)`,                         // S02E07
		`(?<![A-Za-z])[Ee][Pp]?\\s?0*${n}(?!\\d)`,         // E07, EP07, Ep 7
		`Episode\\s*0*${n}(?!\\d)`,                         // Episode 7
		`[-–]\\s*0*${n}(?:v\\d+)?(?!\\d)(?!\\s?[pP]\\b)`,  // - 07, - 07v2 (but not "- 1080p")
		`\\[0*${n}(?:v\\d+)?(?:\\s*END)?\\]`,               // [07], [07v2], [10 END]
	]
	return patterns.some(p => new RegExp(p, 'i').test(title))
}

/**
 * Does this torrent title look like a multi-episode pack (a "batch")?
 *
 * We decide in this order:
 *   1. An episode range like "01-12", "01 ~ 28", "0001-1000"  → batch
 *   2. "batch" or "complete" in the name  → batch
 *   3. Names one episode ("S02E07", "- 07", "[07]")  → NOT a batch
 *   4. A season with no episode ("S2", "2nd Season") or "Vol.1"  → batch
 *   5. Anything else  → NOT a batch
 * Step 3 comes before step 4 so "Show S2 - 07" counts as one episode.
 * @param {string} title
 * @returns {boolean}
 */
function looksLikeBatch (title) {
	// Old releases use "_" or "." instead of spaces ("Cowboy_Bebop_03-05.DVD"),
	// so turn those into spaces first. Then remove things that look like numbers
	// but aren't episodes: resolutions ("1080p", "1920x1080"), codecs ("x265"),
	// and counters like "100-nin"
	const t = title
		.replace(/[_.]/g, ' ')
		.replace(/\b\d{3,4}[pP]\b/g, ' ')
		.replace(/\b\d{3,4}\s*[xX×]\s*\d{3,4}\b/g, ' ')
		.replace(/\b[xh]\.?26[45]\b/gi, ' ')
		.replace(/\b\d{1,3}-nin\b/gi, ' ')

	// 1. Episode range: "01-12", "01 ~ 28", "S03E01-E12", "0001-1000"
	if (/\b\d{1,4}\s*[-~]\s*E?\d{1,4}\b/i.test(t)) return true

	// 2. Explicit words
	if (/\b(batch|complete)\b/i.test(t)) return true

	// 3. A single-episode marker means this is one episode
	const singleEpisode = [
		/S\d{1,2}E\d{1,4}/i,                         // S02E07
		/(?<![A-Za-z])EP?\s?\d{1,4}\b/i,             // E07, EP07, Ep 7
		/\s[-–]\s\d{1,4}(?:v\d+)?(?=[\s[(.]|$)/,     // " - 07", " - 07v2"
		/\[\d{1,4}(?:v\d+)?(?:\s*END)?\]/i,          // [07], [10 END]
	]
	if (singleEpisode.some(p => p.test(t))) return false

	// 4. A season with no episode, or a volume
	return /\bS\d{1,2}\b|\bSeason\s*\d{1,2}\b|\b\d{1,2}(?:st|nd|rd|th)\s+Season\b|\bvol\.?\s*\d/i.test(t)
}

/**
 * Find a season number written in a title, if there is one.
 *   "Sousou no Frieren 2nd Season"   → 2
 *   "Show S2 - 07" / "Show S02E07"   → 2
 *   "葬送のフリーレン 第2期"           → 2
 *   "Sousou no Frieren"              → null (not stated)
 * @param {string} title
 * @returns {number | null}
 */
function seasonOf (title) {
	const patterns = [
		/\bS(\d{1,2})E\d/i,                         // S02E07
		/\bS(\d{1,2})\b/i,                          // S2, S02
		/\b(\d{1,2})(?:st|nd|rd|th)\s+Season\b/i,   // 2nd Season
		/\bSeason\s*(\d{1,2})\b/i,                  // Season 2
		/第\s*(\d{1,2})\s*[季期]/,                   // 第2期
	]
	for (const p of patterns) {
		const m = title.match(p)
		if (m) return Number(m[1])
	}
	return null
}

/**
 * Remove season wording from a title.
 *   "Sousou no Frieren 2nd Season" → "Sousou no Frieren"
 *   "葬送のフリーレン 第2期"         → "葬送のフリーレン"
 * @param {string} title
 * @returns {string}
 */
function stripSeason (title) {
	return title
		.replace(/\b\d{1,2}(?:st|nd|rd|th)\s+Season\b/gi, ' ')
		.replace(/\bSeason\s*\d{1,2}\b/gi, ' ')
		.replace(/\bPart\s*\d{1,2}\b/gi, ' ')
		.replace(/\bS\d{1,2}\b/g, ' ')
		.replace(/第\s*[\d一二三四五六七八九十]+\s*[季期]/g, ' ')
		.replace(/\s+/g, ' ')
		.trim()
}

/**
 * Clean a title for use as a search query.
 * Keeps Japanese characters, removes characters that confuse the search.
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

/**
 * The season to check releases against.
 *
 * If Hayase's titles state a season, that's it. If they don't, the show is
 * almost always season 1 (later seasons usually have "Season 2" or "2nd Season"
 * in their name) — so we use 1, and "Show S2 - 07" is not offered for season 1.
 *
 * Exception: if Hayase's absolute episode number differs from the episode
 * number, this is NOT the first season even though the name doesn't say so
 * (e.g. a sequel with its own subtitle). Then we can't tell, so null.
 * @param {string[]} titles
 * @param {number} [episode]
 * @param {number} [absoluteEpisode]
 * @returns {number | null}
 */
function seasonToCheck (titles, episode, absoluteEpisode) {
	const stated = wantedSeasonOf(titles)
	if (stated != null) return stated
	const laterSeason = episode != null && absoluteEpisode != null && Number(absoluteEpisode) !== Number(episode)
	return laterSeason ? null : 1
}

/**
 * The show's names without season wording, cleaned and without duplicates.
 * These are what we search for — a season-free name also finds releases
 * that write the season differently ("S2" vs "2nd Season"), and the season
 * check later throws out the wrong seasons.
 * @param {string[]} titles  — query.titles from Hayase
 * @returns {string[]}
 */
function baseTitles (titles) {
	const seen = new Set()
	const out = []
	for (const t of (titles || []).slice(0, 3)) {
		if (!t) continue
		const base = cleanTitle(stripSeason(t)) || cleanTitle(t)
		const key = base.toLowerCase()
		if (base && !seen.has(key)) {
			seen.add(key)
			out.push(base)
		}
	}
	return out
}

/**
 * Lowercase, drop apostrophes, and turn every other symbol into a space.
 *   "Frieren: Beyond Journey's End" → "frieren beyond journeys end"
 * @param {string} text
 * @returns {string}
 */
function normalize (text) {
	return text
		.toLowerCase()
		.replace(/['’]/g, '')
		.replace(/[^\p{L}\p{N}]+/gu, ' ')
		.trim()
}

/**
 * Does the release title contain every word of at least one of the show's names?
 *
 * Tokyo Toshokan also matches words in the DESCRIPTION, so a search for
 * "Sousou no Frieren 35" can return a manga archive that merely mentions it.
 * This drops anything whose own title doesn't name the show.
 * Words written in Japanese/Chinese have no spaces, so for those we only
 * check that the text appears somewhere.
 * @param {string} title
 * @param {string[]} names  — from baseTitles()
 * @returns {boolean}
 */
function titleNamesShow (title, names) {
	const padded = ` ${normalize(title)} `
	return names.some(name => {
		const words = normalize(name).split(' ').filter(Boolean)
		if (!words.length) return false
		return words.every(w => /^[a-z0-9]+$/.test(w) ? padded.includes(` ${w} `) : padded.includes(w))
	})
}

// ─── Network ─────────────────────────────────────────────────────────────────

/**
 * Fetch a URL with timeout and retry logic.
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
			const res = await fetchFn(url, { signal: controller.signal })
			clearTimeout(timer)
			if (!res.ok) throw new Error(`Tokyo Toshokan returned HTTP ${res.status}. The site may be down or blocked.`)
			log.info('Fetch OK', { status: res.status, url })
			return res
		} catch (err) {
			clearTimeout(timer)
			log.warn(`Fetch failed (attempt ${attempt + 1})`, { url, error: err.message })
			if (attempt === retries) {
				// Throw user-friendly error on final failure
				if (err.name === 'AbortError') throw new Error(`Tokyo Toshokan did not respond within ${TIMEOUT_MS / 1000}s. The site may be slow or blocked.`)
				if (err.message.startsWith('Tokyo Toshokan')) throw err
				throw new Error(`Could not reach Tokyo Toshokan: ${err.message}`)
			}
			// Backoff: 500ms, 1000ms
			await new Promise(r => setTimeout(r, 500 * (attempt + 1)))
		}
	}
}

/**
 * Get the category list from options, e.g. "1,11".
 * Only digits and commas are kept, so a typo can't break the URL.
 * @param {object} options
 * @returns {string}
 */
function getCategories (options = {}) {
	const cleaned = String(options.categories ?? '').replace(/[^\d,]/g, '').replace(/^,+|,+$/g, '')
	return cleaned || DEFAULT_CATEGORIES
}

/**
 * Build the RSS search URL.
 * e.g. https://www.tokyotosho.info/rss.php?terms=Sousou+no+Frieren+07&filter=1%2C11
 * @param {string} terms
 * @param {string} categories
 * @returns {string}
 */
function buildSearchURL (terms, categories) {
	const params = new URLSearchParams({ terms, filter: categories })
	return `${BASE_URL}/rss.php?${params.toString()}`
}

// ─── Parsing the RSS feed ────────────────────────────────────────────────────

/**
 * Turn Tokyo Toshokan's RSS XML into a list of plain row objects.
 * Items without a usable info hash, and non-video files, are skipped.
 * @param {string} xml
 * @returns {{ hash: string, title: string, trackers: string[], size: number, date: Date, category: string }[]}
 */
function parseRSS (xml) {
	if (!xml.includes('<rss') && !xml.includes('<channel')) {
		throw new Error('Tokyo Toshokan returned a non-RSS response. The site may have changed or be blocking requests.')
	}

	const rows = []
	const itemRe = /<item>([\s\S]*?)<\/item>/g
	let m
	while ((m = itemRe.exec(xml)) !== null) {
		const item = m[1]

		const title = pickTag(item, 'title')
		if (!title) continue
		if (NOT_VIDEO.test(title)) {
			log.debug('Skipped (not a video)', { title })
			continue
		}

		// The description is HTML with the magnet link inside an <a href="...">
		const description = pickTag(item, 'description')
		const magnetMatch = description.match(/magnet:\?[^"'<\s]+/i)
		const magnet = magnetMatch ? decodeEntities(magnetMatch[0]) : ''
		const hash = magnet ? hashFromMagnet(magnet) : null
		if (!hash) {
			log.debug('Skipped (no usable info hash)', { title })
			continue
		}

		const date = new Date(pickTag(item, 'pubDate'))

		rows.push({
			hash,
			title,
			trackers: trackersFromMagnet(magnet),
			size:     parseSize(description),
			date:     Number.isFinite(date.getTime()) ? date : new Date(0),
			category: pickTag(item, 'category'),
		})
	}

	log.info('parseRSS complete', { rows: rows.length })
	return rows
}

// ─── Filters ─────────────────────────────────────────────────────────────────

/**
 * Find the resolution a title states, if any.
 * Understands "1080p", "1080P" and "1920x1080".
 * @param {string} title
 * @returns {string | null}  — e.g. '1080', or null if not stated
 */
function resolutionOf (title) {
	const m = title.match(/\b(2160|1080|720|540|480)[pP]\b/) ||
		title.match(/\b\d{3,4}\s*[xX×]\s*(2160|1080|720|540|480)\b/)
	return m ? m[1] : null
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
		const found = resolutionOf(r.title)
		return !found || found === String(resolution)
	})
}

/**
 * Is this row from the wanted season?
 *   'yes'     — the title states the wanted season
 *   'no'      — the title states a DIFFERENT season
 *   'unknown' — the title states no season at all
 * If we don't know the wanted season, every row counts as 'yes'.
 * @param {object} row
 * @param {number | null} wantedSeason
 * @returns {'yes' | 'no' | 'unknown'}
 */
function seasonMatch (row, wantedSeason) {
	if (wantedSeason == null) return 'yes'
	const s = seasonOf(row.title)
	if (s == null) return 'unknown'
	return s === wantedSeason ? 'yes' : 'no'
}

/**
 * Is this row a multi-episode pack?
 * Either the title says so, or the uploader put it in the "Batch" category —
 * unless the title clearly names one episode.
 * @param {object} row
 * @returns {boolean}
 */
function isBatch (row) {
	if (looksLikeBatch(row.title)) return true
	if (row.category.toLowerCase() !== 'batch') return false
	// "Batch" category but the title names one episode? Trust the title.
	return !/S\d{1,2}E\d{1,4}|\s[-–]\s\d{1,4}(?:v\d+)?(?=[\s[(.]|$)/i.test(row.title)
}

/**
 * Keep only season packs from the wanted season.
 * Season 2 or later: the pack must SAY it's that season — the search also
 * returns season 1 packs, which usually don't say "season 1".
 * @param {object[]} rows
 * @param {number | null} wantedSeason
 * @returns {object[]}
 */
function filterBatchesBySeason (rows, wantedSeason) {
	return rows.filter(r => {
		const match = seasonMatch(r, wantedSeason)
		if (match === 'no') return false
		if (match === 'unknown') return !(wantedSeason > 1)
		return true
	})
}

/**
 * Keep only single-episode rows for the requested episode.
 *
 * Hayase gives both the season episode number and the absolute one
 * (season 2 episode 7 of Frieren is episode 35 overall). Some groups use the
 * absolute number: "[9volt] Sousou no Frieren - 38 (S02E10)".
 *
 * Season check — we search season-free names, so other seasons come back too:
 *   - A row that states a different season is dropped.
 *   - Season 2 or later, row states NO season: only trusted if it matched the
 *     ABSOLUTE number. "Sousou no Frieren - 07" is season 1 episode 7.
 * @param {object[]} rows
 * @param {number} episode
 * @param {number} [absoluteEpisode]
 * @param {number | null} wantedSeason
 * @returns {object[]}
 */
function filterByEpisode (rows, episode, absoluteEpisode, wantedSeason) {
	const hasAbsolute = absoluteEpisode != null && Number(absoluteEpisode) !== Number(episode)
	return rows.filter(r => {
		if (isBatch(r)) return false
		const match = seasonMatch(r, wantedSeason)
		if (match === 'no') return false
		const byEpisode  = titleMatchesEpisode(r.title, episode)
		const byAbsolute = hasAbsolute && titleMatchesEpisode(r.title, absoluteEpisode)
		if (match === 'unknown' && wantedSeason > 1) return byAbsolute
		return byEpisode || byAbsolute
	})
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

// ─── Building results ────────────────────────────────────────────────────────

/**
 * Turn a parsed row into a Hayase TorrentResult.
 * Seeders/leechers are 0 because Tokyo Toshokan doesn't publish them —
 * Hayase looks them up itself because the manifest has "updatePeers": true.
 * @param {object} row
 * @param {'high' | 'medium' | 'low'} accuracy
 * @param {'batch' | undefined} type
 * @returns {object}
 */
function toResult (row, accuracy, type) {
	const result = {
		title:     row.title,
		link:      buildMagnet(row.hash, row.title, row.trackers),
		hash:      row.hash,
		seeders:   0,
		leechers:  0,
		downloads: 0,
		size:      row.size,
		date:      row.date,
		accuracy,
	}
	if (type) result.type = type
	return result
}

// ─── Search flow ─────────────────────────────────────────────────────────────

/**
 * Run several searches at the same time, keep the rows that pass `keep`,
 * and merge everything into one list without duplicates (by info hash).
 *
 * If only some searches fail, we use the ones that worked.
 * If ALL of them fail, we throw the first error so Hayase can show it.
 * @param {object} query  — AnimeQuery from Hayase
 * @param {{ terms: string, categories: string }[]} searches
 * @param {(rows: object[]) => object[]} keep
 * @returns {Promise<object[]>}
 */
async function searchAll (query, searches, keep) {
	if (!searches.length) return []

	const outcomes = await Promise.allSettled(searches.map(async ({ terms, categories }) => {
		const res  = await fetchWithRetry(query.fetch, buildSearchURL(terms, categories))
		const rows = parseRSS(await res.text())
		const kept = keep(rows)
		log.info('Search result', { terms, categories, raw: rows.length, kept: kept.length })
		return kept
	}))

	const failures = outcomes.filter(o => o.status === 'rejected')
	if (failures.length === outcomes.length) throw failures[0].reason
	failures.forEach(f => log.warn('A search failed, using the others', { error: f.reason?.message }))

	// Merge, keeping the first copy of each info hash
	const byHash = new Map()
	for (const o of outcomes) {
		if (o.status !== 'fulfilled') continue
		for (const row of o.value) {
			if (!byHash.has(row.hash)) byHash.set(row.hash, row)
		}
	}
	return applyExclusions([...byHash.values()], query.exclusions)
}

/**
 * Zero-pad an episode number the way release names write it: 7 → "07".
 * @param {number} n
 * @returns {string}
 */
function pad (n) {
	return String(Number(n)).padStart(2, '0')
}

// ─── Extension Export ─────────────────────────────────────────────────────────
// Exported as a plain object — no class, no inheritance.
// Hayase loads this directly from the bundled dist/tokyotosho.js file.

export default {

	/**
	 * Health check — Hayase calls this to verify the extension is working.
	 * Must return true if OK, or throw a descriptive error if not.
	 */
	async test (query) {
		log.info('test() called')
		const fetchFn = query?.fetch ?? fetch
		const controller = new AbortController()
		const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
		try {
			const res = await fetchFn(`${BASE_URL}/rss.php`, { signal: controller.signal })
			if (!res.ok) throw new Error(`Tokyo Toshokan returned HTTP ${res.status}. The site may be down.`)
			log.info('test() passed')
			return true
		} catch (err) {
			if (err.name === 'AbortError') throw new Error(`Tokyo Toshokan did not respond within ${TIMEOUT_MS / 1000}s. Check your network.`)
			if (err.message.startsWith('Tokyo Toshokan')) throw err
			throw new Error(`Could not reach Tokyo Toshokan: ${err.message}`)
		} finally {
			clearTimeout(timer)
		}
	},

	/**
	 * Single episode search.
	 * Searches "<name> <episode>" (and "<name> <absolute episode>" when that's
	 * different), then keeps only releases of the requested episode.
	 */
	async single (query, options = {}) {
		log.info('single() called', { titles: query.titles, episode: query.episode, absolute: query.absoluteEpisodeNumber, resolution: query.resolution })
		if (!query.titles?.length) return []

		const names = baseTitles(query.titles)
		const season = seasonToCheck(query.titles, query.episode, query.absoluteEpisodeNumber)
		const categories = getCategories(options)

		// Which numbers to put in the search
		const numbers = []
		if (query.episode != null) {
			numbers.push(pad(query.episode))
			const abs = query.absoluteEpisodeNumber
			if (abs != null && Number(abs) !== Number(query.episode)) numbers.push(pad(abs))
		}
		const searches = numbers.length
			? names.flatMap(name => numbers.map(n => ({ terms: `${name} ${n}`, categories })))
			: names.map(name => ({ terms: name, categories }))

		const keep = rows => {
			const kept = filterByResolution(rows, query.resolution || '').filter(r => titleNamesShow(r.title, names))
			return query.episode != null
				? filterByEpisode(kept, query.episode, query.absoluteEpisodeNumber, season)
				: kept.filter(r => !isBatch(r) && seasonMatch(r, season) !== 'no')
		}

		const rows = await searchAll(query, searches, keep)
		// "medium": the episode was checked against the title. Never "high" —
		// that is only for ID-based sources. Without an episode, it's a plain keyword hit.
		const accuracy = query.episode != null ? 'medium' : 'low'
		const results = rows.map(row => toResult(row, accuracy, undefined))
		log.info('single() done', { count: results.length })
		return results
	},

	/**
	 * Batch search — season packs only, never single episodes.
	 * Searches the show's names in the chosen categories, and again in the
	 * "Batch" category alone so older packs aren't pushed out of the
	 * 150-item limit by newer single episodes.
	 */
	async batch (query, options = {}) {
		log.info('batch() called', { titles: query.titles, episodeCount: query.episodeCount })
		if (!query.titles?.length) return []

		const names = baseTitles(query.titles)
		const season = seasonToCheck(query.titles)
		const categories = getCategories(options)

		const searches = names.map(name => ({ terms: name, categories }))
		if (categories.split(',').includes(BATCH_CATEGORY) && categories !== BATCH_CATEGORY) {
			names.forEach(name => searches.push({ terms: name, categories: BATCH_CATEGORY }))
		}

		const keep = rows => filterBatchesBySeason(filterByResolution(rows, query.resolution || ''), season)
			.filter(r => titleNamesShow(r.title, names) && isBatch(r))

		const rows = await searchAll(query, searches, keep)
		const results = rows.map(row => toResult(row, 'low', 'batch'))
		log.info('batch() done', { count: results.length })
		return results
	},

	/**
	 * Movie search — searches the full titles, no episode or batch logic.
	 */
	async movie (query, options = {}) {
		log.info('movie() called', { titles: query.titles, resolution: query.resolution })
		if (!query.titles?.length) return []

		const names = [...new Set(query.titles.slice(0, 3).filter(Boolean).map(cleanTitle))]
		const categories = getCategories(options)
		const searches = names.map(name => ({ terms: name, categories }))

		const keep = rows => filterByResolution(rows, query.resolution || '').filter(r => titleNamesShow(r.title, names))
		const rows = await searchAll(query, searches, keep)
		const results = rows.map(row => toResult(row, 'low', undefined))
		log.info('movie() done', { count: results.length })
		return results
	},
}