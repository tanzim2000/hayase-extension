// animetosho.js — AnimeTosho torrent extension for Hayase
//
// AnimeTosho (feed.animetosho.org) is an automated mirror that indexes
// torrents from Nyaa, Tokyo Toshokan and AniDex, cross-referenced with
// AniDB IDs. This means searches are ID-based (not string-based), giving
// very accurate results.
//
// API: https://feed.animetosho.org/json
// Key parameters:
//   ?eid=ANIDB_EID        — single episode search by AniDB episode ID
//   ?aid=ANIDB_AID        — anime/batch search by AniDB anime ID
//   ?order=size-d         — sort by size descending (useful for batch)
//   &qx=1&q=!(...)        — exclusion query syntax
//
// Features:
//   - ID-based search (high accuracy)
//   - Resolution filtering via exclusion query
//   - 4K (2160p) support added
//   - Timeout + retry logic
//   - Proper error handling around res.json()
//   - Graceful handling of empty exclusions
//   - Debug logging (set DEBUG_MODE = true to enable)

// ─── Debug ────────────────────────────────────────────────────────────────────
// Set to true to enable detailed logging in Hayase's DevTools (Ctrl+Shift+I)
// Set back to false before publishing
const DEBUG_MODE = false

const log = {
  _fmt (level, msg, data) {
    if (!DEBUG_MODE) return
    const ts = new Date().toISOString()
    const prefix = `[AnimeTosho][${ts}][${level}]`
    const fn = level === 'ERROR' ? 'error' : level === 'WARN' ? 'warn' : 'log'
    data !== undefined ? console[fn](prefix, msg, data) : console[fn](prefix, msg)
  },
  info:  (msg, data) => log._fmt('INFO',  msg, data),
  warn:  (msg, data) => log._fmt('WARN',  msg, data),
  error: (msg, data) => log._fmt('ERROR', msg, data),
  debug: (msg, data) => log._fmt('DEBUG', msg, data),
}
// ─────────────────────────────────────────────────────────────────────────────

// AnimeTosho JSON feed URL (base64 encoded as per Hayase convention)
// Decoded: https://feed.animetosho.org/json
const API_URL = atob('aHR0cHM6Ly9mZWVkLmFuaW1ldG9zaG8ub3JnL2pzb24=')

// All known resolution tokens — used to build exclusion queries.
// When user wants 1080p, we exclude all other resolutions from results.
// 2160 added — was missing in original code.
const ALL_RESOLUTIONS = ['2160', '1080', '720', '540', '480']

// Fetch timeout in ms
const TIMEOUT_MS = 15000

// Max retries on network failure
const MAX_RETRIES = 2

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Build the AnimeTosho query string for exclusions and resolution filtering.
 *
 * AnimeTosho uses a custom query syntax:
 *   qx=1          — enable extended query mode
 *   q=!(...)      — exclude results matching these patterns
 *
 * Example: user wants 1080p, exclusions = ["x265"]
 *   q=!("x265"|*720*|*540*|*480*|*2160*)
 *
 * Fixed from original:
 *   - Empty exclusions array no longer produces malformed query !("")
 *   - 2160p now included in resolution list
 *
 * @param {string[]} exclusions   — keywords to exclude (from query.exclusions)
 * @param {string}   resolution   — desired resolution (from query.resolution)
 * @returns {string}
 */
function buildQuery (exclusions, resolution) {
  const parts = []

  // Add user-defined exclusion keywords (e.g. "x265", "web-dl")
  // Guard against empty array — original code produced !("") which is invalid
  if (exclusions?.length > 0) {
    parts.push(`"${exclusions.join('"|"')}"`)
  }

  // Add resolution exclusions — exclude all resolutions except the desired one
  // Only applies if user has a resolution preference set
  if (resolution) {
    const unwanted = ALL_RESOLUTIONS.filter(r => r !== resolution)
    parts.push(`*${unwanted.join('*|*')}*`)
  }

  // If nothing to exclude, return empty string (no qx param needed)
  if (parts.length === 0) return ''

  return `&qx=1&q=!(${parts.join('|')})`
}

/**
 * Fetch from AnimeTosho API with timeout and retry logic.
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
      if (!res.ok) throw new Error(`AnimeTosho returned HTTP ${res.status}. The API may be down or temporarily unavailable.`)
      log.info('Fetch OK', { status: res.status })
      return res
    } catch (err) {
      clearTimeout(timer)
      log.warn(`Fetch failed (attempt ${attempt + 1})`, { error: err.message })
      if (attempt === retries) {
        if (err.name === 'AbortError') throw new Error(`AnimeTosho did not respond within ${TIMEOUT_MS / 1000}s. Check your network connection.`)
        throw new Error(`Could not reach AnimeTosho: ${err.message}`)
      }
      // Exponential backoff: 500ms, 1000ms
      await new Promise(r => setTimeout(r, 500 * (attempt + 1)))
    }
  }
}

/**
 * Safely parse JSON from a Response object.
 * Original code called res.json() without try/catch — crashes silently
 * if the API returns non-JSON (e.g. on error pages or rate limiting).
 * @param {Response} res
 * @returns {Promise<any>}
 */
async function parseJSON (res) {
  try {
    return await res.json()
  } catch {
    throw new Error('AnimeTosho returned an unexpected response format. The API may have changed or be rate limiting requests.')
  }
}

