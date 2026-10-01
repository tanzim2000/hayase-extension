// mikan.js — Mikan Project torrent extension for Hayase
//
// Searches Mikan Project (https://mikanani.me), an anime-only tracker that
// collects Chinese fansub releases, through its RSS search feed:
//   https://mikanani.me/RSS/Search?searchstr=<title>
//
// What one RSS item gives us:
//   <title>      — release name, usually bilingual: "[Group] 中文名 / Romaji - 07 [1080p]"
//   <link>       — https://mikanani.me/Home/Episode/<40-character info hash>
//                  (checked against real .torrent files: it IS the info hash)
//   <enclosure>  — the .torrent download URL
//   <contentLength> — size in bytes
//   <pubDate>    — upload time in China time (UTC+8), written without a timezone
//   No seeders or leechers — Mikan doesn't publish them.
//
// Features:
//   - Episode filtering (only the episode you asked for, never other episodes)
//   - Absolute episode numbers ("2nd Season - 35" = season 2 episode 7)
//   - Correct batch detection, including 全集 / 合集 and "01-10" style packs
//   - Season check, including Chinese/Japanese ("第二季", "第2期")
//   - Searches several title spellings at once; season-free spellings are
//     only used as a fallback (see searchAll() for why)
//   - Resolution filtering ("1080p" and "1920x1080") and exclusion keywords
//   - Retry logic with backoff
//   - Configurable domain via Hayase options
//   - Debug logging (set DEBUG_MODE = true to enable)
//
// Known limitations:
//   - Mikan's search does not understand English titles ("Frieren: Beyond
//     Journey's End Season 2" finds nothing). Romaji and Japanese titles work.
//   - Mikan returns at most 100 items per search, newest first, so episodes of
//     long-running shows that are far back may not be in the list.
//   - Chinese groups often number episodes across seasons and sometimes mark
//     season 2 as "S01 | 29-38", so the season check can't catch everything.

// ─── Debug ────────────────────────────────────────────────────────────────────
// Set to true to enable detailed logging in Hayase's DevTools console (Ctrl+Shift+I)
// Set back to false before publishing
const DEBUG_MODE = false

const log = {
	_fmt (level, msg, data) {
		if (!DEBUG_MODE) return
		const ts = new Date().toISOString()
		const prefix = `[Mikan][${ts}][${level}]`
		const fn = level === 'ERROR' ? 'error' : level === 'WARN' ? 'warn' : 'log'
		data !== undefined ? console[fn](prefix, msg, data) : console[fn](prefix, msg)
	},
	info:  (msg, data) => log._fmt('INFO',  msg, data),
	warn:  (msg, data) => log._fmt('WARN',  msg, data),
	error: (msg, data) => log._fmt('ERROR', msg, data),
	debug: (msg, data) => log._fmt('DEBUG', msg, data),
}
// ─────────────────────────────────────────────────────────────────────────────

// Default value — can be overridden via Hayase extension options
const DEFAULT_DOMAIN = 'https://mikanani.me'

// Fetch timeout in ms
const TIMEOUT_MS = 15000

// Max retries on network failure
const MAX_RETRIES = 2

// Chinese numerals used in season names like "第二季" (season 2)
const CHINESE_NUMBERS = { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10 }

// ─── Small text helpers ──────────────────────────────────────────────────────

/**
 * Turn XML/HTML entities back into normal characters.
 * e.g. "[喵萌奶茶屋&amp;LoliHouse]" => "[喵萌奶茶屋&LoliHouse]"
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
 * @param {string} item
 * @param {string} tag
 * @returns {string}
 */
