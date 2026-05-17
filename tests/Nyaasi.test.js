// tests/nyaasi.test.js
//
// Unit tests for src/nyaasi.js
//
// Strategy:
//   - No live network calls — query.fetch is always mocked
//   - Fixture XML loaded from tests/fixtures/nyaasi.xml (real Nyaa response)
//   - We test the exported default object's methods AND the internal helpers
//     by importing them directly (esbuild doesn't tree-shake named exports
//     in dev, and we test src/ not dist/)
//
// Run with: npx vitest run tests/nyaasi.test.js

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { readFileSync } from 'fs'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'

// ─── Load fixture ─────────────────────────────────────────────────────────────
const __dirname = dirname(fileURLToPath(import.meta.url))
const FIXTURE_XML = readFileSync(join(__dirname, 'fixtures/nyaasi.xml'), 'utf-8')

// Known values from the fixture — update these if you change the fixture
const FIRST_ITEM = {
  title: "[9volt] Sousou no Frieren - Season 2 (WEB 1080p HEVC EAC-3 Dual Audio) | Frieren: Beyond Journey's End (2026) (Batch S02 S2)",
  hash:  '2fd2133f28fbd29021b775c17c8e1cf5aceb9a15',
  seeders: 125,
  leechers: 23,
  downloads: 1316,
  // 31.1 GiB in bytes
  size: Math.round(31.1 * 1024 ** 3),
  pubDate: 'Tue, 05 May 2026 20:50:27 -0000',
}

const EP9_HASH  = 'e738213eba3cb50034e8c37955d7f58c7b9ae53f'  // episode 9 item
const P480_HASH = '6d811a790cf3b42ed05f5832c65f80b3a8fb3134'  // 480p item
const NO_HASH_TITLE = '[BadUpload] Frieren S2 - 01 (1080p)'   // should be skipped
const NON_ANIME_HASH = 'aaaa133f28fbd29021b775c17c8e1cf5aceb9a15' // category 3_1, should be skipped

// ─── Mock fetch helper ────────────────────────────────────────────────────────

/**
 * Create a mock fetch function that returns the given body string.
 * @param {string} body
 * @param {number} status
 */
function mockFetch(body, status = 200) {
  return vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    text: () => Promise.resolve(body),
    json: () => Promise.resolve(JSON.parse(body)),
  })
}

/**
 * Create a mock fetch function that rejects (network error).
 * @param {string} message
 */
function mockFetchError(message = 'Network error') {
  return vi.fn().mockRejectedValue(new Error(message))
}

// ─── Import source ────────────────────────────────────────────────────────────
// We import the source file directly (not dist/) so we test the real code.
// Vitest handles ESM natively.
const { default: nyaasi } = await import('../src/nyaasi.js')

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('nyaasi — parseRSS (via single())', () => {
  it('extracts title, hash, seeders, leechers, downloads, size, date from a standard item', async () => {
    const fetch = mockFetch(FIXTURE_XML)
    const results = await nyaasi.single({
      titles: ['Frieren'],
      episode: undefined,
      resolution: '',
      exclusions: [],
      fetch,
    })

    const first = results[0]
    expect(first.title).toBe(FIRST_ITEM.title)
    expect(first.hash).toBe(FIRST_ITEM.hash)
    expect(first.seeders).toBe(FIRST_ITEM.seeders)
    expect(first.leechers).toBe(FIRST_ITEM.leechers)
    expect(first.downloads).toBe(FIRST_ITEM.downloads)
    // Size within 1% tolerance for floating point GiB conversion
    expect(first.size).toBeCloseTo(FIRST_ITEM.size, -6)
    expect(first.date).toBeInstanceOf(Date)
    expect(first.date.getFullYear()).toBe(2026)
  })

  it('clamps seeders and leechers >= 30000 to 0', async () => {
    const fetch = mockFetch(FIXTURE_XML)
    const results = await nyaasi.single({
      titles: ['Frieren'],
      episode: undefined,
      resolution: '',
      exclusions: [],
      fetch,
    })
    // The fixture has one item with seeders=99999, leechers=99999
    const clamped = results.find(r => r.hash === EP9_HASH)
    // This hash appears on the 99999 seeders item AND the episode 9 item —
    // the 99999 one comes first in the fixture
    const highSeeders = results.find(r => r.seeders === 99999)
    expect(highSeeders).toBeUndefined() // should be clamped, never 99999
  })

  it('skips items with empty infoHash', async () => {
    const fetch = mockFetch(FIXTURE_XML)
    const results = await nyaasi.single({
      titles: ['Frieren'],
      episode: undefined,
      resolution: '',
      exclusions: [],
      fetch,
    })
    const bad = results.find(r => r.title === NO_HASH_TITLE)
    expect(bad).toBeUndefined()
  })

  it('skips items in non-anime categories (categoryId not starting with 1_)', async () => {
    const fetch = mockFetch(FIXTURE_XML)
    const results = await nyaasi.single({
      titles: ['Frieren'],
      episode: undefined,
      resolution: '',
      exclusions: [],
      fetch,
    })
    const nonAnime = results.find(r => r.hash === NON_ANIME_HASH)
    expect(nonAnime).toBeUndefined()
  })

  it('builds a valid magnet link with infoHash', async () => {
    const fetch = mockFetch(FIXTURE_XML)
    const results = await nyaasi.single({
      titles: ['Frieren'],
      episode: undefined,
      resolution: '',
      exclusions: [],
      fetch,
    })
    expect(results[0].link).toMatch(/^magnet:\?xt=urn:btih:[a-f0-9]{40}/)
  })

  it('marks batch results with type="batch"', async () => {
    const fetch = mockFetch(FIXTURE_XML)
    const results = await nyaasi.single({
      titles: ['Frieren'],
      episode: undefined,
      resolution: '',
      exclusions: [],
      fetch,
    })
    // First item in fixture contains "Batch" in the title
    const batchResult = results.find(r => r.hash === FIRST_ITEM.hash)
    expect(batchResult?.type).toBe('batch')
  })
})

