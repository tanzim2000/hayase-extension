import AbstractSource from './abstract.js'

// ─── Debug ────────────────────────────────────────────────────────────────────
const DEBUG_MODE = false

/**
 * Structured logger. All output is prefixed with [NyaaSi] and a timestamp.
 * Set DEBUG_MODE = true to enable. Safe to ship with DEBUG_MODE = false —
 * zero overhead when disabled.
 */
const log = {
  _fmt: (level, msg, data) => {
    if (!DEBUG_MODE) return
    const ts = new Date().toISOString()
    const prefix = `[NyaaSi][${ts}][${level}]`
    if (data !== undefined) {
      console[level === 'ERROR' ? 'error' : level === 'WARN' ? 'warn' : 'log'](prefix, msg, data)
    } else {
      console[level === 'ERROR' ? 'error' : level === 'WARN' ? 'warn' : 'log'](prefix, msg)
    }
  },
  info:  (msg, data) => log._fmt('INFO',  msg, data),
  warn:  (msg, data) => log._fmt('WARN',  msg, data),
  error: (msg, data) => log._fmt('ERROR', msg, data),
  debug: (msg, data) => log._fmt('DEBUG', msg, data),
}
// ─────────────────────────────────────────────────────────────────────────────

// Nyaa category IDs
const CAT_ANIME_ENGLISH = '1_2'
const CAT_ANIME_RAW = '1_4'
const CAT_ANIME_NON_ENGLISH = '1_3'

// Filter modes: 0 = no filter, 1 = no remakes, 2 = trusted only
const FILTER_NO_REMAKES = '1'

// All known resolution tokens Nyaa titles use
const RESOLUTION_TOKENS = ['2160', '4k', '1080', '720', '540', '480']

// Fetch timeout in ms
const TIMEOUT_MS = 10000

// Max retries on network error
const MAX_RETRIES = 2

/**
 * Parse a Nyaa size string like "1.5 GiB" or "350.2 MiB" into bytes.
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
 * Extract a named nyaa: namespace tag value from an XML item string.
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
 * Extract a plain RSS tag value (handles CDATA).
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
 * @param {string} url
 * @param {number} [retries]
 * @returns {Promise<Response>}
 */
async function fetchWithRetry (url, retries = MAX_RETRIES) {
  for (let attempt = 0; attempt <= retries; attempt++) {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
    log.info(`Fetch attempt ${attempt + 1}/${retries + 1}`, { url })
    try {
      const res = await fetch(url, {
        signal: controller.signal,
        headers: { 'User-Agent': 'Hayase/1.0 (hayase.watch)' }
      })
      clearTimeout(timer)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      log.info('Fetch OK', { status: res.status, url })
      return res
    } catch (err) {
      clearTimeout(timer)
      log.warn(`Fetch failed (attempt ${attempt + 1})`, { url, error: err.message })
      if (attempt === retries) throw err
      const delay = 500 * (attempt + 1)
      log.debug(`Retrying in ${delay}ms...`)
      await new Promise(r => setTimeout(r, delay))
    }
  }
}

/**
 * Detect if a torrent title likely contains a given episode number.
 * Handles common patterns: " - 01", "E01", "[01]", "_01_", etc.
 * @param {string} title
 * @param {number} episode
 * @returns {boolean}
 */
function titleMatchesEpisode (title, episode) {
  const ep = episode.toString()
  const epPadded = ep.padStart(2, '0')
  const epPadded3 = ep.padStart(3, '0')
  // Common patterns: "- 01 ", "E01", "[01]", " 01 ", "_01_", "- 01v"
  const patterns = [
    `[-–\\s]\\s*${epPadded3}[\\s\\[\\]vV._(]`,
    `[-–\\s]\\s*${epPadded}[\\s\\[\\]vV._(]`,
    `[Ee]${epPadded}[^\\d]`,
    `\\[${epPadded}\\]`,
    `\\[${epPadded3}\\]`
  ]
  return patterns.some(p => new RegExp(p).test(title))
}

/**
 * Check whether a title matches a desired resolution, or if no resolution
 * preference is set, return true.
 * @param {string} title
 * @param {string} resolution  e.g. '1080', '720', or ''
 * @returns {boolean}
 */
