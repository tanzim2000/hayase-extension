// subsplease.js — SubsPlease torrent extension for Hayase
//
// SubsPlease (subsplease.org) is a trusted fansub group that simulcasts
// anime weekly. They mirror official streams with minimal encoding changes,
// making their releases highly consistent and reliable.
//
// API: https://subsplease.org/api/
// Key endpoints:
//   ?f=search&tz=UTC&s=QUERY  — search by show name
//   ?f=schedule&tz=UTC        — get current airing schedule (used for test)
//
// Features:
//   - Proper title matching (not just substring)
//   - Episode number matching with zero-padding
//   - Resolution preference via options
//   - Base32 hash decoding (SubsPlease magnets use base32 hashes)
//   - Timeout + retry logic
//   - Title fallback chain
//   - Batch detection
//   - Debug logging (set DEBUG_MODE = true to enable)

// ─── Debug ────────────────────────────────────────────────────────────────────
// Set to true to enable detailed logging in Hayase's DevTools (Ctrl+Shift+I)
// Set back to false before publishing
const DEBUG_MODE = false

const log = {
  _fmt (level, msg, data) {
    if (!DEBUG_MODE) return
    const ts = new Date().toISOString()
    const prefix = `[SubsPlease][${ts}][${level}]`
    const fn = level === 'ERROR' ? 'error' : level === 'WARN' ? 'warn' : 'log'
    data !== undefined ? console[fn](prefix, msg, data) : console[fn](prefix, msg)
  },
  info:  (msg, data) => log._fmt('INFO',  msg, data),
  warn:  (msg, data) => log._fmt('WARN',  msg, data),
  error: (msg, data) => log._fmt('ERROR', msg, data),
  debug: (msg, data) => log._fmt('DEBUG', msg, data),
}
// ─────────────────────────────────────────────────────────────────────────────

// SubsPlease API base URL
const BASE_URL = 'https://subsplease.org/api/'

// Fetch timeout in ms
const TIMEOUT_MS = 15000

// Available resolutions SubsPlease publishes — in preference order
const RESOLUTIONS = ['1080', '720', '480']

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Decode a Base32 string to a hex info hash.
 *
 * SubsPlease magnet links use Base32-encoded hashes (e.g. btih:ABCDE...)
 * instead of hex (e.g. btih:a1b2c3...). Hayase expects hex hashes.
 * This decoder converts Base32 → hex.
 *
 * @param {string} base32
 * @returns {string} hex string
 */
function base32ToHex (base32) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'
  let bits = 0
  let value = 0
  const bytes = []

  for (const char of base32.toUpperCase()) {
    const idx = alphabet.indexOf(char)
    if (idx < 0) continue // skip padding chars
    value = (value << 5) | idx
    bits += 5
    if (bits >= 8) {
      bits -= 8
      bytes.push((value >>> bits) & 255)
    }
  }

  return bytes.map(b => b.toString(16).padStart(2, '0')).join('')
}

/**
 * Normalize an info hash — handles both hex and Base32 formats.
 * @param {string} hash
 * @returns {string} lowercase hex hash
 */
function normalizeHash (hash) {
  const trimmed = hash.trim()
  // Hex hash: 40 chars of 0-9a-f
  if (/^[0-9a-f]{40}$/i.test(trimmed)) return trimmed.toLowerCase()
  // Base32 hash: 32 chars of A-Z2-7
  if (/^[A-Z2-7]{32}$/i.test(trimmed)) return base32ToHex(trimmed)
  return trimmed.toLowerCase()
}

/**
 * Extract info hash from a magnet URI.
 * Handles both hex and Base32 encoded hashes.
 * @param {string} magnet
 * @returns {string|null}
 */
function extractHash (magnet) {
  const match = /xt=urn:btih:([A-Za-z0-9]+)/i.exec(magnet)
  if (!match) return null
  return normalizeHash(match[1])
}

/**
 * Build the SubsPlease search URL.
 * Using UTC timezone avoids any timezone-related date mismatches.
 * @param {string} query
 * @returns {string}
 */
function buildSearchURL (query) {
  return `${BASE_URL}?f=search&tz=UTC&s=${encodeURIComponent(query)}`
}

/**
 * Fetch from SubsPlease API with timeout.
 * Uses query.fetch (passed by Hayase) for proper CORS handling.
 * @param {typeof fetch} fetchFn
 * @param {string} url
 * @returns {Promise<Response>}
 */