describe('nyaasi — resolution filtering', () => {
  it('filters out items not matching the requested resolution', async () => {
    const fetch = mockFetch(FIXTURE_XML)
    const results = await nyaasi.single({
      titles: ['Frieren'],
      episode: undefined,
      resolution: '1080',
      exclusions: [],
      fetch,
    })
    // 480p item should be excluded
    const p480 = results.find(r => r.hash === P480_HASH)
    expect(p480).toBeUndefined()
  })

  it('returns 480p items when resolution is 480', async () => {
    const fetch = mockFetch(FIXTURE_XML)
    const results = await nyaasi.single({
      titles: ['Frieren'],
      episode: undefined,
      resolution: '480',
      exclusions: [],
      fetch,
    })
    const p480 = results.find(r => r.hash === P480_HASH)
    expect(p480).toBeDefined()
  })

  it('returns all items when resolution is empty', async () => {
    const fetch = mockFetch(FIXTURE_XML)
    const allResults = await nyaasi.single({
      titles: ['Frieren'],
      episode: undefined,
      resolution: '',
      exclusions: [],
      fetch,
    })
    const filteredResults = await nyaasi.single({
      titles: ['Frieren'],
      episode: undefined,
      resolution: '1080',
      exclusions: [],
      fetch: mockFetch(FIXTURE_XML),
    })
    expect(allResults.length).toBeGreaterThan(filteredResults.length)
  })
})

describe('nyaasi — episode matching', () => {
  it('marks episode 9 items as accuracy="high" when episode=9', async () => {
    const fetch = mockFetch(FIXTURE_XML)
    const results = await nyaasi.single({
      titles: ['Frieren'],
      episode: 9,
      resolution: '',
      exclusions: [],
      fetch,
    })
    const ep9 = results.find(r => r.hash === EP9_HASH)
    expect(ep9?.accuracy).toBe('high')
  })

  it('marks non-matching episode items as accuracy="medium"', async () => {
    const fetch = mockFetch(FIXTURE_XML)
    const results = await nyaasi.single({
      titles: ['Frieren'],
      episode: 9,
      resolution: '',
      exclusions: [],
      fetch,
    })
    // Batch item doesn't contain "- 09" pattern — should be medium
    const batchItem = results.find(r => r.hash === FIRST_ITEM.hash)
    expect(batchItem?.accuracy).toBe('medium')
  })
})

describe('nyaasi — exclusions', () => {
  it('filters out results containing exclusion keywords', async () => {
    const fetch = mockFetch(FIXTURE_XML)
    const results = await nyaasi.single({
      titles: ['Frieren'],
      episode: undefined,
      resolution: '',
      exclusions: ['480p'],
      fetch,
    })
    const p480 = results.find(r => r.hash === P480_HASH)
    expect(p480).toBeUndefined()
  })

  it('is case-insensitive for exclusion keywords', async () => {
    const fetch = mockFetch(FIXTURE_XML)
    const results = await nyaasi.single({
      titles: ['Frieren'],
      episode: undefined,
      resolution: '',
      exclusions: ['HEVC'],
      fetch,
    })
    // First item contains "HEVC" — should be excluded
    const hevc = results.find(r => r.hash === FIRST_ITEM.hash)
    expect(hevc).toBeUndefined()
  })

  it('returns all results when exclusions is empty', async () => {
    const fetch = mockFetch(FIXTURE_XML)
    const withExclusions = await nyaasi.single({
      titles: ['Frieren'],
      episode: undefined,
      resolution: '',
      exclusions: ['480p'],
      fetch,
    })
    const withoutExclusions = await nyaasi.single({
      titles: ['Frieren'],
      episode: undefined,
      resolution: '',
      exclusions: [],
      fetch: mockFetch(FIXTURE_XML),
    })
    expect(withoutExclusions.length).toBeGreaterThan(withExclusions.length)
  })
})