function titleMatchesResolution (title, resolution) {
  if (!resolution) return true
  const lower = title.toLowerCase()
  // Must contain requested resolution
  if (!lower.includes(resolution)) return false
  return true
}

/**
 * Build a clean Nyaa search query from a title.
 * Preserves Japanese/Unicode characters (Nyaa indexes them).
 * Only strips characters that break URL encoding badly.
 * @param {string} title
 * @returns {string}
 */
function cleanTitle (title) {
  return title
    .replace(/[<>]/g, ' ')  // remove angle brackets only
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Parse raw RSS XML text into TorrentResult objects.
 * @param {string} xml
 * @param {{ resolution: string, isBatch: boolean, episode?: number }} opts
 * @returns {import('./').TorrentResult[]}
 */
function parseRSS (xml, { resolution, isBatch, episode }) {
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

    // Resolution filtering — skip if user wants specific res and title doesn't have it
    if (resolution && !titleMatchesResolution(title, resolution)) {
      skippedResolution++
      log.debug(`Skipped (resolution mismatch, want ${resolution})`, { title })
      continue
    }

    // For single episode queries, prefer titles that contain the episode number
    // but don't hard-exclude — Hayase's resolver will handle final matching
    const hasEpMatch = episode != null ? titleMatchesEpisode(title, episode) : true
    const accuracy = hasEpMatch ? 'high' : 'medium'

    const infoHash = getNyaaTag(item, 'infoHash').toLowerCase()
    if (!infoHash) {
      skippedNoHash++
      log.warn('Skipped (no infoHash)', { title })
      continue
    }

    const magnet = `magnet:?xt=urn:btih:${infoHash}&dn=${encodeURIComponent(title)}` +
      `&tr=http%3A%2F%2Fnyaa.tracker.wf%3A7777%2Fannounce` +
      `&tr=udp%3A%2F%2Fopen.stealth.si%3A80%2Fannounce` +
      `&tr=udp%3A%2F%2Ftracker.opentrackr.org%3A1337%2Fannounce` +
      `&tr=udp%3A%2F%2Fexodus.desync.com%3A6969%2Fannounce` +
      `&tr=udp%3A%2F%2Ftracker.torrent.eu.org%3A451%2Fannounce`

    const seeders = parseInt(getNyaaTag(item, 'seeders') || '0', 10)
    const leechers = parseInt(getNyaaTag(item, 'leechers') || '0', 10)
    const downloads = parseInt(getNyaaTag(item, 'downloads') || '0', 10)
    const size = parseSize(getNyaaTag(item, 'size'))

    // Parse pubDate (RFC 2822: "Thu, 08 May 2025 12:00:00 +0000")
    const pubDateStr = getTag(item, 'pubDate')
    const date = pubDateStr ? new Date(pubDateStr) : new Date(0)

    // Determine result type
    let type
    if (isBatch) {
      type = 'batch'
    } else {
      const lowerTitle = title.toLowerCase()
      if (/batch|season|complete|s\d{2}(?!\d)|vol\.?\s*\d/i.test(lowerTitle)) {
        type = 'batch'
      }
    }

    log.debug('Parsed result', { title, accuracy, type, seeders, leechers, size })
    results.push({
      title,
      link: magnet,
      hash: infoHash,
      seeders: seeders >= 30000 ? 0 : seeders,
      leechers: leechers >= 30000 ? 0 : leechers,
      downloads,
      size,
      date,
      accuracy,
      type
    })
  }

  log.info('parseRSS complete', {
    total: results.length,
    skippedCategory,
    skippedResolution,
    skippedNoHash
  })
  return results
}

/**
 * Build a Nyaa RSS URL.
 * @param {string} query
 * @param {string} [category]
 * @param {string} [filter]
 * @returns {string}
 */
function buildURL (query, category = CAT_ANIME_ENGLISH, filter = FILTER_NO_REMAKES) {
  const params = new URLSearchParams({
    page: 'rss',
    c: category,
    f: filter,
    q: query
  })
  return `https://nyaa.si/?${params.toString()}`
}

/**
 * Try fetching and parsing RSS for a list of queries in order.
 * Returns on the first query that gives results, or empty array.
 * @param {string[]} queries
 * @param {{ resolution: string, isBatch: boolean, episode?: number }} parseOpts
 * @param {string[]} [categories]
 * @returns {Promise<import('./').TorrentResult[]>}
 */