function pickTag (item, tag) {
	const m = item.match(new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${tag}>`, 'i'))
	return m ? decodeEntities(m[1]) : ''
}

/**
 * Turn a Chinese numeral ("二") or digits ("2") into a number.
 * Handles 1–19 and plain tens ("十" = 10, "十二" = 12). Returns null if unknown.
 * @param {string} text
 * @returns {number | null}
 */
function toNumber (text) {
	if (/^\d+$/.test(text)) return Number(text)
	if (text === '十') return 10
	if (text.length === 2 && text[0] === '十') return 10 + (CHINESE_NUMBERS[text[1]] ?? NaN)
	if (text.length === 1) return CHINESE_NUMBERS[text] ?? null
	return null
}

/**
 * Parse Mikan's pubDate into a Date.
 * Mikan writes China time (UTC+8) with no timezone and up to 6 decimal places
 * of seconds, e.g. "2026-08-12T06:12:15.638227". We keep 3 decimals (milliseconds)
 * and add "+08:00" so the time is read correctly everywhere.
 * @param {string} raw
 * @returns {Date}
 */
function parseMikanDate (raw) {
	const m = raw.match(/^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(\.\d+)?/)
	if (!m) return new Date(0)
	const ms = m[2] ? m[2].slice(0, 4) : ''
	const date = new Date(`${m[1]}${ms}+08:00`)
	return Number.isFinite(date.getTime()) ? date : new Date(0)
}

// ─── Episode, batch and season checks ────────────────────────────────────────
// These follow nyaasi.js / anirena.js, with extra patterns for Chinese titles.

/**
 * Does this torrent title say it is exactly the given episode?
 *
 * Release titles write the episode in many ways, so we check all of these:
 *   "S02E07"        (season + episode)
 *   "E07" / "EP07"  (episode only)
 *   "Episode 7"
 *   "- 07"          (classic fansub style: "Show Name - 07 [1080p]")
 *   "[07]" / "[07 END]" / "【07】"   (Chinese groups love brackets)
 *   "第7话" / "第07集"                (Chinese style)
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
		`【0*${n}(?:v\\d+)?】`,                              // 【07】
		`第0*${n}[话話集]`,                                  // 第7话
	]
	return patterns.some(p => new RegExp(p, 'i').test(title))
}

/**
 * Does this torrent title look like a multi-episode pack (a "batch")?
 *
 * We decide in this order:
 *   1. An episode range like "01-12", "01~12", "第29-38话"  → batch
 *   2. "batch", "complete", 全集 or 合集 (Chinese for "complete set")  → batch
 *   3. Names one episode ("S02E07", "- 07", "[07]", "第7话")  → NOT a batch
 *   4. A season with no episode ("S2", "2nd Season", "第二季") or "Vol.1"  → batch
 *   5. Anything else  → NOT a batch
 * Step 3 comes before step 4 so "第二季 / Show 2nd Season - 07" counts as one episode.
 * @param {string} title
 * @returns {boolean}
 */
function looksLikeBatch (title) {
	// Remove things that look like numbers but aren't episodes: resolutions
	// ("1080p", "1920x1080"), codecs ("x265"), and counters like "100-nin"
	const t = title
		.replace(/\b\d{3,4}[pP]\b/g, ' ')
		.replace(/\b\d{3,4}\s*[xX×]\s*\d{3,4}\b/g, ' ')
		.replace(/\b[xh]\.?26[45]\b/gi, ' ')
		.replace(/\b\d{1,3}-nin\b/gi, ' ')

	// 1. Episode range: "01-12", "01 ~ 12", "S03E01-E12", "第29-38话"
	if (/(?:\b|第)\d{1,3}\s*[-~]\s*E?\d{1,3}\b/i.test(t)) return true

	// 2. Explicit words
	if (/\b(batch|complete)\b|全集|合集/i.test(t)) return true

	// 3. A single-episode marker means this is one episode
	const singleEpisode = [
		/S\d{1,2}E\d{1,4}/i,                         // S02E07
		/(?<![A-Za-z])EP?\s?\d{1,4}\b/i,             // E07, EP07, Ep 7
		/\s[-–]\s\d{1,4}(?:v\d+)?(?=[\s[(.]|$)/,     // " - 07", " - 07v2"
		/\[\d{1,4}(?:v\d+)?(?:\s*END)?\]/i,          // [07], [10 END]
		/【\d{1,4}(?:v\d+)?】/,                       // 【07】
		/第\d+[话話集]/,                              // 第7话
	]
	if (singleEpisode.some(p => p.test(t))) return false

	// 4. A season with no episode, or a volume
	return /\bS\d{1,2}\b|\bSeason\s*\d{1,2}\b|\b\d{1,2}(?:st|nd|rd|th)\s+Season\b|第\s*[\d一二三四五六七八九十]+\s*[季期]|\bvol\.?\s*\d/i.test(t)
}

/**
 * Find a season number written in a title, if there is one.
 *   "Sousou no Frieren 2nd Season"   → 2
 *   "Show S2 - 07" / "Show S02E07"   → 2
 *   "葬送的芙莉莲 第二季"              → 2
 *   "葬送のフリーレン 第2期"           → 2
 *   "Sousou no Frieren"              → null (not stated)
 * @param {string} title
 * @returns {number | null}
 */
function seasonOf (title) {
	const latin = [
		/\bS(\d{1,2})E\d/i,                         // S02E07
		/\bS(\d{1,2})\b/i,                          // S2, S02
		/\b(\d{1,2})(?:st|nd|rd|th)\s+Season\b/i,   // 2nd Season
		/\bSeason\s*(\d{1,2})\b/i,                  // Season 2
	]
	for (const p of latin) {
		const m = title.match(p)
		if (m) return Number(m[1])
	}
	const cjk = title.match(/第\s*([\d一二三四五六七八九十]+)\s*[季期]/)  // 第二季, 第2期
	return cjk ? toNumber(cjk[1]) : null
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
 * Keeps Japanese/Chinese characters, removes characters that confuse the search.
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
 * Build the search terms in two groups:
 *   full     — the titles as Hayase gave them (cleaned)
 *   fallback — the same titles without season wording, only if different
 * e.g. ["Sousou no Frieren 2nd Season", "葬送のフリーレン 第2期"]
 *   → full:     ["Sousou no Frieren 2nd Season", "葬送のフリーレン 第2期"]
 *   → fallback: ["Sousou no Frieren", "葬送のフリーレン"]
 * @param {string[]} titles  — query.titles from Hayase
 * @returns {{ full: string[], fallback: string[] }}
 */
function buildTerms (titles) {
	const seen = new Set()
	const full = []
	const fallback = []
	const add = (list, term) => {
		const key = term.toLowerCase()
		if (term && !seen.has(key)) {
			seen.add(key)
			list.push(term)
		}
	}
	const usable = titles.slice(0, 3).filter(Boolean)
	usable.forEach(t => add(full, cleanTitle(t)))
	usable.forEach(t => add(fallback, cleanTitle(stripSeason(t))))
	return { full, fallback }
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
			const res = await fetchFn(url, {
				signal: controller.signal,
				headers: { Accept: 'application/rss+xml, application/xml, text/xml' },
			})
			clearTimeout(timer)
			if (!res.ok) throw new Error(`Mikan returned HTTP ${res.status}. The site may be down or blocked in your region.`)
			log.info('Fetch OK', { status: res.status, url })
			return res
		} catch (err) {
			clearTimeout(timer)
			log.warn(`Fetch failed (attempt ${attempt + 1})`, { url, error: err.message })
			if (attempt === retries) {
				// Throw user-friendly error on final failure
				if (err.name === 'AbortError') throw new Error(`Mikan request timed out after ${TIMEOUT_MS / 1000}s. The site may be slow or blocked.`)
				if (err.message.startsWith('Mikan')) throw err
				throw new Error(`Could not reach Mikan: ${err.message}`)
			}
			// Backoff: 500ms, 1000ms
			const delay = 500 * (attempt + 1)
			log.debug(`Retrying in ${delay}ms...`)
			await new Promise(r => setTimeout(r, delay))
		}
	}
}

/**
 * Get the domain from options, without a trailing slash.
 * @param {object} options
 * @returns {string}
 */
function getDomain (options = {}) {
	return (options.domain?.trim() || DEFAULT_DOMAIN).replace(/\/+$/, '')
}

/**
 * Build the RSS search URL.
 * e.g. https://mikanani.me/RSS/Search?searchstr=Sousou%20no%20Frieren
 * @param {string} domain
 * @param {string} term
 * @returns {string}
 */
function buildSearchURL (domain, term) {
	return `${domain}/RSS/Search?searchstr=${encodeURIComponent(term)}`
}

// ─── Parsing the RSS feed ────────────────────────────────────────────────────

/**
 * Turn Mikan's RSS XML into a list of plain row objects.
 * Items without an info hash are skipped (Hayase needs one).
 * @param {string} xml
 * @returns {{ hash: string, title: string, torrentUrl: string, size: number, date: Date }[]}
 */
function parseRSS (xml) {
	if (!xml.includes('<rss')) {
		throw new Error('Mikan returned a non-RSS response. The site may have changed or be blocking requests.')
	}

	const rows = []
	const itemRe = /<item>([\s\S]*?)<\/item>/g
	let m
	while ((m = itemRe.exec(xml)) !== null) {
		const item = m[1]

		const title = pickTag(item, 'title')
		if (!title) continue

		// The info hash is the last part of the episode link:
		//   https://mikanani.me/Home/Episode/<40-character hash>
		const hashMatch = pickTag(item, 'link').match(/Episode\/([0-9a-f]{40})/i)
		if (!hashMatch) {
			log.warn('Skipped item (no info hash in link)', { title })
			continue
		}

		const enclosure = item.match(/<enclosure\b[^>]*\burl="([^"]+)"/i)

		rows.push({
			hash:       hashMatch[1].toLowerCase(),
			title,
			torrentUrl: enclosure ? decodeEntities(enclosure[1]) : '',
			size:       Number(pickTag(item, 'contentLength')) || 0,
			date:       parseMikanDate(pickTag(item, 'pubDate')),
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
 * Keep only season packs from the wanted season.
 *
 * Season 2 or later: the pack must SAY it's that season. Mikan's search also
 * returns other seasons of the same show, and Chinese groups rarely write
 * "season 1" — so a pack with no season in its name is most likely season 1.
 * Season 1, or season unknown: packs with no season in the name are kept.
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
 * Hayase gives both the season episode number and the absolute one. Chinese
 * groups often use the absolute one: season 2 episode 7 of Frieren is "- 35".
 *
 * Season check — Mikan's search also returns other seasons of the same show:
 *   - A row that states a different season is dropped.
 *   - Season 2 or later, row states NO season: we only trust it if it matched
 *     the ABSOLUTE number. "Frieren [35]" can only be season 2 (season 1 has 28
 *     episodes), but "100-nin no Kanojo - 09" could be any season's episode 9.
 * @param {object[]} rows
 * @param {number} episode
 * @param {number} [absoluteEpisode]
 * @param {number | null} wantedSeason
 * @returns {object[]}
 */
function filterByEpisode (rows, episode, absoluteEpisode, wantedSeason) {
	const hasAbsolute = absoluteEpisode != null && Number(absoluteEpisode) !== Number(episode)
	return rows.filter(r => {
		if (looksLikeBatch(r.title)) return false
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
 *
 * `link` is the .torrent URL rather than a magnet: Mikan's feed doesn't list
 * trackers, and the .torrent file has the uploader's real trackers in it.
 * `hash` is the real info hash, so Hayase can merge this result with the same
 * torrent found by another extension.
 * Seeders/leechers are 0 because Mikan doesn't publish them.
 * @param {object} row
 * @param {'high' | 'medium' | 'low'} accuracy
 * @param {'batch' | undefined} type
 * @returns {object}
 */
function toResult (row, accuracy, type) {
	const result = {
		title:     row.title,
		link:      row.torrentUrl || `magnet:?xt=urn:btih:${row.hash}&dn=${encodeURIComponent(row.title)}`,
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
 * Fetch and filter one group of search terms at the same time,
 * then merge everything into one list without duplicates (by info hash).
 *
 * If only some terms fail to load, we use the ones that worked.
 * If ALL of them fail, we throw the first error so Hayase can show it.
 * @param {object} query    — AnimeQuery from Hayase
 * @param {string} domain
 * @param {string[]} terms
 * @param {(rows: object[]) => object[]} keep
 * @returns {Promise<object[]>}
 */
async function searchTerms (query, domain, terms, keep) {
	if (!terms.length) return []

	const outcomes = await Promise.allSettled(terms.map(async term => {
		const res  = await fetchWithRetry(query.fetch, buildSearchURL(domain, term))
		const xml  = await res.text()
		const rows = parseRSS(xml)
		const kept = keep(rows)
		log.info('Term result', { term, raw: rows.length, kept: kept.length })
		return kept
	}))

	const failures = outcomes.filter(o => o.status === 'rejected')
	if (failures.length === outcomes.length) throw failures[0].reason
	failures.forEach(f => log.warn('A search term failed, using the others', { error: f.reason?.message }))

	// Merge, keeping the first copy of each info hash
	const byHash = new Map()
	for (const o of outcomes) {
		if (o.status !== 'fulfilled') continue
		for (const row of o.value) {
			if (!byHash.has(row.hash)) byHash.set(row.hash, row)
		}
	}
	return [...byHash.values()]
}

/**
 * Search the full titles first. Only if they find nothing, search the
 * season-free titles.
 *
 * Why not search everything at once like anirena.js does?
 *   On Mikan, "葬送のフリーレン" (no season) returns season 1 AND season 2,
 *   and Chinese releases of season 1 rarely say "season 1". So for a season 2
 *   search, the season-free results would let season 1 episodes slip through.
 *   Searching the full titles first keeps those to a minimum, and the season
 *   checks in filterByEpisode() / filterBatchesBySeason() catch the rest.
 * @param {object} query    — AnimeQuery from Hayase
 * @param {object} options  — Hayase extension options
 * @param {(rows: object[]) => object[]} keep
 * @returns {Promise<object[]>}
 */
async function searchAll (query, options, keep) {
	const domain = getDomain(options)
	const { full, fallback } = buildTerms(query.titles)

	let rows = await searchTerms(query, domain, full, keep)
	if (!rows.length && fallback.length) {
		log.info('Full titles found nothing, trying season-free titles', { fallback })
		rows = await searchTerms(query, domain, fallback, keep)
	}

	const final = applyExclusions(rows, query.exclusions)
	log.info('searchAll() done', { rows: final.length })
	return final
}

// ─── Extension Export ─────────────────────────────────────────────────────────
// Exported as a plain object — no class, no inheritance.
// Hayase loads this directly from the bundled dist/mikan.js file.

export default {

	/**
	 * Health check — Hayase calls this to verify the extension is working.
	 * Must return true if OK, or throw a descriptive error if not.
	 * Uses Mikan's "latest uploads" feed.
	 */
	async test (query) {
		log.info('test() called')
		const fetchFn = query?.fetch ?? fetch
		const controller = new AbortController()
		const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
		try {
			const res = await fetchFn(`${DEFAULT_DOMAIN}/RSS/Classic`, { signal: controller.signal })
			if (!res.ok) throw new Error(`Mikan returned HTTP ${res.status}. The site may be down or blocked in your region.`)
			log.info('test() passed')
			return true
		} catch (err) {
			if (err.name === 'AbortError') throw new Error(`Mikan did not respond within ${TIMEOUT_MS / 1000}s. Check your network or whether the site is blocked.`)
			if (err.message.startsWith('Mikan')) throw err
			throw new Error(`Could not reach Mikan: ${err.message}`)
		} finally {
			clearTimeout(timer)
		}
	},

	/**
	 * Single episode search.
	 * Searches by title only, then keeps only releases of the requested episode
	 * (by season episode number or absolute episode number).
	 */
	async single (query, options = {}) {
		log.info('single() called', { titles: query.titles, episode: query.episode, absolute: query.absoluteEpisodeNumber, resolution: query.resolution })
		if (!query.titles?.length) return []

		const season = wantedSeasonOf(query.titles)
		const keep = rows => {
			const kept = filterByResolution(rows, query.resolution || '')
			return query.episode != null
				? filterByEpisode(kept, query.episode, query.absoluteEpisodeNumber, season)
				: kept.filter(r => !looksLikeBatch(r.title) && seasonMatch(r, season) !== 'no')
		}

		const rows = await searchAll(query, options, keep)
		// "medium": the episode was checked against the title. Never "high" —
		// that is only for ID-based sources. Without an episode, it's a plain keyword hit.
		const accuracy = query.episode != null ? 'medium' : 'low'
		const results = rows.map(row => toResult(row, accuracy, undefined))
		log.info('single() done', { count: results.length })
		return results
	},

	/**
	 * Batch search — season packs only, never single episodes.
	 */
	async batch (query, options = {}) {
		log.info('batch() called', { titles: query.titles, episodeCount: query.episodeCount })
		if (!query.titles?.length) return []

		const season = wantedSeasonOf(query.titles)
		const keep = rows => filterBatchesBySeason(filterByResolution(rows, query.resolution || ''), season)
			.filter(r => looksLikeBatch(r.title))

		const rows = await searchAll(query, options, keep)
		const results = rows.map(row => toResult(row, 'low', 'batch'))
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
		const rows = await searchAll(query, options, keep)
		const results = rows.map(row => toResult(row, 'low', undefined))
		log.info('movie() done', { count: results.length })
		return results
	},
}