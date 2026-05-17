// tests/nyaasi.test.js
//
// Tests for src/nyaasi.js — extends BaseExtensionTest for shared requirements,
// then adds Nyaa-specific tests on top.
//
// Run: npx vitest run tests/nyaasi.test.js

import { describe, it, expect, vi } from 'vitest'
import { readFileSync } from 'fs'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'
import BaseExtensionTest, { mockFetch, mockFetchError } from './BaseExtensionTest.js'

// ─── Fixture ──────────────────────────────────────────────────────────────────
const __dirname = dirname(fileURLToPath(import.meta.url))
const FIXTURE_XML = readFileSync(join(__dirname, 'fixtures/nyaasi.xml'), 'utf-8')

// Known values from the fixture — update these if you change the fixture
const FIRST_ITEM = {
  title: "[9volt] Sousou no Frieren - Season 2 (WEB 1080p HEVC EAC-3 Dual Audio) | Frieren: Beyond Journey's End (2026) (Batch S02 S2)",
  hash:  '2fd2133f28fbd29021b775c17c8e1cf5aceb9a15',
  seeders:   125,
  leechers:  23,
  downloads: 1316,
  size: Math.round(31.1 * 1024 ** 3), // 31.1 GiB in bytes
}

const EP9_HASH  = 'e738213eba3cb50034e8c37955d7f58c7b9ae53f'  // episode 9 item
const P480_HASH = '6d811a790cf3b42ed05f5832c65f80b3a8fb3134'  // 480p item
const NO_HASH_TITLE    = '[BadUpload] Frieren S2 - 01 (1080p)'         // should be skipped
const NON_ANIME_HASH   = 'aaaa133f28fbd29021b775c17c8e1cf5aceb9a15'   // category 3_1, should be skipped

// ─── Import extension ─────────────────────────────────────────────────────────
const { default: nyaasi } = await import('../src/nyaasi.js')

// ─── Suite setup ─────────────────────────────────────────────────────────────

class NyaasiTest extends BaseExtensionTest {
  constructor () {
    super({
      extension:    nyaasi,
      fixtureFetch: () => mockFetch(FIXTURE_XML),
      name:         'Nyaa',
    })
  }
}

// Register all shared BaseExtensionTest checks
const suite = new NyaasiTest()
suite.runStringSearch()

// ─── Nyaa-specific tests ──────────────────────────────────────────────────────

describe('Nyaa — RSS parsing', () => {
  it('extracts title, hash, seeders, leechers, downloads, size, date correctly', async () => {
    const results = await nyaasi.single({
      titles: ['Frieren'], episode: undefined, resolution: '', exclusions: [],
      fetch: mockFetch(FIXTURE_XML),
    })
    const first = results[0]
    expect(first.title).toBe(FIRST_ITEM.title)
    expect(first.hash).toBe(FIRST_ITEM.hash)
    expect(first.seeders).toBe(FIRST_ITEM.seeders)
    expect(first.leechers).toBe(FIRST_ITEM.leechers)
    expect(first.downloads).toBe(FIRST_ITEM.downloads)
    expect(first.size).toBeCloseTo(FIRST_ITEM.size, -6)
    expect(first.date).toBeInstanceOf(Date)
    expect(first.date.getFullYear()).toBe(2026)
  })

  it('clamps seeders and leechers >= 30000 to 0', async () => {
    const results = await nyaasi.single({
      titles: ['Frieren'], episode: undefined, resolution: '', exclusions: [],
      fetch: mockFetch(FIXTURE_XML),
    })
    const highSeeders = results.find(r => r.seeders >= 30000)
    expect(highSeeders).toBeUndefined()
  })

  it('skips items with empty infoHash', async () => {
    const results = await nyaasi.single({
      titles: ['Frieren'], episode: undefined, resolution: '', exclusions: [],
      fetch: mockFetch(FIXTURE_XML),
    })
    const bad = results.find(r => r.title === NO_HASH_TITLE)
    expect(bad).toBeUndefined()
  })

  it('skips items in non-anime categories (categoryId not starting with 1_)', async () => {
    const results = await nyaasi.single({
      titles: ['Frieren'], episode: undefined, resolution: '', exclusions: [],
      fetch: mockFetch(FIXTURE_XML),
    })
    const nonAnime = results.find(r => r.hash === NON_ANIME_HASH)
    expect(nonAnime).toBeUndefined()
  })

  it('marks batch titles with type="batch"', async () => {
    const results = await nyaasi.single({
      titles: ['Frieren'], episode: undefined, resolution: '', exclusions: [],
      fetch: mockFetch(FIXTURE_XML),
    })
    const batchResult = results.find(r => r.hash === FIRST_ITEM.hash)
    expect(batchResult?.type).toBe('batch')
  })
})

