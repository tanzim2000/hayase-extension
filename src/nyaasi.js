// nyaasi.js — Nyaa.si torrent extension for Hayase
//
// Searches Nyaa.si directly via its RSS feed.
// No third-party proxies — talks to nyaa.si directly.
//
// Features:
//   - Direct RSS feed parsing (no proxy dependency)
//   - Resolution filtering
//   - Episode number matching
//   - Title fallback chain (tries multiple title variants)
//   - Retry logic with exponential backoff
//   - Exclusion keyword filtering
//   - Batch detection
//   - Configurable domain, category, filter, keyword via Hayase options
//   - keyword option: appended to every query — use "Dubbed" for dub entries,
//     "Arabic" / "Hindi" / "Bangla" etc. for non-English entries, "" for subs
//   - Debug logging (set DEBUG_MODE = true to enable)

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
 * Detect if a torrent title likely contains a given episode number.
 * Handles common patterns: "- 01", "E01", "[01]", "[001]" etc.
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
 * Clean a title for use as a Nyaa search query.
 * Preserves Japanese/Unicode characters — Nyaa indexes them.
 * Only strips characters that break URL encoding.
 * @param {string} title
 * @returns {string}
 */
function cleanTitle (title) {
  return title
    .replace(/[<>"]/g, ' ')
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

    // Episode match check — affects accuracy rating, doesn't hard-exclude results
    const hasEpMatch = episode != null ? titleMatchesEpisode(title, episode) : true
    const accuracy = hasEpMatch ? 'high' : 'medium'

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

    // Detect batch releases
    let type
    if (isBatch || /batch|season|complete|s\d{2}(?!\d)|vol\.?\s*\d/i.test(title)) {
      type = 'batch'
    }

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
 * Try a list of queries in order, return results from the first one that hits.
 * Tries each query across multiple categories before moving to the next query.
 * @param {typeof fetch} fetchFn
 * @param {string[]} queries
 * @param {object} parseOpts
 * @param {object} options  — Hayase extension options
 * @returns {Promise<object[]>}
 */
async function fetchFirstResults (fetchFn, queries, parseOpts, options) {
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
        const results = parseRSS(xml, parseOpts)
        if (results.length > 0) {
          log.info('Query succeeded', { query, category: cat, resultCount: results.length })
          return results
        }
        log.info('Query returned 0 results, trying next', { query, category: cat })
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
   * If a keyword is configured, it's appended to every variant.
   */
  async single (query, options = {}) {
    log.info('single() called', { titles: query.titles, episode: query.episode, resolution: query.resolution })
    if (!query.titles?.length) return []

    const keyword  = options.keyword?.trim() || DEFAULT_KEYWORD
    const ep       = query.episode != null ? query.episode.toString() : null
    const epPadded = ep ? ep.padStart(2, '0') : null

    // Build query variants from most specific to least specific,
    // then apply the keyword suffix to each one
    const queries = []
    for (const title of query.titles.slice(0, 3)) {
      if (epPadded) {
        queries.push(applyKeyword(`${title} - ${epPadded}`, keyword))  // e.g. "Frieren - 01 Dubbed"
        queries.push(applyKeyword(`${title} ${epPadded}`, keyword))    // e.g. "Frieren 01 Dubbed"
      }
      queries.push(applyKeyword(title, keyword))                       // fallback: title only
    }
    log.debug('Query variants', queries)

    const results = await fetchFirstResults(
      query.fetch,
      queries,
      { resolution: query.resolution || '', isBatch: false, episode: query.episode },
      options
    )

    const filtered = applyExclusions(results, query.exclusions)
    log.info('single() done', { rawCount: results.length, filteredCount: filtered.length })
    return filtered
  },

  /**
   * Batch search — looks for complete season packs.
   * Appends batch/complete/season keywords to help find packs,
   * then the keyword suffix (e.g. "Dubbed") on top of that.
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

    const results = await fetchFirstResults(
      query.fetch,
      queries,
      { resolution: query.resolution || '', isBatch: true },
      options
    )

    // Prefer results that look like packs (episode range in title or type=batch)
    const packs = results.filter(r =>
      r.type === 'batch' ||
      (query.episodeCount && r.title.match(/\d+\s*[-~]\s*\d+/))
    )
    log.info('batch() pack filter', { before: results.length, after: packs.length })

    const final = applyExclusions(packs.length ? packs : results, query.exclusions)
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
