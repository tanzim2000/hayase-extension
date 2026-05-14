// tokyotosho.js — Tokyo Toshokan torrent extension for Hayase
//
// Tokyo Toshokan (tokyotosho.info) is one of the oldest anime torrent indexes.
// It has broad coverage including older shows that Nyaa might not have.
// Uses RSS feed for search — no official API.
//
// RSS URL format:
//   https://www.tokyotosho.info/rss.php?terms=QUERY&type=TYPE
//   type: 0 = All, 1 = Anime, 2 = Music, 3 = Manga, 4 = Hentai Anime
//
// Features:
//   - Proper pubDate parsing (was always new Date() before)
//   - Fixed size parsing (was called on wrong string before)
//   - Content type filter via settings (Anime only by default)
//   - Resolution filtering via query.resolution
//   - Episode number zero-padding
//   - Title fallback chain
//   - Batch-specific search queries
//   - Retry logic with timeout
//   - Debug logging (set DEBUG_MODE = true to enable)

// ─── Debug ────────────────────────────────────────────────────────────────────
// Set to true to enable detailed logging in Hayase's DevTools (Ctrl+Shift+I)
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

// Tokyo Toshokan RSS endpoint
const BASE_URL = 'https://www.tokyotosho.info/rss.php'

// Content type codes for the type= parameter
// 0 = All, 1 = Anime, 2 = Music, 3 = Manga/Doujin, 4 = Hentai Anime
const DEFAULT_TYPE = '1' // Anime only

// Fetch timeout in ms
const TIMEOUT_MS = 15000

// Max retries on network failure
const MAX_RETRIES = 2

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Parse a size string like "350.2 MiB" or "1.5 GiB" into bytes.
 * Fixed from original — was being called on the full description string
 * instead of just the size portion.
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
 * Build a Tokyo Toshokan RSS URL.
 * @param {string} query    — search terms
 * @param {object} options  — Hayase extension options
 * @returns {string}
 */
function buildURL (query, options = {}) {
  const type = options.type?.trim() || DEFAULT_TYPE
  const params = new URLSearchParams({ terms: query, type })
  return `${BASE_URL}?${params.toString()}`
}

/**
 * Clean a title for use as a search query.
 * Strips characters that Tokyo Toshokan's search doesn't handle well.
 * Preserves Japanese characters — TT indexes them.
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
      const res = await fetchFn(url, { signal: controller.signal })
      clearTimeout(timer)
      if (!res.ok) throw new Error(`Tokyo Toshokan returned HTTP ${res.status}. The site may be down or blocked.`)
      log.info('Fetch OK', { status: res.status })
      return res
    } catch (err) {
      clearTimeout(timer)
      log.warn(`Fetch failed (attempt ${attempt + 1})`, { error: err.message })
      if (attempt === retries) {
        if (err.name === 'AbortError') throw new Error(`Tokyo Toshokan did not respond within ${TIMEOUT_MS / 1000}s. The site may be slow or blocked.`)
        throw new Error(`Could not reach Tokyo Toshokan: ${err.message}`)
      }
      await new Promise(r => setTimeout(r, 500 * (attempt + 1)))
    }
  }
}

/**
 * Parse Tokyo Toshokan RSS XML into TorrentResult objects.
 *
 * TT RSS item structure:
 *   <title><![CDATA[...]]></title>
 *   <link>https://www.tokyotosho.info/details.php?id=...</link>
 *   <pubDate>Thu, 08 May 2025 12:00:00 +0000</pubDate>   ← was ignored before!
 *   <description><![CDATA[
 *     Size: 350.2 MiB, ...
 *     magnet:?xt=urn:btih:...
 *   ]]></description>
 *
 * @param {string} xml
 * @param {string} resolution  — from query.resolution, used for filtering
 * @param {boolean} isBatch
 * @returns {object[]}
 */
function parseRSS (xml, resolution, isBatch) {
  if (!xml.includes('<rss') && !xml.includes('<channel')) {
    throw new Error('Tokyo Toshokan returned a non-RSS response. The site may have changed or be blocking requests.')
  }

  const results = []
  const itemRegex = /<item>([\s\S]*?)<\/item>/g
  let match
  let skippedResolution = 0
  let skippedNoMagnet = 0

  while ((match = itemRegex.exec(xml)) !== null) {
    const item = match[1]

    // Extract title — TT uses CDATA
    const titleMatch = item.match(/<title><!\[CDATA\[(.*?)\]\]><\/title>/)
    if (!titleMatch) continue
    const title = titleMatch[1].trim()
    if (!title) continue

    // Resolution filtering
    if (resolution && !title.toLowerCase().includes(resolution)) {
      skippedResolution++
      log.debug(`Skipped (resolution mismatch, want ${resolution})`, { title })
      continue
    }

    // Extract description — contains size and magnet link
    const descMatch = item.match(/<description><!\[CDATA\[([\s\S]*?)\]\]><\/description>/)
    if (!descMatch) continue
    const description = descMatch[1]

    // Extract magnet link from description
    const magnetMatch = description.match(/magnet:\?xt=urn:btih:([a-fA-F0-9]+)/)
    if (!magnetMatch) {
      skippedNoMagnet++
      log.debug('Skipped (no magnet link)', { title })
      continue
    }

    const magnet = magnetMatch[0]
    const hash = magnetMatch[1].toLowerCase()

    // Extract size — fixed: now extracts just the size portion first,
    // then passes that to parseSize (old code passed the full description)
    const sizeMatch = description.match(/Size:\s*([\d.]+\s*(?:KiB|MiB|GiB|TiB|KB|MB|GB|TB))/i)
    const size = sizeMatch ? parseSize(sizeMatch[1]) : 0

    // Parse pubDate — fixed: was new Date() (always now) before!
    // TT uses RFC 2822 format: "Thu, 08 May 2025 12:00:00 +0000"
    const pubDateMatch = item.match(/<pubDate>(.*?)<\/pubDate>/)
    const date = pubDateMatch ? new Date(pubDateMatch[1].trim()) : new Date(0)

    // Detect batch releases
    let type
    if (isBatch || /batch|complete|season|vol\.?\s*\d|\d+\s*[-~]\s*\d+/i.test(title)) {
      type = 'batch'
    }

    log.debug('Parsed result', { title, hash, size, date, type })

    results.push({
      title,
      link:      magnet,
      hash,
      seeders:   0,   // TT RSS doesn't provide peer counts
      leechers:  0,
      downloads: 0,
      size,
      date,
      accuracy:  'medium', // TT is string-search based — medium accuracy
      type,
    })
  }

  log.info('parseRSS complete', {
    total: results.length,
    skippedResolution,
    skippedNoMagnet,
  })
  return results
}