describe('Nyaa — resolution filtering', () => {
  it('filters out items not matching the requested resolution', async () => {
    const results = await nyaasi.single({
      titles: ['Frieren'], episode: undefined, resolution: '1080', exclusions: [],
      fetch: mockFetch(FIXTURE_XML),
    })
    const p480 = results.find(r => r.hash === P480_HASH)
    expect(p480).toBeUndefined()
  })

  it('returns 480p items when resolution is 480', async () => {
    const results = await nyaasi.single({
      titles: ['Frieren'], episode: undefined, resolution: '480', exclusions: [],
      fetch: mockFetch(FIXTURE_XML),
    })
    const p480 = results.find(r => r.hash === P480_HASH)
    expect(p480).toBeDefined()
  })

  it('returns more items when resolution is empty than when filtered', async () => {
    const all      = await nyaasi.single({ titles: ['Frieren'], episode: undefined, resolution: '',     exclusions: [], fetch: mockFetch(FIXTURE_XML) })
    const filtered = await nyaasi.single({ titles: ['Frieren'], episode: undefined, resolution: '1080', exclusions: [], fetch: mockFetch(FIXTURE_XML) })
    expect(all.length).toBeGreaterThan(filtered.length)
  })
})

describe('Nyaa — episode matching', () => {
  it('marks episode 9 items as accuracy="high" when episode=9', async () => {
    const results = await nyaasi.single({
      titles: ['Frieren'], episode: 9, resolution: '', exclusions: [],
      fetch: mockFetch(FIXTURE_XML),
    })
    const ep9 = results.find(r => r.hash === EP9_HASH)
    expect(ep9?.accuracy).toBe('high')
  })

  it('marks non-matching episode items as accuracy="medium"', async () => {
    const results = await nyaasi.single({
      titles: ['Frieren'], episode: 9, resolution: '', exclusions: [],
      fetch: mockFetch(FIXTURE_XML),
    })
    const batchItem = results.find(r => r.hash === FIRST_ITEM.hash)
    expect(batchItem?.accuracy).toBe('medium')
  })
})

describe('Nyaa — exclusions', () => {
  it('filters out results containing exclusion keywords', async () => {
    const results = await nyaasi.single({
      titles: ['Frieren'], episode: undefined, resolution: '', exclusions: ['480p'],
      fetch: mockFetch(FIXTURE_XML),
    })
    const p480 = results.find(r => r.hash === P480_HASH)
    expect(p480).toBeUndefined()
  })

  it('is case-insensitive for exclusion keywords', async () => {
    const results = await nyaasi.single({
      titles: ['Frieren'], episode: undefined, resolution: '', exclusions: ['HEVC'],
      fetch: mockFetch(FIXTURE_XML),
    })
    const hevc = results.find(r => r.hash === FIRST_ITEM.hash)
    expect(hevc).toBeUndefined()
  })
})

describe('Nyaa — keyword option', () => {
  it('appends keyword to the search query URL when set', async () => {
    const fetch = mockFetch(FIXTURE_XML)
    await nyaasi.single(
      { titles: ['Frieren'], episode: 1, resolution: '', exclusions: [], fetch },
      { keyword: 'Dubbed', domain: 'https://nyaa.si', filter: '0' }
    )
    expect(fetch.mock.calls[0][0]).toContain('Dubbed')
  })

  it('does not corrupt the URL when keyword is empty', async () => {
    const fetch = mockFetch(FIXTURE_XML)
    await nyaasi.single(
      { titles: ['Frieren'], episode: 1, resolution: '', exclusions: [], fetch },
      { keyword: '', domain: 'https://nyaa.si', filter: '0' }
    )
    expect(fetch.mock.calls[0][0]).not.toMatch(/\+\+|%20%20/)
  })

  it('uses the custom domain option in the request URL', async () => {
    const fetch = mockFetch(FIXTURE_XML)
    await nyaasi.single(
      { titles: ['Frieren'], episode: undefined, resolution: '', exclusions: [], fetch },
      { domain: 'https://nyaa.land', filter: '0', keyword: '' }
    )
    expect(fetch.mock.calls[0][0]).toContain('nyaa.land')
  })
})

describe('Nyaa — edge cases', () => {
  it('returns [] when fetch returns empty RSS', async () => {
    const emptyXml = `<rss xmlns:nyaa="https://nyaa.si/xmlns/nyaa" version="2.0"><channel></channel></rss>`
    const results = await nyaasi.single({
      titles: ['NonExistentAnimeXYZ123'], episode: undefined, resolution: '', exclusions: [],
      fetch: mockFetch(emptyXml),
    })
    expect(results).toEqual([])
  })

  it('throws a user-friendly error when Nyaa returns non-RSS', async () => {
    await expect(
      nyaasi.single({
        titles: ['Frieren'], episode: undefined, resolution: '', exclusions: [],
        fetch: mockFetch('<html>Blocked</html>'),
      })
    ).rejects.toThrow()
  })
})

describe('Nyaa — batch()', () => {
  it('appends batch keyword to the first search query URL', async () => {
    const fetch = mockFetch(FIXTURE_XML)
    await nyaasi.batch({
      titles: ['Frieren'], episodeCount: undefined, resolution: '', exclusions: [],
      fetch,
    })
    expect(fetch.mock.calls[0][0].toLowerCase()).toContain('batch')
  })
})
