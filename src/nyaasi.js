// nyaasi.js — Nyaa.si torrent extension for Hayase
//
// Searches Nyaa.si directly via its RSS feed.
// No third-party proxies — talks to nyaa.si directly.
//
// Features:
//   - Direct RSS feed parsing (no proxy dependency)
//   - Resolution filtering
//   - Episode number filtering (only returns torrents for the episode you asked for)
//   - Correct batch detection (a single "S03E11" release is NOT a batch)
//   - Title fallback chain (tries multiple title variants)
//   - Retry logic with exponential backoff
//   - Exclusion keyword filtering
//   - Configurable domain, category, filter, keyword via Hayase options
//   - keyword option: appended to every query — use "Dubbed" for dub entries,
//     "Arabic" / "Hindi" / "Bangla" etc. for non-English entries, "" for subs
//   - Debug logging (set DEBUG_MODE = true to enable)
//
// CHANGELOG (this version):
//   FIX 1: Episode number was only used to label results "high" or "medium"
//          accuracy, never to remove wrong episodes. So asking for episode 1, 7
//          or 9 always showed the same list. Now results that are not the
//          requested episode are dropped.
//   FIX 2: The batch check treated "S03E11" and "3rd Season" as batches, so every
//          single episode showed a "Batch" tag. Now only real packs are tagged.

// ─── Debug ────────────────────────────────────────────────────────────────────
// Set to true to enable detailed logging in Hayase's DevTools console (Ctrl+Shift+I)
// Set back to false before publishing
const DEBUG_MODE = false