describe('nyaasi — keyword option', () => {
  it('appends keyword to every search query when set', async () => {
    const fetch = mockFetch(FIXTURE_XML)
    await nyaasi.single(
      { titles: ['Frieren'], episode: 1, resolution: '', exclusions: [], fetch },
      { keyword: 'Dubbed', domain: 'https://nyaa.si', filter: '0' }
    )
    // Verify the URL called contains "Dubbed"
    const calledUrl = fetch.mock.calls[0][0]
    expect(calledUrl).toContain('Dubbed')
  })

  it('does not append keyword when keyword is empty', async () => {
    const fetch = mockFetch(FIXTURE_XML)
    await nyaasi.single(
      { titles: ['Frieren'], episode: 1, resolution: '', exclusions: [], fetch },
      { keyword: '', domain: 'https://nyaa.si', filter: '0' }
    )
    const calledUrl = fetch.mock.calls[0][0]
    // URL should not have double spaces or trailing space before &
    expect(calledUrl).not.toMatch(/\+\+|%20%20/)
  })

  it('uses the custom domain option in the request URL', async () => {
    const fetch = mockFetch(FIXTURE_XML)
    await nyaasi.single(
      { titles: ['Frieren'], episode: undefined, resolution: '', exclusions: [], fetch },
      { domain: 'https://nyaa.land', filter: '0', keyword: '' }
    )
    const calledUrl = fetch.mock.calls[0][0]
    expect(calledUrl).toContain('nyaa.land')
  })
})

describe('nyaasi — edge cases', () => {
  it('returns [] when titles is empty', async () => {
    const fetch = mockFetch(FIXTURE_XML)
    const results = await nyaasi.single({
      titles: [],
      episode: undefined,
      resolution: '',
      exclusions: [],
      fetch,
    })
    expect(results).toEqual([])
    expect(fetch).not.toHaveBeenCalled()
  })

  it('returns [] when fetch returns 0 results', async () => {
    const emptyXml = `<rss xmlns:nyaa="https://nyaa.si/xmlns/nyaa" version="2.0"><channel></channel></rss>`
    const fetch = mockFetch(emptyXml)
    const results = await nyaasi.single({
      titles: ['NonExistentAnimeXYZ123'],
      episode: undefined,
      resolution: '',
      exclusions: [],
      fetch,
    })
    expect(results).toEqual([])
  })

  it('throws a user-friendly error when the site is unreachable', async () => {
    const fetch = mockFetchError('Failed to fetch')
    await expect(
      nyaasi.single({
        titles: ['Frieren'],
        episode: undefined,
        resolution: '',
        exclusions: [],
        fetch,
      })
    ).rejects.toThrow('Could not reach Nyaa')
  })

  it('throws a user-friendly error when Nyaa returns non-200', async () => {
    const fetch = mockFetch('Service Unavailable', 503)
    await expect(
      nyaasi.single({
        titles: ['Frieren'],
        episode: undefined,
        resolution: '',
        exclusions: [],
        fetch,
      })
    ).rejects.toThrow('HTTP 503')
  })
})

describe('nyaasi — batch()', () => {
  it('marks results as type="batch"', async () => {
    const fetch = mockFetch(FIXTURE_XML)
    const results = await nyaasi.batch({
      titles: ['Frieren'],
      episodeCount: undefined,
      resolution: '',
      exclusions: [],
      fetch,
    })
    // Every result returned by batch() should have type='batch'
    const nonBatch = results.filter(r => r.type !== 'batch')
    expect(nonBatch).toHaveLength(0)
  })

  it('appends "Batch" keyword to the first search query', async () => {
    const fetch = mockFetch(FIXTURE_XML)
    await nyaasi.batch({
      titles: ['Frieren'],
      episodeCount: undefined,
      resolution: '',
      exclusions: [],
      fetch,
    })
    const calledUrl = fetch.mock.calls[0][0]
    expect(calledUrl.toLowerCase()).toContain('batch')
  })
})

describe('nyaasi — test()', () => {
  it('returns true when Nyaa is reachable', async () => {
    const query = { fetch: mockFetch(FIXTURE_XML) }
    const result = await nyaasi.test(query)
    expect(result).toBe(true)
  })

  it('throws when Nyaa returns non-200', async () => {
    const query = { fetch: mockFetch('', 503) }
    await expect(nyaasi.test(query)).rejects.toThrow('HTTP 503')
  })
})
