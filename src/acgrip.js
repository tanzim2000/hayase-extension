// acgrip.js — acg.rip torrent extension for Hayase
//
// Searches acg.rip via its RSS feed (.xml endpoint).
// acg.rip is a Chinese-leaning anime tracker with broad CJK fansub coverage —
// particularly useful for Chinese-subbed and Chinese-dubbed releases that
// don't appear on Nyaa's English-translated category.
//
// Features:
//   - Title fallback chain (tries multiple title variants before giving up)
//   - Resolution preference filtering (soft — downgrades accuracy, doesn't exclude)
//   - Exclusion keyword filtering (respects query.exclusions)
//   - Retry logic with exponential backoff
//   - Batch detection via common keywords and episode range patterns
//   - Configurable domain via Hayase options
//   - Debug logging (set DEBUG_MODE = true to enable)
//
// Known limitation:
//   acg.rip's RSS feed does not expose infoHash — only a .torrent file URL.
//   See the hash trade-off comment on toResult() below for details.

// ─── Debug ────────────────────────────────────────────────────────────────────
// Set to true to enable detailed logging in Hayase's DevTools console (Ctrl+Shift+I)
// Set back to false before publishing
const DEBUG_MODE = false

const log = {
  _fmt (level, msg, data) {
    if (!DEBUG_MODE) return
    const ts = new Date().toISOString()
    const prefix = `[AcgRip][${ts}][${level}]`
    const fn = level === 'ERROR' ? 'error' : level === 'WARN' ? 'warn' : 'log'
    data !== undefined ? console[fn](prefix, msg, data) : console[fn](prefix, msg)
  },
  info:  (msg, data) => log._fmt('INFO',  msg, data),
  warn:  (msg, data) => log._fmt('WARN',  msg, data),
  error: (msg, data) => log._fmt('ERROR', msg, data),
  debug: (msg, data) => log._fmt('DEBUG', msg, data),
}
// ─────────────────────────────────────────────────────────────────────────────

const DEFAULT_DOMAIN = 'https://acg.rip'

// Fetch timeout in ms
const TIMEOUT_MS = 15000

// Max retries on network failure
const MAX_RETRIES = 2

// Matches size strings like "1.5 GiB", "350 MB", etc.
const SIZE_RE = /([\d.]+)\s*(B|KB|MB|GB|TB|KiB|MiB|GiB|TiB)/i

// Matches resolution strings embedded in torrent titles
const RES_RE = /\b(2160p?|1080p?|720p?|540p?|480p?)\b/i

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Decode a raw RSS field value — strips CDATA wrappers and HTML entities.
 * @param {string} raw
 * @returns {string}
 */
function decodeText (raw) {
  return raw
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&lt;/g,   '<')
    .replace(/&gt;/g,   '>')
    .replace(/&amp;/g,  '&')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .trim()
}

/**
 * Extract the inner text of a named XML tag from an RSS item body.
 * Handles both plain and CDATA-wrapped content.
 * @param {string} body
 * @param {string} tag
 * @returns {string}
 */
