// sukebei.js — Sukebei (sukebei.nyaa.si) torrent extension for Hayase
//
// Sukebei is Nyaa's adult content sister site. It uses the exact same
// RSS feed format as Nyaa, including all <nyaa:*> namespace tags.
//
// RSS URL format:
//   https://sukebei.nyaa.si/?page=rss&q=QUERY&c=CATEGORY&f=FILTER
//
// Categories:
//   1_1 = Art - Anime (hentai anime)
//   1_2 = Art - Doujinshi
//   1_3 = Art - Games
//   1_4 = Art - Manga
//   1_5 = Art - Pictures
//   2_1 = Real Life - Photobooks
//   2_2 = Real Life - Videos
//   0_0 = All
//
// ─── MIRROR FAILOVER ─────────────────────────────────────────────────────────
//
// The official domain is the only one built in. If it's blocked in your
// region, put alternates in the `domains` option (comma-separated) and this
// extension will work down that list until something answers.
//
// Why no baked-in mirror list? Two reasons:
//   1. Mirror domains for sites like this churn constantly. A list compiled
//      today is a list of dead URLs in six months, and users would be stuck
//      waiting on a repo update to fix it. User-supplied means they can fix
//      it themselves, immediately.
//   2. Whoever runs a given mirror is unknown. Shipping a default list means
//      silently routing users' traffic through third parties this project
//      has never vetted. Making it opt-in keeps that decision with the user.
//
// A "working" mirror means one that answers with actual RSS. That check
// matters: an ISP block page or a Cloudflare interstitial happily returns
// HTTP 200, so a plain status check would call a dead mirror alive.
//
// ─────────────────────────────────────────────────────────────────────────────

// ─── Debug ────────────────────────────────────────────────────────────────────
// Set to true to enable detailed logging in Hayase's DevTools (Ctrl+Shift+I)
// Set back to false before publishing
const DEBUG_MODE = false

const log = {
	_fmt (level, msg, data) {
		if (!DEBUG_MODE) return
		const ts = new Date().toISOString()
		const prefix = `[Sukebei][${ts}][${level}]`
		const fn = level === 'ERROR' ? 'error' : level === 'WARN' ? 'warn' : 'log'
		data !== undefined ? console[fn](prefix, msg, data) : console[fn](prefix, msg)
	},
	info:  (msg, data) => log._fmt('INFO',  msg, data),
	warn:  (msg, data) => log._fmt('WARN',  msg, data),
	error: (msg, data) => log._fmt('ERROR', msg, data),
	debug: (msg, data) => log._fmt('DEBUG', msg, data),
}
// ─────────────────────────────────────────────────────────────────────────────

// The one domain shipped with the extension. Always tried, always last, so
// there is never a configuration where zero domains get attempted.
const OFFICIAL_DOMAIN = 'https://sukebei.nyaa.si'

// Default values — can be overridden via Hayase extension options
const DEFAULT_CATEGORY = '1_1'  // Art - Anime (hentai anime)
const DEFAULT_FILTER   = '0'    // No filter (0 = all, 1 = no remakes, 2 = trusted only)

// Timeout for a real search request
const TIMEOUT_MS = 15000

// Timeout for a mirror liveness probe. Shorter than a search on purpose —
// when several mirrors are dead, the user waits through every one of these
// before getting results, so a long probe timeout multiplies into a very
// slow search.
const PROBE_TIMEOUT_MS = 8000

// Max retries on network failure during a search
const MAX_RETRIES = 2

// How long a resolved mirror is reused before re-probing. Without this,
// every single search would re-probe the whole mirror list first.
const MIRROR_CACHE_MS = 10 * 60 * 1000  // 10 minutes

// Remembers the mirror that last answered, so repeat searches skip probing.
// `key` is the candidate list this result came from — if the user edits their
// domains option, the key changes and the cache is correctly ignored.
let mirrorCache = { url: null, at: 0, key: '' }