/**
 * Try a list of queries in order, return results from the first one that hits.
 * @param {typeof fetch} fetchFn
 * @param {string[]} queries
 * @param {string} resolution
 * @param {boolean} isBatch
 * @param {object} options
 * @returns {Promise<object[]>}
 */
async function fetchFirstResults (fetchFn, queries, resolution, isBatch, options) {
  log.info('fetchFirstResults start', { queries })
  for (const query of queries) {
    try {
      const url = buildURL(cleanTitle(query), options)
      log.info('Trying query', { query, url })
      const res = await fetchWithRetry(fetchFn, url)
      const xml = await res.text()
      const results = parseRSS(xml, resolution, isBatch)
      if (results.length > 0) {
        log.info('Query succeeded', { query, resultCount: results.length })
        return results
      }
      log.info('Query returned 0 results, trying next', { query })
    } catch (err) {
      log.error('Query threw error', { query, error: err.message })
      throw err
    }
  }
  log.warn('All queries exhausted, returning empty')
  return []
}

/**
 * Filter out results containing any exclusion keyword.
 * @param {object[]} results
 * @param {string[]} exclusions
 * @returns {object[]}
 */
function applyExclusions (results, exclusions) {
  if (!exclusions?.length) return results
  const lower = exclusions.map(e => e.toLowerCase())
  const filtered = results.filter(r => !lower.some(ex => r.title.toLowerCase().includes(ex)))
  log.debug('applyExclusions', { before: results.length, after: filtered.length })
  return filtered
}

// ─── Extension Export ─────────────────────────────────────────────────────────

export default {

  /**
   * Health check — verifies Tokyo Toshokan is reachable.
   */
  async test (query) {
    log.info('test() called')
    const fetchFn = query?.fetch ?? fetch
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
    try {
      const res = await fetchFn(BASE_URL, { signal: controller.signal })
      clearTimeout(timer)
      if (!res.ok) throw new Error(`Tokyo Toshokan returned HTTP ${res.status}. The site may be down.`)
      log.info('test() passed')
      return true
    } catch (err) {
      clearTimeout(timer)
      if (err.name === 'AbortError') throw new Error(`Tokyo Toshokan did not respond within ${TIMEOUT_MS / 1000}s. Check your network.`)
      throw new Error(`Could not reach Tokyo Toshokan: ${err.message}`)
    }
  },

  /**
   * Single episode search.
   * Builds query with episode number (zero-padded) and optional resolution.
   */
  async single (query, options = {}) {
    log.info('single() called', { titles: query.titles, episode: query.episode, resolution: query.resolution })
    if (!query.titles?.length) return []

    const ep = query.episode != null ? query.episode.toString().padStart(2, '0') : null

    // Build query variants from most to least specific
    const queries = []
    for (const title of query.titles.slice(0, 3)) {
      if (ep) {
        // With resolution: "Frieren - 01 1080"
        if (query.resolution) queries.push(`${title} - ${ep} ${query.resolution}`)
        // Without resolution: "Frieren - 01"
        queries.push(`${title} - ${ep}`)
        queries.push(`${title} ${ep}`)
      }
      queries.push(title)
    }
    log.debug('Query variants', queries)

    const results = await fetchFirstResults(
      query.fetch, queries, query.resolution || '', false, options
    )
    return applyExclusions(results, query.exclusions)
  },

  /**
   * Batch search.
   * Tries batch-specific keywords first, then falls back to plain title.
   */
  async batch (query, options = {}) {
    log.info('batch() called', { titles: query.titles })
    if (!query.titles?.length) return []

    const baseTitle = query.titles[0]
    const queries = [
      `${baseTitle} batch`,
      `${baseTitle} complete`,
      `${baseTitle} season`,
      ...query.titles.slice(0, 3),
    ]

    const results = await fetchFirstResults(
      query.fetch, queries, query.resolution || '', true, options
    )

    // Prefer pack results, fall back to all results
    const packs = results.filter(r => r.type === 'batch')
    return applyExclusions(packs.length ? packs : results, query.exclusions)
  },

  /**
   * Movie search.
   * Same as single but without episode number logic.
   */
  async movie (query, options = {}) {
    log.info('movie() called', { titles: query.titles, resolution: query.resolution })
    if (!query.titles?.length) return []

    const queries = query.titles.slice(0, 3)
    const results = await fetchFirstResults(
      query.fetch, queries, query.resolution || '', false, options
    )
    return applyExclusions(results, query.exclusions)
  },
}
