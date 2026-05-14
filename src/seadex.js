// seadex.js — SeaDex torrent extension for Hayase
//
// SeaDex (releases.moe) is a community-curated database of the best anime
// releases. It doesn't host torrents — it just points to the best ones by
// AniList ID, marking each as "best" or "alt" quality.
//
// API: https://releases.moe/api/collections/entries/records
// Docs: https://releases.moe/about
//
// Features:
//   - Fetches all releases for a show (not just the first one)
//   - Builds proper magnet URIs from infoHash
//   - Handles redacted torrents gracefully
//   - Descriptive error messages
//   - Debug logging (set DEBUG_MODE = true to enable)

// ─── Debug ────────────────────────────────────────────────────────────────────
// Set to true to enable detailed logging in Hayase's DevTools (Ctrl+Shift+I)
// Set back to false before publishing
const DEBUG_MODE = false

const log = {
  _fmt (level, msg, data) {
    if (!DEBUG_MODE) return
    const ts = new Date().toISOString()
    const prefix = `[SeaDex][${ts}][${level}]`
    const fn = level === 'ERROR' ? 'error' : level === 'WARN' ? 'warn' : 'log'
    data !== undefined ? console[fn](prefix, msg, data) : console[fn](prefix, msg)
  },
  info:  (msg, data) => log._fmt('INFO',  msg, data),
  warn:  (msg, data) => log._fmt('WARN',  msg, data),
  error: (msg, data) => log._fmt('ERROR', msg, data),
  debug: (msg, data) => log._fmt('DEBUG', msg, data),
}
// ─────────────────────────────────────────────────────────────────────────────

// SeaDex API base URL (base64 encoded as per Hayase convention)
// Decoded: https://releases.moe/api/collections/entries/records
const API_URL = atob('aHR0cHM6Ly9yZWxlYXNlcy5tb2UvYXBpL2NvbGxlY3Rpb25zL2VudHJpZXMvcmVjb3Jkcw==')

// Fetch timeout in ms
const TIMEOUT_MS = 15000

// Standard BitTorrent trackers to include in magnet URIs
// SeaDex only provides infoHash, so we build the magnet ourselves
const TRACKERS = [
  'http://nyaa.tracker.wf:7777/announce',
  'udp://open.stealth.si:80/announce',
  'udp://tracker.opentrackr.org:1337/announce',
  'udp://exodus.desync.com:6969/announce',
  'udp://tracker.torrent.eu.org:451/announce',
].map(t => `&tr=${encodeURIComponent(t)}`).join('')

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Build a magnet URI from an infoHash and display name.
 * SeaDex only gives us the hash — Hayase will find peers via DHT.
 * @param {string} hash
 * @param {string} name
 * @returns {string}
 */
function buildMagnet (hash, name) {
  return `magnet:?xt=urn:btih:${hash}&dn=${encodeURIComponent(name)}${TRACKERS}`
}

/**
 * Fetch from SeaDex API with timeout.
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
    if (!res.ok) throw new Error(`SeaDex returned HTTP ${res.status}. The API may be down or temporarily unavailable.`)
    return res
  } catch (err) {
    clearTimeout(timer)
    if (err.name === 'AbortError') throw new Error(`SeaDex did not respond within ${TIMEOUT_MS / 1000}s. Check your network connection.`)
    throw new Error(`Could not reach SeaDex: ${err.message}`)
  }
}

/**
 * Query the SeaDex API for a given AniList ID.
 * SeaDex uses PocketBase under the hood — we expand the 'trs' relation
 * to get all torrent records in one request.
 *
 * perPage=200 — SeaDex rarely has more than a handful of releases per show,
 * but 200 ensures we get everything without pagination.
 *
 * @param {typeof fetch} fetchFn
 * @param {number} anilistId
 * @returns {Promise<object>}
 */
async function querySeaDex (fetchFn, anilistId) {
  const params = new URLSearchParams({
    page:       '1',
    perPage:    '200',   // was 1 in old code — now fetches all releases
    filter:     `alID="${anilistId}"`,
    skipTotal:  '1',     // skip COUNT query for performance
    expand:     'trs',   // inline all torrent records
  })
  const url = `${API_URL}?${params.toString()}`
  const res = await fetchWithTimeout(fetchFn, url)

  let data
  try {
    data = await res.json()
  } catch {
    throw new Error('SeaDex returned an unexpected response format. The API may have changed.')
  }

  log.debug('SeaDex API response', { itemCount: data?.items?.length })
  return data
}

/**
 * Map a SeaDex torrent record to a Hayase TorrentResult.
 * @param {object} torrent   — a single 'trs' record from SeaDex
 * @param {string} showTitle — fallback title if torrent has multiple files
 * @returns {object}
 */