// ─── Mirror handling ─────────────────────────────────────────────────────────

/**
 * Normalize a user-typed domain into a usable base URL.
 * Handles the common cases: trailing slashes, and a bare host with no scheme.
 * @param {string} raw
 * @returns {string|null} normalized URL, or null if there was nothing usable
 */
function normalizeDomain (raw) {
	if (!raw) return null
	const trimmed = String(raw).trim().replace(/\/+$/, '')
	if (!trimmed) return null
	// Someone typing a mirror into a settings box will often just write
	// "example.com" — assume https rather than failing on it.
	return /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`
}

/**
 * Build the ordered list of domains to try.
 *
 * Order is deliberate: anything the user configured comes first, because
 * setting a mirror at all is usually a sign the official domain doesn't work
 * for them — probing it first would cost a full timeout on every search.
 * The official domain is appended last as a guaranteed fallback.
 *
 * @param {object} options
 * @returns {string[]}
 */
function getCandidateDomains (options = {}) {
	const list = []

	const add = raw => {
		const url = normalizeDomain(raw)
		if (url && !list.includes(url)) list.push(url)
	}

	// `domain` (singular) is the original option from earlier versions of this
	// extension. Existing users already have a value saved under that key, so
	// it's still honoured rather than silently ignored after the upgrade.
	add(options.domain)

	// `domains` (plural) is the mirror list — comma-separated.
	String(options.domains || '').split(',').forEach(add)

	add(OFFICIAL_DOMAIN)

	return list
}

/**
 * Check whether one domain is actually serving Sukebei's RSS feed.
 * Never throws — a dead mirror is an expected outcome here, not an error.
 * @param {typeof fetch} fetchFn
 * @param {string} domain
 * @returns {Promise<{ domain: string, ok: boolean, ms: number, error: string|null }>}
 */
async function probeDomain (fetchFn, domain) {
	const controller = new AbortController()
	const timer = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS)
	const start = Date.now()

	try {
		const res = await fetchFn(`${domain}/?page=rss`, {
			signal: controller.signal,
			headers: { Accept: 'application/rss+xml, application/xml, text/xml' },
		})
		clearTimeout(timer)

		if (!res.ok) {
			return { domain, ok: false, ms: Date.now() - start, error: `HTTP ${res.status}` }
		}

		// The status code alone isn't enough. ISP block pages, captcha walls
		// and domain-parking pages all return 200 with HTML. If there's no
		// <rss> in the body, whatever answered isn't Sukebei.
		const body = await res.text()
		if (!body.includes('<rss')) {
			return {
				domain,
				ok: false,
				ms: Date.now() - start,
				error: 'Answered, but not with RSS (block page, captcha, or parked domain)',
			}
		}

		return { domain, ok: true, ms: Date.now() - start, error: null }
	} catch (err) {
		clearTimeout(timer)
		const error = err.name === 'AbortError'
			? `No response within ${PROBE_TIMEOUT_MS / 1000}s`
			: err.message
		return { domain, ok: false, ms: Date.now() - start, error }
	}
}

/**
 * Probe every candidate domain and return the full picture.
 * Unlike resolveDomain() this does NOT stop at the first working mirror —
 * it's for reporting ("which mirrors are up?"), not for doing a search.
 * @param {typeof fetch} fetchFn
 * @param {object} options
 * @returns {Promise<{ active: string|null, checked: object[] }>}
 */
async function checkAllDomains (fetchFn, options = {}) {
	const candidates = getCandidateDomains(options)
	const checked = []

	for (const domain of candidates) {
		checked.push(await probeDomain(fetchFn, domain))
	}

	const firstWorking = checked.find(r => r.ok)
	return { active: firstWorking ? firstWorking.domain : null, checked }
}

/**
 * Find a usable domain, fastest path: return the cached one if it's still
 * fresh, otherwise probe down the list and stop at the first that answers.
 * @param {typeof fetch} fetchFn
 * @param {object} options
 * @param {{ force?: boolean }} [opts] — force: true skips the cache
 * @returns {Promise<string>}
 * @throws if no candidate domain responds
 */
async function resolveDomain (fetchFn, options = {}, { force = false } = {}) {
	const candidates = getCandidateDomains(options)
	const key = candidates.join('|')

	const cacheIsUsable = !force
		&& mirrorCache.url
		&& mirrorCache.key === key
		&& Date.now() - mirrorCache.at < MIRROR_CACHE_MS

	if (cacheIsUsable) {
		log.debug('Using cached mirror', { domain: mirrorCache.url })
		return mirrorCache.url
	}

	const failures = []
	for (const domain of candidates) {
		const result = await probeDomain(fetchFn, domain)
		if (result.ok) {
			log.info('Mirror resolved', { domain, ms: result.ms })
			mirrorCache = { url: domain, at: Date.now(), key }
			return domain
		}
		log.warn('Mirror unreachable', result)
		failures.push(result)
	}

	// Every error is included so the user can see WHY each one failed —
	// "blocked" and "timed out" call for very different fixes, and this
	// message is shown to them directly inside Hayase.
	const detail = failures.map(f => `${f.domain} — ${f.error}`).join('; ')
	throw new Error(
		`Sukebei is unreachable. Tried ${candidates.length} domain(s): ${detail}. ` +
		`If it's blocked in your region, add a mirror under this extension's "domains" option.`
	)
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Parse a Sukebei size string like "1.5 GiB" into bytes.
 * Identical to Nyaa — same format.
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
 * Uses query.fetch (passed by Hayase) for proper CORS handling.
 * @param {typeof fetch} fetchFn
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
			if (!res.ok) throw new Error(`Sukebei returned HTTP ${res.status}`)
			log.info('Fetch OK', { status: res.status })
			return res
		} catch (err) {
			clearTimeout(timer)
			log.warn(`Fetch failed (attempt ${attempt + 1})`, { error: err.message })
			if (attempt === retries) {
				if (err.name === 'AbortError') throw new Error(`Sukebei did not respond within ${TIMEOUT_MS / 1000}s.`)
				throw new Error(`Could not reach Sukebei: ${err.message}`)
			}
			await new Promise(r => setTimeout(r, 500 * (attempt + 1)))
		}
	}
}

/**
 * Detect if a torrent title likely contains a given episode number.
 * @param {string} title
 * @param {number} episode
 * @returns {boolean}
 */
function titleMatchesEpisode (title, episode) {
	const ep = episode.toString()
	const epPadded  = ep.padStart(2, '0')
	const epPadded3 = ep.padStart(3, '0')
	const patterns = [
		`[-–\\s]\\s*${epPadded3}[\\s\\[\\]vV._(]`,
		`[-–\\s]\\s*${epPadded}[\\s\\[\\]vV._(]`,
		`[Ee]${epPadded}[^\\d]`,
		`\\[${epPadded}\\]`,
		`\\[${epPadded3}\\]`,
	]
	return patterns.some(p => new RegExp(p).test(title))
}

/**
 * Clean a title for use as a search query.
 * @param {string} title
 * @returns {string}
 */
function cleanTitle (title) {
	return title.replace(/[<>"]/g, ' ').replace(/\s+/g, ' ').trim()
}

/**
 * Build a Sukebei RSS URL against an already-resolved domain.
 * @param {string} domain — comes from resolveDomain(), already normalized
 * @param {string} query
 * @param {object} options
 * @returns {string}
 */
function buildURL (domain, query, options = {}) {
	const category = options.category?.trim() || DEFAULT_CATEGORY
	const filter   = options.filter?.trim()   || DEFAULT_FILTER
	const params   = new URLSearchParams({ page: 'rss', q: query, c: category, f: filter, s: 'seeders', o: 'desc' })
	return `${domain}/?${params.toString()}`
}

/**
 * Parse Sukebei RSS XML into TorrentResult objects.
 * @param {string} xml
 * @param {{ resolution: string, isBatch: boolean, episode?: number }} opts
 * @returns {object[]}
 */
function parseRSS (xml, { resolution, isBatch, episode }) {
	if (!xml.includes('<rss')) throw new Error('Sukebei returned a non-RSS response. The site may have changed or be blocking requests.')

	const results = []
	const itemRegex = /<item>([\s\S]*?)<\/item>/g
	let match
	let skippedResolution = 0
	let skippedNoHash = 0

	while ((match = itemRegex.exec(xml)) !== null) {
		const item = match[1]

		const title = getTag(item, 'title')
		if (!title) continue

		// Resolution filtering
		if (resolution && !title.toLowerCase().includes(resolution)) {
			skippedResolution++
			continue
		}

		const infoHash = getNyaaTag(item, 'infoHash').toLowerCase()
		if (!infoHash) { skippedNoHash++; continue }

		const hasEpMatch = episode != null ? titleMatchesEpisode(title, episode) : true
		const accuracy   = hasEpMatch ? 'high' : 'medium'

		// NOTE: the first tracker here is sukebei.tracker.wf:8888, NOT
		// nyaa.tracker.wf:7777. Sukebei runs its own tracker on a separate
		// port, and its torrents are not announced on Nyaa's. Using Nyaa's
		// URL here means the primary tracker rejects every announce and peer
		// discovery falls back to the slower public UDP trackers below.
		// Verified against the magnet links Sukebei itself publishes.
		const magnet = `magnet:?xt=urn:btih:${infoHash}&dn=${encodeURIComponent(title)}` +
			`&tr=http%3A%2F%2Fsukebei.tracker.wf%3A8888%2Fannounce` +
			`&tr=udp%3A%2F%2Fopen.stealth.si%3A80%2Fannounce` +
			`&tr=udp%3A%2F%2Ftracker.opentrackr.org%3A1337%2Fannounce` +
			`&tr=udp%3A%2F%2Fexodus.desync.com%3A6969%2Fannounce` +
			`&tr=udp%3A%2F%2Ftracker.torrent.eu.org%3A451%2Fannounce`

		const seeders   = parseInt(getNyaaTag(item, 'seeders')  || '0', 10)
		const leechers  = parseInt(getNyaaTag(item, 'leechers') || '0', 10)
		const downloads = parseInt(getNyaaTag(item, 'downloads')|| '0', 10)
		const size      = parseSize(getNyaaTag(item, 'size'))
		const pubDate   = getTag(item, 'pubDate')
		const date      = pubDate ? new Date(pubDate) : new Date(0)

		let type
		if (isBatch || /batch|complete|season|vol\.?\s*\d/i.test(title)) type = 'batch'

		results.push({
			title,
			link:     magnet,
			hash:     infoHash,
			seeders:  seeders  >= 30000 ? 0 : seeders,
			leechers: leechers >= 30000 ? 0 : leechers,
			downloads,
			size,
			date,
			accuracy,
			type,
		})
	}

	log.info('parseRSS complete', { total: results.length, skippedResolution, skippedNoHash })
	return results
}

/**
 * Try queries in order against a working mirror, return the first that gives
 * results.
 *
 * If the mirror dies partway through (it was fine 10 minutes ago when it was
 * cached, and isn't now), this re-resolves ONCE and retries rather than
 * failing the whole search. Once only — if the second mirror also fails, the
 * site is genuinely unreachable and looping further just wastes the user's
 * time behind a spinner.
 *
 * @param {typeof fetch} fetchFn
 * @param {string[]} queries
 * @param {object} parseOpts
 * @param {object} options
 * @returns {Promise<object[]>}
 */
async function fetchFirstResults (fetchFn, queries, parseOpts, options) {
	let domain = await resolveDomain(fetchFn, options)
	let hasReResolved = false

	for (const query of queries) {
		try {
			const url = buildURL(domain, cleanTitle(query), options)
			log.info('Trying query', { query, url })
			const res = await fetchWithRetry(fetchFn, url)
			const xml = await res.text()
			const results = parseRSS(xml, parseOpts)
			if (results.length > 0) return results
		} catch (err) {
			log.error('Query failed', { query, domain, error: err.message })

			if (!hasReResolved) {
				hasReResolved = true
				log.warn('Mirror failed mid-search — re-resolving', { failed: domain })
				// force: true, because the cache is what handed us the dead
				// mirror in the first place.
				domain = await resolveDomain(fetchFn, options, { force: true })
				continue  // retry this same query on the new mirror
			}

			throw err
		}
	}
	return []
}

/**
 * Filter out results containing exclusion keywords.
 * @param {object[]} results
 * @param {string[]} exclusions
 * @returns {object[]}
 */
function applyExclusions (results, exclusions) {
	if (!exclusions?.length) return results
	const lower = exclusions.map(e => e.toLowerCase())
	return results.filter(r => !lower.some(ex => r.title.toLowerCase().includes(ex)))
}

// ─── Extension Export ─────────────────────────────────────────────────────────

export default {

	/**
	 * Hayase's health check. Contract is unchanged from before: resolve if the
	 * source is usable, throw a human-readable error if not. It now passes as
	 * long as ANY configured domain answers, not just the official one.
	 */
	async test (query, options = {}) {
		log.info('test() called')
		const fetchFn = query?.fetch ?? fetch
		// force: true — a health check that can return a 10-minute-old cached
		// answer isn't a health check.
		await resolveDomain(fetchFn, options, { force: true })
		return true
	},

	/**
	 * Optional reporting hook — NOT part of Hayase's extension contract.
	 * Hayase never calls this; scripts/check-sources.mjs does, to report which
	 * mirror is carrying the source. Returns a plain object rather than
	 * throwing, because "all mirrors are dead" is a result worth reporting,
	 * not an error to swallow.
	 *
	 * @returns {Promise<{ active: string|null, checked: object[] }>}
	 */
	async mirrors (query, options = {}) {
		const fetchFn = query?.fetch ?? fetch
		return checkAllDomains(fetchFn, options)
	},

	async single (query, options = {}) {
		if (!query.titles?.length) return []
		const ep = query.episode != null ? query.episode.toString().padStart(2, '0') : null
		const queries = []
		for (const title of query.titles.slice(0, 3)) {
			if (ep) {
				queries.push(`${title} - ${ep}`)
				queries.push(`${title} ${ep}`)
			}
			queries.push(title)
		}
		const results = await fetchFirstResults(
			query.fetch, queries,
			{ resolution: query.resolution || '', isBatch: false, episode: query.episode },
			options
		)
		return applyExclusions(results, query.exclusions)
	},

	async batch (query, options = {}) {
		if (!query.titles?.length) return []

		// Batch queries are tried FIRST, before the plain title fallback.
		// Otherwise the bare title runs first, and since it almost always
		// returns something, the batch-specific keywords are never reached.
		const baseTitle = query.titles[0]
		const queries = [
			`${baseTitle} batch`,
			`${baseTitle} complete`,
			`${baseTitle} season`,
			...query.titles.slice(0, 3),  // plain title fallbacks after batch-specific queries
		]

		const results = await fetchFirstResults(
			query.fetch, queries,
			{ resolution: query.resolution || '', isBatch: true },
			options
		)
		const packs = results.filter(r => r.type === 'batch')
		return applyExclusions(packs.length ? packs : results, query.exclusions)
	},

	async movie (query, options = {}) {
		if (!query.titles?.length) return []
		const results = await fetchFirstResults(
			query.fetch, query.titles.slice(0, 3),
			{ resolution: query.resolution || '', isBatch: false },
			options
		)
		return applyExclusions(results, query.exclusions)
	},
}