const log = {
	_fmt (level, msg, data) {
		if (!DEBUG_MODE) return
		const ts = new Date().toISOString()
		const prefix = `[NyaaSi][${ts}][${level}]`
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
const DEFAULT_DOMAIN   = 'https://nyaa.si'
const DEFAULT_CATEGORY = '1_2'  // Anime - English translated
const DEFAULT_FILTER   = '0'    // No filter (0 = all, 1 = no remakes, 2 = trusted only)
const DEFAULT_KEYWORD  = ''     // No keyword suffix by default (set to "Dubbed", "Arabic", etc. via options)

// Fetch timeout in ms
const TIMEOUT_MS = 15000

// Max retries on network failure
const MAX_RETRIES = 2

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Parse a Nyaa size string like "1.5 GiB" into bytes.
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
 * Extract a <nyaa:tag> value from an RSS item string.
 * e.g. getNyaaTag(item, 'seeders') => '42'
 * @param {string} item
 * @param {string} tag
 * @returns {string}
 */
function getNyaaTag (item, tag) {
	const match = item.match(new RegExp(`<nyaa:${tag}>([^<]*)<\\/nyaa:${tag}>`))
	return match ? match[1].trim() : ''
}

/**
 * Extract a plain RSS tag value, handles CDATA wrappers.
 * @param {string} item
 * @param {string} tag
 * @returns {string}
 */
function getTag (item, tag) {
	const match = item.match(new RegExp(`<${tag}>(?:<!\\[CDATA\\[)?([\\s\\S]*?)(?:\\]\\]>)?<\\/${tag}>`))
	return match ? match[1].trim() : ''
}

/**
 * Fetch with timeout and retry logic.
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
				headers: { Accept: 'application/rss+xml, application/xml, text/xml' }
			})
			clearTimeout(timer)
			if (!res.ok) throw new Error(`Nyaa returned HTTP ${res.status}. The site may be down or blocked in your region.`)
			log.info('Fetch OK', { status: res.status, url })
			return res
		} catch (err) {
			clearTimeout(timer)
			log.warn(`Fetch failed (attempt ${attempt + 1})`, { url, error: err.message })
			if (attempt === retries) {
				// Throw user-friendly error on final failure
				if (err.name === 'AbortError') throw new Error(`Nyaa request timed out after ${TIMEOUT_MS / 1000}s. The site may be slow or blocked.`)
				throw new Error(`Could not reach Nyaa: ${err.message}`)
			}
			// Exponential backoff: 500ms, 1000ms
			const delay = 500 * (attempt + 1)
			log.debug(`Retrying in ${delay}ms...`)
			await new Promise(r => setTimeout(r, delay))
		}
	}
}

/**
 * Does this torrent title say it is exactly the given episode?
 *
 * Real Nyaa titles write the episode in many ways, so we check all of these:
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
		`第0*${n}[话話集]`,                // 第7话
	]
	return patterns.some(p => new RegExp(p, 'i').test(title))
}

/**
 * Does this torrent title look like a multi-episode pack (a "batch")?
 *
 * IMPORTANT: this used to also match "S03E11" and the word "season", which is
 * why every single episode was showing a Batch tag. We now decide in this order:
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
	// Remove resolutions ("1080p") and codec-style numbers ("x265", "AAC2.0") first,
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
		/S\d{1,2}E\d{1,4}/i,                           // S03E11
		/(?<![A-Za-z])EP?\s?\d{1,4}\b/i,               // E11, EP11, Ep 11
		/\s[-–]\s\d{1,4}(?:v\d+)?(?=[\s[(.]|$)/,  // " - 09", " - 01v2"
		/\[\d{1,4}(?:v\d+)?\]/,                         // [09]
		/第\d+[话話集]/,               // 第9话
	]
	if (singleEpisode.some(p => p.test(t))) return false

	// 4. Bare season tag ("S03", "Season 3", "3rd Season") or volume, with no episode
	return /\bS\d{1,2}\b|\bSeason\s*\d{1,2}\b|\b\d{1,2}(?:st|nd|rd|th)\s+Season\b|\bvol\.?\s*\d/i.test(t)
}

/**
 * Clean a title for use as a Nyaa search query.
 * Preserves Japanese/Unicode characters — Nyaa indexes them.
 * Strips characters that break URL encoding, plus commas
 * (release titles on Nyaa are written without them, e.g. "Really Really Really").
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
 * Append the keyword suffix to a query string if one is configured.
 * e.g. "Frieren - 01" + "Dubbed" => "Frieren - 01 Dubbed"
 *      "Frieren - 01" + ""       => "Frieren - 01"
 * @param {string} query
 * @param {string} keyword
 * @returns {string}
 */
function applyKeyword (query, keyword) {
	const kw = keyword?.trim()
	return kw ? `${query} ${kw}` : query
}

/**
 * Build a Nyaa RSS URL with the given query and options.
 * @param {string} query
 * @param {object} options  — Hayase extension options
 * @returns {string}
 */
function buildURL (query, options = {}) {
	const domain   = (options.domain?.trim()   || DEFAULT_DOMAIN).replace(/\/+$/, '')
	const category = options.category?.trim()  || DEFAULT_CATEGORY
	const filter   = options.filter?.trim()    || DEFAULT_FILTER
	const params   = new URLSearchParams({ page: 'rss', q: query, c: category, f: filter, s: 'seeders', o: 'desc' })
	return `${domain}/?${params.toString()}`
}

/**
 * Parse raw RSS XML into TorrentResult objects.
 * @param {string} xml
 * @param {{ resolution: string, isBatch: boolean, episode?: number }} opts
 * @returns {object[]}
 */
function parseRSS (xml, { resolution, isBatch, episode }) {
	if (!xml.includes('<rss')) throw new Error('Nyaa returned a non-RSS response. The site may have changed or be blocking requests.')

	const results = []
	const itemRegex = /<item>([\s\S]*?)<\/item>/g
	let match
	let skippedCategory = 0
	let skippedResolution = 0
	let skippedNoHash = 0

	while ((match = itemRegex.exec(xml)) !== null) {
		const item = match[1]

		const title = getTag(item, 'title')
		if (!title) continue

		// Only keep anime categories (1_2 English, 1_3 Non-English, 1_4 Raw)
		const categoryId = getNyaaTag(item, 'categoryId')
		if (categoryId && !categoryId.startsWith('1_')) {
			skippedCategory++
			log.debug(`Skipped (category ${categoryId})`, { title })
			continue
		}

		// Resolution filtering — skip if user wants a specific res and title doesn't have it
		if (resolution && !title.toLowerCase().includes(resolution)) {
			skippedResolution++
			log.debug(`Skipped (resolution mismatch, want ${resolution})`, { title })
			continue
		}

		const infoHash = getNyaaTag(item, 'infoHash').toLowerCase()
		if (!infoHash) {
			skippedNoHash++
			log.warn('Skipped (no infoHash)', { title })
			continue
		}

		// Build magnet link with standard Nyaa trackers
		const magnet = `magnet:?xt=urn:btih:${infoHash}&dn=${encodeURIComponent(title)}` +
			`&tr=http%3A%2F%2Fnyaa.tracker.wf%3A7777%2Fannounce` +
			`&tr=udp%3A%2F%2Fopen.stealth.si%3A80%2Fannounce` +
			`&tr=udp%3A%2F%2Ftracker.opentrackr.org%3A1337%2Fannounce` +
			`&tr=udp%3A%2F%2Fexodus.desync.com%3A6969%2Fannounce` +
			`&tr=udp%3A%2F%2Ftracker.torrent.eu.org%3A451%2Fannounce`

		const seeders   = parseInt(getNyaaTag(item, 'seeders')  || '0', 10)
		const leechers  = parseInt(getNyaaTag(item, 'leechers') || '0', 10)
		const downloads = parseInt(getNyaaTag(item, 'downloads')|| '0', 10)
		const size      = parseSize(getNyaaTag(item, 'size'))

		// Parse RFC 2822 date from pubDate
		const pubDateStr = getTag(item, 'pubDate')
		const date = pubDateStr ? new Date(pubDateStr) : new Date(0)

		// Tag real packs as "batch". Single-episode searches never tag anything,
		// because filterByEpisode() below has already removed the packs.
		const type = looksLikeBatch(title) ? 'batch' : undefined

		// Nyaa is a keyword search, not an ID lookup, so a raw hit is "low".
		// Hayase's rule: "high" is only for ID-based matching (AniList/AniDB).
		// filterByEpisode() upgrades a result to "medium" once its title has been
		// checked against the requested episode.
		const accuracy = 'low'

		log.debug('Parsed result', { title, accuracy, type, seeders, leechers, size })

		results.push({
			title,
			link:     magnet,
			hash:     infoHash,
			seeders:  seeders  >= 30000 ? 0 : seeders,   // Nyaa uses 99999 as "unknown"
			leechers: leechers >= 30000 ? 0 : leechers,
			downloads,
			size,
			date,
			accuracy,
			type,
		})
	}

	log.info('parseRSS complete', { total: results.length, skippedCategory, skippedResolution, skippedNoHash })
	return results
}

/**
 * Keep only results for the requested episode.
 * This is the fix for "every episode shows the same torrents".
 * @param {object[]} results
 * @param {number} episode
 * @returns {object[]}
 */
function filterByEpisode (results, episode, absoluteEpisode) {
	// Hayase gives both the season episode number and the absolute one.
	// Some groups number by season ("S03E07"), others by absolute ("- 31").
	const numbers = [episode]
	if (absoluteEpisode != null && Number(absoluteEpisode) !== Number(episode)) numbers.push(absoluteEpisode)

	const kept = results
		.filter(r => r.type !== 'batch' && numbers.some(n => titleMatchesEpisode(r.title, n)))
		.map(r => ({ ...r, accuracy: 'medium' }))   // title checked against the episode
	log.debug('filterByEpisode', { numbers, before: results.length, after: kept.length })
	return kept
}

/**
 * Keep only results that are real packs (used by batch search).
 * @param {object[]} results
 * @returns {object[]}
 */
function filterByBatch (results) {
	const kept = results.filter(r => r.type === 'batch')
	log.debug('filterByBatch', { before: results.length, after: kept.length })
	return kept
}

/**
 * Try a list of queries in order, return results from the first one that still
 * has something left AFTER the filter runs.
 *
 * (Before, we returned as soon as Nyaa sent back *anything*. That is why a
 * query that matched the wrong episodes stopped the search early.)
 *
 * Tries each query across multiple categories before moving to the next query.
 * @param {typeof fetch} fetchFn
 * @param {string[]} queries
 * @param {object} parseOpts
 * @param {object} options  — Hayase extension options
 * @param {(results: object[]) => object[]} [keep]  — filter applied to each page of results
 * @returns {Promise<object[]>}
 */
async function fetchFirstResults (fetchFn, queries, parseOpts, options, keep = r => r) {
	log.info('fetchFirstResults start', { queries, parseOpts })

	// Try the configured category first, then non-English as fallback.
	// For keyword-based entries (dub, non-English), the fallback is skipped
	// since mixing categories would pollute results with unrelated content.
	const keyword = options.keyword?.trim() || DEFAULT_KEYWORD
	const primaryCategory = options.category || DEFAULT_CATEGORY
	const categories = keyword
		? [primaryCategory]                  // keyword entries: stick to one category
		: [primaryCategory, '1_3']           // sub entry: fall back to non-English

	for (const query of queries) {
		for (const cat of categories) {
			try {
				const optWithCat = { ...options, category: cat }
				const url = buildURL(cleanTitle(query), optWithCat)
				log.info('Trying query', { query, category: cat, url })
				const res = await fetchWithRetry(fetchFn, url)
				const xml = await res.text()
				const parsed = parseRSS(xml, parseOpts)
				const results = keep(parsed)
				if (results.length > 0) {
					log.info('Query succeeded', { query, category: cat, resultCount: results.length })
					return results
				}
				log.info('Query had no usable results, trying next', { query, category: cat, rawCount: parsed.length })
			} catch (err) {
				log.error('Query threw error', { query, error: err.message })
				throw err // Re-throw so Hayase can show the user-friendly message
			}
		}
	}

	log.warn('All queries exhausted, returning empty')
	return []
}

/**
 * Filter out results whose titles contain any exclusion keyword.
 * @param {object[]} results
 * @param {string[]} exclusions
 * @returns {object[]}
 */
function applyExclusions (results, exclusions) {
	if (!exclusions?.length) return results
	const lower = exclusions.map(e => e.toLowerCase())
	const filtered = results.filter(r => !lower.some(ex => r.title.toLowerCase().includes(ex)))
	log.debug('applyExclusions', { before: results.length, after: filtered.length, exclusions })
	return filtered
}

// ─── Extension Export ─────────────────────────────────────────────────────────
// Exported as a plain object — no class, no inheritance.
// Hayase loads this directly from the bundled dist/nyaasi.js file.
//
// The same file powers three index.json entries:
//   - Nyaa            → keyword: "",        category: "1_2", media: sub
//   - Nyaa (Dub)      → keyword: "Dubbed",  category: "1_2", media: dub
//   - Nyaa (Non-English) → keyword: "",     category: "1_3", media: dub
//     (user sets their own keyword: "Arabic", "Hindi", "Bangla", etc.)

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
			const res = await fetchFn(`${DEFAULT_DOMAIN}/?page=rss`, { signal: controller.signal })
			if (!res.ok) throw new Error(`Nyaa returned HTTP ${res.status}. The site may be down or blocked in your region.`)
			log.info('test() passed')
			return true
		} catch (err) {
			if (err.name === 'AbortError') throw new Error(`Nyaa did not respond within ${TIMEOUT_MS / 1000}s. Check your network or whether nyaa.si is blocked.`)
			throw new Error(`Could not reach Nyaa: ${err.message}`)
		} finally {
			clearTimeout(timer)
		}
	},

	/**
	 * Single episode search.
	 * Builds multiple query variants and tries them in order.
	 * Only torrents that match the requested episode are returned.
	 * If a keyword is configured, it's appended to every variant.
	 */
	async single (query, options = {}) {
		log.info('single() called', { titles: query.titles, episode: query.episode, resolution: query.resolution })
		if (!query.titles?.length) return []

		const keyword  = options.keyword?.trim() || DEFAULT_KEYWORD
		const ep       = query.episode != null ? query.episode.toString() : null
		const epPadded = ep ? ep.padStart(2, '0') : null

		// Build query variants from most specific to least specific,
		// then apply the keyword suffix to each one.
		// Nyaa searches by whole words, so "Show 07" will NOT find "Show S03E07".
		// That is fine: the title-only query at the end finds those, and
		// filterByEpisode() picks out the right episode from its results.
		const queries = []
		for (const title of query.titles.slice(0, 3)) {
			if (epPadded) {
				queries.push(applyKeyword(`${title} - ${epPadded}`, keyword))  // e.g. "Frieren - 01 Dubbed"
				queries.push(applyKeyword(`${title} ${epPadded}`, keyword))    // e.g. "Frieren 01 Dubbed"
				// Long-running shows are often numbered by absolute episode ("- 1180")
				const abs = query.absoluteEpisodeNumber
				if (abs != null && Number(abs) !== Number(query.episode)) {
					queries.push(applyKeyword(`${title} - ${abs}`, keyword))
				}
			}
			queries.push(applyKeyword(title, keyword))                       // fallback: title only
		}
		log.debug('Query variants', queries)

		// If Hayase gave us an episode, drop every torrent that is not that episode.
		// If it did not (rare), keep everything like before.
		const keep = query.episode != null
			? results => filterByEpisode(results, query.episode, query.absoluteEpisodeNumber)
			: results => results.filter(r => r.type !== 'batch')

		const results = await fetchFirstResults(
			query.fetch,
			queries,
			{ resolution: query.resolution || '', isBatch: false, episode: query.episode },
			options,
			keep
		)

		const filtered = applyExclusions(results, query.exclusions)
		log.info('single() done', { rawCount: results.length, filteredCount: filtered.length })
		return filtered
	},

	/**
	 * Batch search — looks for complete season packs.
	 * Appends batch/complete/season keywords to help find packs,
	 * then the keyword suffix (e.g. "Dubbed") on top of that.
	 * Only real packs are returned (never single episodes).
	 */
	async batch (query, options = {}) {
		log.info('batch() called', { titles: query.titles, episodeCount: query.episodeCount })
		if (!query.titles?.length) return []

		const keyword   = options.keyword?.trim() || DEFAULT_KEYWORD
		const baseTitle = query.titles[0]

		// Try batch-specific queries first, then fall back to plain title.
		// Keyword is appended after batch qualifiers so Nyaa can still match both.
		const queries = [
			applyKeyword(`${baseTitle} batch`, keyword),
			applyKeyword(`${baseTitle} complete`, keyword),
			applyKeyword(`${baseTitle} season`, keyword),
			...query.titles.slice(0, 3).map(t => applyKeyword(t, keyword)),
		]

		const packs = await fetchFirstResults(
			query.fetch,
			queries,
			{ resolution: query.resolution || '', isBatch: true },
			options,
			filterByBatch
		)

		const final = applyExclusions(packs, query.exclusions)
		log.info('batch() done', { finalCount: final.length })
		return final
	},

	/**
	 * Movie search — same as single but without episode number logic.
	 */
	async movie (query, options = {}) {
		log.info('movie() called', { titles: query.titles, resolution: query.resolution })
		if (!query.titles?.length) return []

		const keyword = options.keyword?.trim() || DEFAULT_KEYWORD
		const queries = query.titles.slice(0, 3).map(t => applyKeyword(t, keyword))

		const results = await fetchFirstResults(
			query.fetch,
			queries,
			{ resolution: query.resolution || '', isBatch: false },
			options
		)

		const filtered = applyExclusions(results, query.exclusions)
		log.info('movie() done', { rawCount: results.length, filteredCount: filtered.length })
		return filtered
	},
}