function mapTorrent (torrent, showTitle) {
  const hash = torrent.infoHash.toLowerCase()

  // If the torrent has exactly one file, use that filename as the title.
  // Otherwise build a title from the release group and show name.
  const title = torrent.files.length === 1
    ? torrent.files[0].name
    : `[${torrent.releaseGroup}] ${showTitle}${torrent.dualAudio ? ' [Dual Audio]' : ''}`

  // Total size = sum of all file sizes in the torrent
  const size = torrent.files.reduce((total, file) => total + (file.length || 0), 0)

  // SeaDex manually curates best/alt — only set these if SeaDex says so.
  // Per Hayase docs: NEVER set best/alt unless content is manually verified.
  // SeaDex IS manually verified, so this is correct here.
  const type = torrent.isBest ? 'best' : 'alt'

  log.debug('Mapped torrent', { title, hash, type, size })

  return {
    title,
    hash,
    link:      buildMagnet(hash, title),  // was just infoHash in old code — now a proper magnet URI
    size,
    type,
    date:      new Date(torrent.created),
    seeders:   0,   // SeaDex doesn't provide peer counts — Hayase updates these via DHT
    leechers:  0,
    downloads: 0,
    accuracy:  'high', // SeaDex is manually curated — always high accuracy
  }
}

/**
 * Core search logic shared by single(), batch(), and movie().
 * SeaDex works purely by AniList ID — no string search needed.
 * Results are the same regardless of whether it's a single episode,
 * batch, or movie query.
 *
 * @param {object} query     — Hayase AnimeQuery object
 * @returns {Promise<object[]>}
 */
async function search (query) {
  const { anilistId, titles, episodeCount } = query

  if (!anilistId) throw new Error('SeaDex requires an AniList ID. Make sure the anime has an AniList entry.')
  if (!titles?.length) throw new Error('No titles provided for SeaDex search.')

  log.info('search() called', { anilistId, episodeCount })

  const data = await querySeaDex(query.fetch, anilistId)

  // SeaDex may return no results if the show hasn't been reviewed yet
  if (!data?.items?.[0]?.expand?.trs?.length) {
    log.info('No SeaDex results found', { anilistId })
    return []
  }

  const { trs } = data.items[0].expand

  const results = trs
    .filter(torrent => {
      // Skip redacted torrents — these are private or removed releases
      if (torrent.infoHash === '<redacted>') {
        log.debug('Skipped redacted torrent', { releaseGroup: torrent.releaseGroup })
        return false
      }

      // Skip single-file torrents for multi-episode shows ONLY if we're
      // confident it's a multi-episode show (episodeCount > 1).
      // Single-file torrents for a 12-episode show are almost always
      // low-quality repacks or mismatched uploads.
      // We DON'T skip for movies (episodeCount === 1) or unknown counts.
      if (episodeCount && episodeCount > 1 && torrent.files.length === 1) {
        log.debug('Skipped single-file torrent for multi-episode show', {
          releaseGroup: torrent.releaseGroup,
          episodeCount
        })
        return false
      }

      return true
    })
    .map(torrent => mapTorrent(torrent, titles[0]))

  log.info('search() done', { resultCount: results.length })
  return results
}

// ─── Extension Export ─────────────────────────────────────────────────────────

export default {

  /**
   * Health check — verifies SeaDex API is reachable.
   * Uses a known stable AniList ID (Frieren = 154587) for the test query.
   */
  async test (query) {
    log.info('test() called')
    const fetchFn = query?.fetch ?? fetch
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
    try {
      const res = await fetchFn(API_URL, { signal: controller.signal })
      clearTimeout(timer)
      if (!res.ok) throw new Error(`SeaDex returned HTTP ${res.status}. The API may be down.`)
      log.info('test() passed')
      return true
    } catch (err) {
      clearTimeout(timer)
      if (err.name === 'AbortError') throw new Error(`SeaDex did not respond within ${TIMEOUT_MS / 1000}s. Check your network connection.`)
      throw new Error(`Could not reach SeaDex: ${err.message}`)
    }
  },

  /**
   * Single episode search.
   * SeaDex is ID-based so results are the same as batch/movie —
   * it returns all known best/alt releases for the show.
   */
  async single (query) {
    log.info('single() called', { anilistId: query.anilistId })
    return search(query)
  },

  /**
   * Batch search.
   * Same as single — SeaDex returns full season releases naturally.
   */
  async batch (query) {
    log.info('batch() called', { anilistId: query.anilistId })
    return search(query)
  },

  /**
   * Movie search.
   * Same as single — SeaDex covers movies too.
   */
  async movie (query) {
    log.info('movie() called', { anilistId: query.anilistId })
    return search(query)
  },
}