async function fetchFirstResults (queries, parseOpts, categories = [CAT_ANIME_ENGLISH]) {
  log.info('fetchFirstResults start', { queries, parseOpts, categories })
  for (const query of queries) {
    for (const cat of categories) {
      try {
        const url = buildURL(cleanTitle(query), cat)
        log.info('Trying query', { query, category: cat, url })
        const res = await fetchWithRetry(url)
        const xml = await res.text()
        log.debug('RSS XML length', { chars: xml.length })
        const results = parseRSS(xml, parseOpts)
        if (results.length > 0) {
          log.info('Query succeeded', { query, category: cat, resultCount: results.length })
          return results
        }
        log.info('Query returned 0 results, trying next', { query, category: cat })
      } catch (err) {
        log.error('Query threw error', { query, category: cat, error: err.message })
      }
    }
  }
  log.warn('All queries exhausted, returning empty')
  return []
}

export default new class NyaaSi extends AbstractSource {
  /** @type {import('./').SearchFunction} */
  async single ({ titles, episode, resolution, exclusions }) {
    log.info('single() called', { titles, episode, resolution, exclusions })
    if (!titles?.length) return []

    const ep = episode != null ? episode.toString() : null
    const epPadded = ep ? ep.padStart(2, '0') : null

    // Build query variants, most specific first
    const queries = []
    for (const title of titles.slice(0, 3)) {
      if (epPadded) {
        queries.push(`${title} - ${epPadded}`)
        queries.push(`${title} ${epPadded}`)
      }
      queries.push(title)
    }
    log.debug('Query list', queries)

    const results = await fetchFirstResults(
      queries,
      { resolution: resolution || '', isBatch: false, episode },
      [CAT_ANIME_ENGLISH, CAT_ANIME_NON_ENGLISH]
    )

    const filtered = this.applyExclusions(results, exclusions)
    log.info('single() done', { rawCount: results.length, filteredCount: filtered.length })
    return filtered
  }

  /** @type {import('./').SearchFunction} */
  async batch ({ titles, episodeCount, resolution, exclusions }) {
    log.info('batch() called', { titles, episodeCount, resolution, exclusions })
    if (!titles?.length) return []

    const queries = titles.slice(0, 3).map(t => t)

    const results = await fetchFirstResults(
      queries,
      { resolution: resolution || '', isBatch: true },
      [CAT_ANIME_ENGLISH, CAT_ANIME_NON_ENGLISH]
    )

    const filtered = results.filter(r =>
      r.type === 'batch' ||
      (episodeCount && r.title.match(/\d+\s*[-~]\s*\d+/))
    )
    log.info('batch() pack filter', { before: results.length, after: filtered.length })

    const final = this.applyExclusions(filtered.length ? filtered : results, exclusions)
    log.info('batch() done', { finalCount: final.length })
    return final
  }

  /** @type {import('./').SearchFunction} */
  async movie ({ titles, resolution, exclusions }) {
    log.info('movie() called', { titles, resolution, exclusions })
    if (!titles?.length) return []

    const queries = titles.slice(0, 3)

    const results = await fetchFirstResults(
      queries,
      { resolution: resolution || '', isBatch: false },
      [CAT_ANIME_ENGLISH, CAT_ANIME_NON_ENGLISH]
    )

    const filtered = this.applyExclusions(results, exclusions)
    log.info('movie() done', { rawCount: results.length, filteredCount: filtered.length })
    return filtered
  }

  /**
   * Filter out results containing any exclusion keyword.
   * @param {import('./').TorrentResult[]} results
   * @param {string[]} exclusions
   * @returns {import('./').TorrentResult[]}
   */
  applyExclusions (results, exclusions) {
    if (!exclusions?.length) return results
    const lower = exclusions.map(e => e.toLowerCase())
    const filtered = results.filter(r =>
      !lower.some(ex => r.title.toLowerCase().includes(ex))
    )
    log.debug('applyExclusions', { before: results.length, after: filtered.length, exclusions })
    return filtered
  }

  async test () {
    log.info('test() called')
    try {
      const res = await fetchWithRetry(buildURL('Frieren'))
      log.info('test() result', { ok: res.ok })
      return res.ok
    } catch (err) {
      log.error('test() failed', { error: err.message })
      return false
    }
  }
}()