/**
 * Map AnimeTosho API entries to Hayase TorrentResult objects.
 *
 * Notable fields from AnimeTosho API:
 *   entry.title           — torrent title (falls back to torrent_name)
 *   entry.magnet_uri      — magnet link
 *   entry.info_hash       — torrent info hash
 *   entry.total_size      — size in bytes
 *   entry.seeders         — seeder count (99999 = unknown)
 *   entry.leechers        — leecher count (99999 = unknown)
 *   entry.torrent_downloaded_count — download count
 *   entry.anidb_fid       — AniDB file ID (present = accurately matched)
 *   entry.timestamp       — Unix timestamp of upload
 *   entry.num_files       — number of files in torrent (useful for batch detection)
 *
 * @param {object[]} entries
 * @param {boolean} isBatch
 * @returns {object[]}
 */
function mapEntries (entries, isBatch = false) {
  return entries.map(entry => {
    const title = entry.title || entry.torrent_name || ''
    const hash = (entry.info_hash || '').toLowerCase()

    // AnimeTosho uses 99999 to indicate unknown peer counts — treat as 0
    const seeders  = (entry.seeders  || 0) >= 30000 ? 0 : (entry.seeders  || 0)
    const leechers = (entry.leechers || 0) >= 30000 ? 0 : (entry.leechers || 0)

    // anidb_fid being present means AnimeTosho matched this torrent to a
    // specific AniDB file record — very accurate. Otherwise medium accuracy.
    const accuracy = entry.anidb_fid ? 'high' : 'medium'

    log.debug('Mapped entry', { title, hash, accuracy, seeders, isBatch })

    return {
      title,
      link:      entry.magnet_uri || '',
      hash,
      size:      entry.total_size || 0,
      seeders,
      leechers,
      downloads: entry.torrent_downloaded_count || 0,
      accuracy,
      type:      isBatch ? 'batch' : undefined,
      date:      new Date((entry.timestamp || 0) * 1000), // Unix timestamp → Date
    }
  })
}

// ─── Extension Export ─────────────────────────────────────────────────────────

export default {

  /**
   * Health check — verifies AnimeTosho API is reachable.
   */
  async test (query) {
    log.info('test() called')
    const fetchFn = query?.fetch ?? fetch
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
    try {
      const res = await fetchFn(API_URL, { signal: controller.signal })
      clearTimeout(timer)
      if (!res.ok) throw new Error(`AnimeTosho returned HTTP ${res.status}. The API may be down.`)
      log.info('test() passed')
      return true
    } catch (err) {
      clearTimeout(timer)
      if (err.name === 'AbortError') throw new Error(`AnimeTosho did not respond within ${TIMEOUT_MS / 1000}s. Check your network connection.`)
      throw new Error(`Could not reach AnimeTosho: ${err.message}`)
    }
  },

  /**
   * Single episode search.
   * Uses AniDB episode ID (anidbEid) for precise per-episode matching.
   * Falls back to empty results if no anidbEid — AnimeTosho requires it.
   */
  async single (query) {
    const { anidbEid, resolution, exclusions } = query
    log.info('single() called', { anidbEid, resolution })

    // AnimeTosho requires an AniDB episode ID for single episode searches.
    // If Hayase doesn't have one, return empty rather than throwing —
    // other extensions (Nyaa) will handle it.
    if (!anidbEid) {
      log.warn('No anidbEid provided, skipping AnimeTosho single search')
      return []
    }

    const queryStr = buildQuery(exclusions, resolution)
    const url = `${API_URL}?eid=${anidbEid}${queryStr}`

    const res = await fetchWithRetry(query.fetch, url)
    const data = await parseJSON(res)

    if (!Array.isArray(data) || data.length === 0) return []

    log.info('single() results', { count: data.length })
    return mapEntries(data)
  },

  /**
   * Batch search.
   * Uses AniDB anime ID (anidbAid) and sorts by size descending —
   * batch packs are typically the largest files.
   * Filters to entries with at least episodeCount files.
   */
  async batch (query) {
    const { anidbAid, resolution, exclusions, episodeCount } = query
    log.info('batch() called', { anidbAid, episodeCount, resolution })

    if (!anidbAid) {
      log.warn('No anidbAid provided, skipping AnimeTosho batch search')
      return []
    }

    const queryStr = buildQuery(exclusions, resolution)
    // order=size-d — sort by size descending, batch packs are largest
    const url = `${API_URL}?order=size-d&aid=${anidbAid}${queryStr}`

    const res = await fetchWithRetry(query.fetch, url)
    const data = await parseJSON(res)

    if (!Array.isArray(data) || data.length === 0) return []

    // Filter to entries that have at least episodeCount files —
    // ensures we only return actual batch packs, not single episodes
    const batches = episodeCount != null
      ? data.filter(entry => (entry.num_files || 0) >= episodeCount)
      : data

    log.info('batch() results', { total: data.length, afterFilter: batches.length })
    return mapEntries(batches, true)
  },

  /**
   * Movie search.
   * Uses AniDB anime ID (anidbAid) — movies are single-entry shows in AniDB.
   */
  async movie (query) {
    const { anidbAid, resolution, exclusions } = query
    log.info('movie() called', { anidbAid, resolution })

    if (!anidbAid) {
      log.warn('No anidbAid provided, skipping AnimeTosho movie search')
      return []
    }

    const queryStr = buildQuery(exclusions, resolution)
    const url = `${API_URL}?aid=${anidbAid}${queryStr}`

    const res = await fetchWithRetry(query.fetch, url)
    const data = await parseJSON(res)

    if (!Array.isArray(data) || data.length === 0) return []

    log.info('movie() results', { count: data.length })
    return mapEntries(data)
  },
}