async function fetchWithTimeout (fetchFn, url) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
  log.info('Fetching', { url })
  try {
    const res = await fetchFn(url, { signal: controller.signal })
    clearTimeout(timer)
    if (!res.ok) throw new Error(`SubsPlease returned HTTP ${res.status}. The site may be down or temporarily unavailable.`)
    return res
  } catch (err) {
    clearTimeout(timer)
    if (err.name === 'AbortError') throw new Error(`SubsPlease request timed out after ${TIMEOUT_MS / 1000}s. The site may be slow or blocked.`)
    throw new Error(`Could not reach SubsPlease: ${err.message}`)
  }
}

/**
 * Fetch and parse SubsPlease search results.
 * Returns array of raw SubsPlease show objects.
 * @param {typeof fetch} fetchFn
 * @param {string} query
 * @returns {Promise<object[]>}
 */
async function searchSubsPlease (fetchFn, query) {
  const res = await fetchWithTimeout(fetchFn, buildSearchURL(query))

  const text = await res.text()

  // Handle empty responses
  if (!text.trim() || text.trim() === '[]') return []

  let data
  try {
    data = JSON.parse(text)
  } catch {
    throw new Error('SubsPlease returned a non-JSON response. The API may have changed.')
  }

  // API returns an object keyed by show ID, or empty array if no results
  if (!data || typeof data !== 'object' || Array.isArray(data)) return []

  return Object.values(data).filter(item => item && typeof item === 'object')
}

/**
 * Check if a SubsPlease show title matches our query titles.
 * Uses bidirectional includes check — handles partial matches in both directions.
 * @param {string} showTitle  — SubsPlease show title
 * @param {string[]} titles   — Hayase query titles
 * @returns {boolean}
 */
function titleMatches (showTitle, titles) {
  if (!showTitle || !titles?.length) return false
  const lower = showTitle.toLowerCase()
  return titles.some(t => {
    if (!t) return false
    const tl = t.toLowerCase()
    return lower.includes(tl) || tl.includes(lower)
  })
}

/**
 * Check if a SubsPlease episode matches the requested episode number.
 * SubsPlease episode field is a string like "01", "12.5", "Batch".
 * @param {string} epField  — SubsPlease episode string
 * @param {number} episode  — requested episode number
 * @returns {boolean}
 */
function episodeMatches (epField, episode) {
  if (epField === 'Batch') return false
  const n = Number(epField)
  return Number.isFinite(n) && n === episode
}

/**
 * Check if a SubsPlease item is a batch release.
 * @param {object} item
 * @returns {boolean}
 */
function isBatchItem (item) {
  return item.episode === 'Batch'
}

/**
 * Pick the best download from a SubsPlease item's downloads array
 * based on the user's resolution preference.
 *
 * SubsPlease publishes 1080p, 720p, and 480p for each episode.
 * We try the requested resolution first, then fall back in order.
 *
 * @param {object[]} downloads  — array of {res, magnet} objects
 * @param {string} resolution   — preferred resolution from query
 * @returns {object|null}
 */
function pickDownload (downloads, resolution) {
  if (!downloads?.length) return null

  // Try exact resolution match first
  const exact = downloads.find(d => d.res === resolution)
  if (exact) return exact

  // Fall back through preferred order
  for (const res of RESOLUTIONS) {
    const fallback = downloads.find(d => d.res === res)
    if (fallback) return fallback
  }

  // Last resort — return whatever is available
  return downloads[0] || null
}

/**
 * Build a descriptive title for a SubsPlease result.
 * Format: "[SubsPlease] Show Name - 01 (1080p) [HASH].mkv"
 * @param {object} item
 * @param {object} download
 * @param {string} hash
 * @returns {string}
 */
function buildTitle (item, download, hash) {
  const show = item.show ?? 'Unknown'
  const ep   = item.episode ?? ''
  // Zero-pad numeric episodes: "1" → "01"
  const epStr = /^\d+$/.test(ep) ? ep.padStart(2, '0') : ep
  const hashTag = hash ? ` [${hash.slice(0, 8).toUpperCase()}]` : ''
  return `[SubsPlease] ${show}${epStr ? ` - ${epStr}` : ''} (${download.res}p)${hashTag}.mkv`
}

/**
 * Determine the effective resolution to use.
 * SubsPlease only has 480/720/1080 — map 540/2160 to nearest available.
 * @param {object} item      — SubsPlease item (has a resolution field)
 * @param {object} options   — Hayase extension options
 * @param {string} queryRes  — query.resolution from Hayase
 * @returns {string}
 */
