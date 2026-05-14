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
// Features:
//   - Same RSS parsing as Nyaa (identical format)
//   - Configurable category and filter via options
//   - Mirror domain support
//   - Resolution filtering
//   - Episode matching
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

// Default values — can be overridden via Hayase extension options
const DEFAULT_DOMAIN   = 'https://sukebei.nyaa.si'
const DEFAULT_CATEGORY = '1_1'  // Art - Anime (hentai anime)
const DEFAULT_FILTER   = '0'    // No filter (0 = all, 1 = no remakes, 2 = trusted only)

// Fetch timeout in ms
const TIMEOUT_MS = 15000

// Max retries on network failure
const MAX_RETRIES = 2

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
        headers: { Accept: 'application/rss+xml, application/xml, text/xml' }
      })
      clearTimeout(timer)
      if (!res.ok) throw new Error(`Sukebei returned HTTP ${res.status}. The site may be down or blocked in your region.`)
      log.info('Fetch OK', { status: res.status })
      return res
    } catch (err) {
      clearTimeout(timer)
      log.warn(`Fetch failed (attempt ${attempt + 1})`, { error: err.message })
      if (attempt === retries) {
        if (err.name === 'AbortError') throw new Error(`Sukebei did not respond within ${TIMEOUT_MS / 1000}s. The site may be slow or blocked.`)
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
 * Build a Sukebei RSS URL.
 * @param {string} query
 * @param {object} options
 * @returns {string}
 */
function buildURL (query, options = {}) {
  const domain   = (options.domain?.trim()  || DEFAULT_DOMAIN).replace(/\/+$/, '')
  const category = options.category?.trim() || DEFAULT_CATEGORY
  const filter   = options.filter?.trim()   || DEFAULT_FILTER
  const params   = new URLSearchParams({ page: 'rss', q: query, c: category, f: filter, s: 'seeders', o: 'desc' })
  return `${domain}/?${params.toString()}`
}

/**
 * Parse Sukebei RSS XML into TorrentResult objects.
 * Identical logic to Nyaa — same RSS format and namespace tags.
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
 * Try queries in order, return first that gives results.
 * @param {typeof fetch} fetchFn
 * @param {string[]} queries
 * @param {object} parseOpts
 * @param {object} options
 * @returns {Promise<object[]>}
 */
async function fetchFirstResults (fetchFn, queries, parseOpts, options) {
  for (const query of queries) {
    try {
      const url = buildURL(cleanTitle(query), options)
      log.info('Trying query', { query, url })
      const res = await fetchWithRetry(fetchFn, url)
      const xml = await res.text()
      const results = parseRSS(xml, parseOpts)
      if (results.length > 0) return results
    } catch (err) {
      log.error('Query failed', { query, error: err.message })
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

  async test (query) {
    log.info('test() called')
    const fetchFn = query?.fetch ?? fetch
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
    try {
      const res = await fetchFn(`${DEFAULT_DOMAIN}/?page=rss`, { signal: controller.signal })
      clearTimeout(timer)
      if (!res.ok) throw new Error(`Sukebei returned HTTP ${res.status}. The site may be down.`)
      return true
    } catch (err) {
      clearTimeout(timer)
      if (err.name === 'AbortError') throw new Error(`Sukebei did not respond within ${TIMEOUT_MS / 1000}s. Check your network.`)
      throw new Error(`Could not reach Sukebei: ${err.message}`)
    }
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
    const queries = query.titles.slice(0, 3)
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