function pickField (body, tag) {
  const re = new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`, 'i')
  const m = re.exec(body)
  return m ? decodeText(m[1]) : ''
}

/**
 * Extract the torrent URL from an <enclosure> tag.
 * acg.rip uses this to expose the .torrent file download link.
 * @param {string} body
 * @returns {string}
 */
function pickEnclosure (body) {
  const m = /<enclosure\b[^>]*\surl\s*=\s*"([^"]+)"/i.exec(body)
  return m ? decodeText(m[1]) : ''
}

/**
 * Parse a human-readable size string into bytes.
 * Handles both SI (KB/MB/GB) and binary (KiB/MiB/GiB) units.
 * @param {string} raw
 * @returns {number}
 */
function parseSize (raw) {
  if (!raw) return 0
  const m = SIZE_RE.exec(raw)
  if (!m) return 0
  const num = parseFloat(m[1])
  if (!Number.isFinite(num)) return 0
  const unit = m[2].toLowerCase()
  const mult = {
    b: 1,
    kb: 1000,      kib: 1024,
    mb: 1000 ** 2, mib: 1024 ** 2,
    gb: 1000 ** 3, gib: 1024 ** 3,
    tb: 1000 ** 4, tib: 1024 ** 4,
  }
  return Math.round(num * (mult[unit] ?? 1))
}

/**
 * Fetch the acg.rip RSS feed with timeout and retry logic.
 * Uses query.fetch (passed by Hayase) instead of global fetch —
 * required for CORS to work inside Hayase's sandboxed Web Worker.
 * @param {typeof fetch} fetchFn  — Hayase's fetch function from query.fetch
 * @param {string} domain
 * @param {string} term  — search term, empty string fetches the latest feed
 * @param {number} [retries]
 * @returns {Promise<Response>}
 */
async function fetchWithRetry (fetchFn, domain, term, retries = MAX_RETRIES) {
  const base = domain.replace(/\/+$/, '')
  const url = term
    ? `${base}/.xml?term=${encodeURIComponent(term)}`
    : `${base}/.xml`

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
      if (!res.ok) throw new Error(`acg.rip returned HTTP ${res.status}. The site may be down or blocked in your region.`)
      log.info('Fetch OK', { status: res.status, url })
      return res
    } catch (err) {
      clearTimeout(timer)
      log.warn(`Fetch failed (attempt ${attempt + 1})`, { url, error: err.message })
      if (attempt === retries) {
        if (err.name === 'AbortError') throw new Error(`acg.rip request timed out after ${TIMEOUT_MS / 1000}s. The site may be slow or blocked.`)
        throw new Error(`Could not reach acg.rip: ${err.message}`)
      }
      // Exponential backoff: 500ms, 1000ms
      const delay = 500 * (attempt + 1)
      log.debug(`Retrying in ${delay}ms...`)
      await new Promise(r => setTimeout(r, delay))
    }
  }
}

/**
 * Parse raw RSS XML into a flat array of item objects.
 * Size is extracted from the description first, then the title as a fallback
 * (some acg.rip releases embed size in the title string).
 * @param {string} xml
 * @returns {{ title: string, torrentUrl: string, pubDate: string, size: number }[]}
 */
function parseRSS (xml) {
  if (!xml.includes('<rss')) throw new Error('acg.rip returned a non-RSS response. The site may have changed or be blocking requests.')

  const out = []
  const itemRe = /<item>([\s\S]*?)<\/item>/g
  let m
  while ((m = itemRe.exec(xml)) !== null) {
    const body = m[1]
    const title      = pickField(body, 'title')
    const description = pickField(body, 'description')
    const torrentUrl = pickEnclosure(body)
    const pubDate    = pickField(body, 'pubDate')
    const size       = parseSize(description) || parseSize(title)

    if (!title) continue

    log.debug('Parsed RSS item', { title, torrentUrl, size })
    out.push({ title, torrentUrl, pubDate, size })
  }

  log.info('parseRSS complete', { total: out.length })
  return out
}

/**
 * Check whether a torrent title contains the given episode number.
 * Uses word-boundary-aware matching to avoid false positives on short numbers
 * (e.g. episode 1 matching "1080p").
 * @param {string} title
 * @param {number} episode
 * @returns {boolean}
 */
function titleMatchesEpisode (title, episode) {
  const padded  = String(episode).padStart(2, '0')
  const padded3 = String(episode).padStart(3, '0')
  const patterns = [
    `(?:^|[^\\d])${padded3}(?:[^\\d]|$)`,
    `[-–\\s]\\s*${padded}[\\s\\[\\]vV._(]`,
    `[Ee]${padded}[^\\d]`,
    `\\[${padded}\\]`,
  ]
  return patterns.some(p => new RegExp(p, 'i').test(title))
}

/**
 * Check whether a torrent title is plausibly related to any of the query titles.
 * Uses word-boundary matching to reduce false positives on short or common titles.
 * @param {string} title
 * @param {string[]} queryTitles
 * @returns {boolean}
 */
function titleMatchesAnime (title, queryTitles) {
  if (!queryTitles?.length) return true
  const lc = title.toLowerCase()
  return queryTitles.some(t => {
    if (!t) return false
    // For short titles (≤4 chars), require word boundaries to avoid false positives
    const escaped = t.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const pattern = t.length <= 4
      ? new RegExp(`(?:^|[^a-z0-9])${escaped}(?:[^a-z0-9]|$)`, 'i')
      : new RegExp(escaped, 'i')
    return pattern.test(lc)
  })
}

/**
 * Determine accuracy for a result based on title match and resolution match.
 * - 'medium' if the title matches (acg.rip is string-search only, never 'high')
 * - 'low' if the title doesn't match (can happen with short/ambiguous queries)
 * Resolution mismatch downgrades 'medium' → 'low' but never hard-excludes,
 * since acg.rip's catalog is small enough that a wrong-res result is still useful.
 * @param {string} title
 * @param {string[]} queryTitles
 * @param {string} resolution  — e.g. '1080', '720', ''
 * @returns {'medium' | 'low'}
 */
function pickAccuracy (title, queryTitles, resolution) {
  if (!titleMatchesAnime(title, queryTitles)) return 'low'
  if (resolution) {
    const resInTitle = RES_RE.exec(title)?.[1]?.replace('p', '') ?? ''
    if (resInTitle && resInTitle !== resolution) return 'low'
  }
  return 'medium'
}

/**
 * Filter out results whose titles contain any exclusion keyword.
 * Respects query.exclusions — e.g. if the environment doesn't support x265,
 * Hayase will add 'x265' to exclusions and we must honour it.
 * @param {{ title: string }[]} results
 * @param {string[]} exclusions
 * @returns {{ title: string }[]}
 */
function applyExclusions (results, exclusions) {
  if (!exclusions?.length) return results
  const lower = exclusions.map(e => e.toLowerCase())
  const filtered = results.filter(r => !lower.some(ex => r.title.toLowerCase().includes(ex)))
  log.debug('applyExclusions', { before: results.length, after: filtered.length, exclusions })
  return filtered
}

/**
 * Convert a raw RSS item into a TorrentResult.
 *
 * Hash trade-off:
 *   acg.rip's RSS does not expose the torrent infoHash — only a .torrent URL.
 *   Setting `hash` and `link` to the .torrent URL is intentional: Hayase/webtorrent
 *   accepts URLs as torrent identifiers in client.add(), so it fetches the .torrent
 *   file, parses the real infoHash from it, and uses that going forward (including
 *   for NZB extension lookups via _addNZBs). Trade-off: results from acg.rip won't
 *   dedupe with the same torrent surfaced by another extension that has the real
 *   hash ahead of time. Acceptable because acg.rip's catalog is largely CJK-tagged
 *   releases that rarely collide with other indexers.
 *
 * @param {{ title: string, torrentUrl: string, pubDate: string, size: number }} item
 * @param {string[]} queryTitles
 * @param {string} resolution
 * @returns {object | null}
 */
function toResult (item, queryTitles, resolution) {
  if (!item.torrentUrl) {
    log.warn('Skipped item (no torrentUrl)', { title: item.title })
    return null
  }
  return {
    title:     item.title,
    link:      item.torrentUrl,
    hash:      item.torrentUrl,  // see hash trade-off comment above
    size:      item.size,
    seeders:   0,
    leechers:  0,
    downloads: 0,
    accuracy:  pickAccuracy(item.title, queryTitles, resolution),
    date:      item.pubDate ? new Date(item.pubDate) : new Date(0),
  }
}

/**
 * Fetch, parse, and filter results for a given search term.
 * Applies episode matching, exclusions, and returns TorrentResult[].
 * @param {object} query  — AnimeQuery from Hayase
 * @param {string} domain
 * @param {string} term
 * @param {number | undefined} episode
 * @returns {Promise<object[]>}
 */
async function search (query, domain, term, episode) {
  if (!term) return []
  log.info('search()', { term, episode })

  const res  = await fetchWithRetry(query.fetch, domain, term)
  const xml  = await res.text()
  const items = parseRSS(xml)

  const results = []
  for (const item of items) {
    // Episode filter — skip items that clearly belong to a different episode
    if (episode != null && !titleMatchesEpisode(item.title, episode)) {
      log.debug('Skipped (episode mismatch)', { title: item.title, episode })
      continue
    }
    const r = toResult(item, query.titles, query.resolution || '')
    if (r) results.push(r)
  }

  const filtered = applyExclusions(results, query.exclusions)
  log.info('search() done', { term, rawCount: results.length, filteredCount: filtered.length })
  return filtered
}

/**
 * Try a list of query terms in order, returning results from the first hit.
 * This mirrors the fallback chain pattern in nyaasi.js — acg.rip's catalog is
 * smaller, so we want to try multiple title variants before giving up.
 * @param {object} query  — AnimeQuery from Hayase
 * @param {string} domain
 * @param {string[]} terms
 * @param {number | undefined} episode
 * @returns {Promise<object[]>}
 */
async function fetchFirstResults (query, domain, terms, episode) {
  for (const term of terms) {
    try {
      const results = await search(query, domain, term, episode)
      if (results.length > 0) {
        log.info('Term succeeded', { term, count: results.length })
        return results
      }
      log.info('Term returned 0 results, trying next', { term })
    } catch (err) {
      log.error('Term threw error', { term, error: err.message })
      throw err // Re-throw so Hayase can show the user-friendly message
    }
  }
  log.warn('All terms exhausted, returning empty')
  return []
}

// ─── Extension Export ─────────────────────────────────────────────────────────
// Exported as a plain object — no class, no inheritance.
// Hayase loads this directly from the bundled dist/acgrip.js file.

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
      const res = await fetchFn(`${DEFAULT_DOMAIN}/.xml`, { signal: controller.signal })
      if (!res.ok) throw new Error(`acg.rip returned HTTP ${res.status}. The site may be down or blocked in your region.`)
      log.info('test() passed')
      return true
    } catch (err) {
      if (err.name === 'AbortError') throw new Error(`acg.rip did not respond within ${TIMEOUT_MS / 1000}s. Check your network or whether the site is blocked.`)
      throw new Error(`Could not reach acg.rip: ${err.message}`)
    } finally {
      clearTimeout(timer)
    }
  },

  /**
   * Single episode search.
   * Tries title + episode number variants across all provided titles,
   * then falls back to title-only if episode-specific queries return nothing.
   */
  async single (query, options = {}) {
    log.info('single() called', { titles: query.titles, episode: query.episode, resolution: query.resolution })
    if (!query.titles?.length) return []

    const domain   = options.domain?.trim() || DEFAULT_DOMAIN
    const ep       = query.episode != null ? query.episode.toString() : null
    const epPadded = ep ? ep.padStart(2, '0') : null

    // Build query variants from most to least specific, across all title variants
    const terms = []
    for (const title of query.titles.slice(0, 3)) {
      if (!title) continue
      if (epPadded) {
        terms.push(`${title} ${epPadded}`)   // e.g. "進撃の巨人 01"
        terms.push(`${title} ${ep}`)         // e.g. "進撃の巨人 1" (for sites that don't zero-pad)
      }
      terms.push(title)                      // fallback: title only
    }

    return fetchFirstResults(query, domain, terms, query.episode)
  },

  /**
   * Batch search — looks for complete season packs.
   * Tries batch-specific terms first, then plain title fallbacks.
   * Marks results as type='batch' if they look like packs.
   */
  async batch (query, options = {}) {
    log.info('batch() called', { titles: query.titles, episodeCount: query.episodeCount })
    if (!query.titles?.length) return []

    const domain = options.domain?.trim() || DEFAULT_DOMAIN

    // Try batch-specific terms first, then plain title fallbacks
    const terms = []
    for (const title of query.titles.slice(0, 3)) {
      if (!title) continue
      terms.push(`${title} batch`)
      terms.push(`${title} complete`)
      terms.push(`${title} 合集`)    // Chinese: "collection/compilation"
      terms.push(title)
    }

    const results = await fetchFirstResults(query, domain, terms, undefined)

    // Prefer results that look like packs (episode range, batch keyword, or type already set)
    const packs = results.filter(r =>
      /batch|complete|合集|\d+\s*[-~]\s*\d+/i.test(r.title)
    )
    log.info('batch() pack filter', { before: results.length, after: packs.length })

    return packs.length ? packs.map(r => ({ ...r, type: 'batch' })) : results
  },

  /**
   * Movie search — same as single but without episode number logic.
   * Tries all provided title variants before giving up.
   */
  async movie (query, options = {}) {
    log.info('movie() called', { titles: query.titles, resolution: query.resolution })
    if (!query.titles?.length) return []

    const domain = options.domain?.trim() || DEFAULT_DOMAIN
    const terms  = query.titles.slice(0, 3).filter(Boolean)

    return fetchFirstResults(query, domain, terms, undefined)
  },
}