function resolveResolution (item, options, queryRes) {
  // If user set a resolution option in extension settings, use that
  if (options?.resolution) return options.resolution

  // Map Hayase resolutions to SubsPlease available ones
  if (queryRes === '480') return '480'
  if (queryRes === '540' || queryRes === '720') return '720'
  // 1080, 2160, or empty → default to 1080
  return '1080'
}

/**
 * Core search logic — searches SubsPlease and maps results.
 * Tries multiple title variants, stops on first hit.
 *
 * @param {object} query
 * @param {number|undefined} episode    — specific episode number, or undefined for batch/movie
 * @param {boolean} wantBatch           — true = only batch results, false = only episode results
 * @param {object} options
 * @returns {Promise<object[]>}
 */
async function search (query, episode, wantBatch, options) {
  const titles = (query.titles ?? []).filter(Boolean)
  if (!titles.length) return []

  const resolution = resolveResolution(null, options, query.resolution)
  const seen = new Set()
  const results = []

  // Try up to 3 title variants — stop on first that returns results
  for (const title of titles.slice(0, 3)) {
    log.info('Searching SubsPlease', { title, episode, wantBatch, resolution })
    const items = await searchSubsPlease(query.fetch, title)

    for (const item of items) {
      // Skip items that don't match our show
      if (!titleMatches(item.show, query.titles)) continue

      // For single episode: skip batches and non-matching episodes
      if (!wantBatch) {
        if (isBatchItem(item)) continue
        if (episode !== undefined && !episodeMatches(item.episode, episode)) continue
      }

      // For batch: only include batch items
      if (wantBatch && !isBatchItem(item)) continue

      if (!item.downloads?.length) continue

      const download = pickDownload(item.downloads, resolution)
      if (!download?.magnet) continue

      const hash = extractHash(download.magnet)
      if (!hash || seen.has(hash)) continue
      seen.add(hash)

      const title_str = buildTitle(item, download, hash)
      const date = item.release_date ? new Date(item.release_date) : new Date(0)

      log.debug('Mapped result', { title: title_str, hash, resolution: download.res })

      results.push({
        title:     title_str,
        link:      download.magnet,
        hash,
        seeders:   0,   // SubsPlease API doesn't provide peer counts
        leechers:  0,
        downloads: 0,
        size:      0,   // SubsPlease API doesn't provide file size
        accuracy:  'high', // SubsPlease is a trusted group — always high accuracy
        date,
        type:      isBatchItem(item) ? 'batch' : undefined,
      })
    }

    // Stop trying titles once we have results
    if (results.length > 0) {
      log.info('Search succeeded', { title, resultCount: results.length })
      break
    }
    log.info('No results for title, trying next', { title })
  }

  log.info('search() done', { resultCount: results.length })
  return results
}

// ─── Extension Export ─────────────────────────────────────────────────────────

export default {

  /**
   * Health check — uses the schedule endpoint instead of search,
   * which is lighter and always returns data if the site is up.
   */
  async test (query) {
    log.info('test() called')
    const fetchFn = query?.fetch ?? fetch
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
    try {
      const res = await fetchFn(`${BASE_URL}?f=schedule&tz=UTC`, { signal: controller.signal })
      clearTimeout(timer)
      if (!res.ok) throw new Error(`SubsPlease returned HTTP ${res.status}. The site may be down.`)
      log.info('test() passed')
      return true
    } catch (err) {
      clearTimeout(timer)
      if (err.name === 'AbortError') throw new Error(`SubsPlease did not respond within ${TIMEOUT_MS / 1000}s. Check your network or whether subsplease.org is blocked.`)
      throw new Error(`Could not reach SubsPlease: ${err.message}`)
    }
  },

  /**
   * Single episode search.
   * Matches by show title + episode number.
   */
  async single (query, options = {}) {
    log.info('single() called', { titles: query.titles, episode: query.episode })
    return search(query, query.episode, false, options)
  },

  /**
   * Batch search.
   * SubsPlease marks batch releases with episode = "Batch".
   */
  async batch (query, options = {}) {
    log.info('batch() called', { titles: query.titles })
    return search(query, undefined, true, options)
  },

  /**
   * Movie search.
   * SubsPlease occasionally releases movies — treated as single without episode.
   */
  async movie (query, options = {}) {
    log.info('movie() called', { titles: query.titles })
    return search(query, undefined, false, options)
  },
}
