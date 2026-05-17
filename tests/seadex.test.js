// tests/seadex.test.js
//
// Tests for src/seadex.js — extends BaseExtensionTest for shared requirements,
// then adds SeaDex-specific tests on top.
//
// Run: npx vitest run tests/seadex.test.js

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'
import BaseExtensionTest, { mockFetch, mockFetchError } from './BaseExtensionTest.js'

// ─── Fixture ──────────────────────────────────────────────────────────────────
const __dirname = dirname(fileURLToPath(import.meta.url))
const FIXTURE_JSON = readFileSync(join(__dirname, 'fixtures/seadex.json'), 'utf-8')

// Known values from the fixture
const PMR_HASH      = '143ed15e5e3df072ae91adaeb149973a887590dd'  // isBest: true, tracker: Nyaa
const LOSTYEARS_HASH = 'fb9ce1e001837de7662bd72b3fb79b3fea13d03f' // isBest: false, tracker: Nyaa
// Two torrents have infoHash: "<redacted>" — both should be skipped
const REDACTED_COUNT = 2
const TOTAL_COUNT    = 4 // 4 trs total, 2 redacted → 2 valid results

// PMR torrent: 2 files, sizes: 7500699108 + 7497267058
const PMR_EXPECTED_SIZE = 7500699108 + 7497267058

// ─── Import extension ─────────────────────────────────────────────────────────
const { default: seadex } = await import('../src/seadex.js')

// ─── Suite setup ─────────────────────────────────────────────────────────────

class SeaDexTest extends BaseExtensionTest {
  constructor () {
    super({
      extension:    seadex,
      // SeaDex is ID-based — makeQuery() provides anilistId: 12345 by default
      // which won't match the fixture (alID: 154587), so single() returns [].
      // We override fixtureFetch to always return the fixture for the base tests.
      fixtureFetch: () => mockFetch(FIXTURE_JSON),
      name:         'SeaDex',
    })
  }

  // Override makeQuery to include a valid anilistId matching the fixture
  makeQuery (overrides = {}) {
    return super.makeQuery({
      anilistId: 154587,
      titles:    ['Frieren: Beyond Journey\'s End'],
      ...overrides,
    })
  }
}

const suite = new SeaDexTest()
suite.runIdBased()

// ─── SeaDex-specific tests ────────────────────────────────────────────────────

describe('SeaDex — redacted torrents', () => {
  it('skips torrents with infoHash="<redacted>"', async () => {
    const results = await seadex.single({
      anilistId: 154587,
      titles: ['Frieren: Beyond Journey\'s End'],
      fetch: mockFetch(FIXTURE_JSON),
    })
    // 4 total, 2 redacted → should only return 2
    expect(results).toHaveLength(TOTAL_COUNT - REDACTED_COUNT)
  })

  it('never returns a result with hash containing "redacted"', async () => {
    const results = await seadex.single({
      anilistId: 154587,
      titles: ['Frieren: Beyond Journey\'s End'],
      fetch: mockFetch(FIXTURE_JSON),
    })
    for (const r of results) {
      expect(r.hash).not.toContain('redacted')
    }
  })
})

describe('SeaDex — isBest mapping', () => {
  it('maps isBest=true to type="best"', async () => {
    const results = await seadex.single({
      anilistId: 154587,
      titles: ['Frieren: Beyond Journey\'s End'],
      fetch: mockFetch(FIXTURE_JSON),
    })
    const pmr = results.find(r => r.hash === PMR_HASH)
    expect(pmr).toBeDefined()
    expect(pmr.type).toBe('best')
  })

  it('maps isBest=false to type="alt"', async () => {
    const results = await seadex.single({
      anilistId: 154587,
      titles: ['Frieren: Beyond Journey\'s End'],
      fetch: mockFetch(FIXTURE_JSON),
    })
    const lostyears = results.find(r => r.hash === LOSTYEARS_HASH)
    expect(lostyears).toBeDefined()
    expect(lostyears.type).toBe('alt')
  })
})

describe('SeaDex — accuracy', () => {
  it('always returns accuracy="high" since SeaDex is manually curated', async () => {
    const results = await seadex.single({
      anilistId: 154587,
      titles: ['Frieren: Beyond Journey\'s End'],
      fetch: mockFetch(FIXTURE_JSON),
    })
    for (const r of results) {
      expect(r.accuracy).toBe('high')
    }
  })
})

describe('SeaDex — size calculation', () => {
  it('calculates size as the sum of all file lengths', async () => {
    const results = await seadex.single({
      anilistId: 154587,
      titles: ['Frieren: Beyond Journey\'s End'],
      fetch: mockFetch(FIXTURE_JSON),
    })
    const pmr = results.find(r => r.hash === PMR_HASH)
    expect(pmr.size).toBe(PMR_EXPECTED_SIZE)
  })
})

describe('SeaDex — title building', () => {
  it('builds title as "[Group] ShowName [Dual Audio]" for multi-file dual audio torrents', async () => {
    const results = await seadex.single({
      anilistId: 154587,
      titles: ['Frieren: Beyond Journey\'s End'],
      fetch: mockFetch(FIXTURE_JSON),
    })
    const pmr = results.find(r => r.hash === PMR_HASH)
    expect(pmr.title).toContain('[PMR]')
    expect(pmr.title).toContain('[Dual Audio]')
  })
})

describe('SeaDex — magnet link', () => {
  it('builds a valid magnet URI with trackers', async () => {
    const results = await seadex.single({
      anilistId: 154587,
      titles: ['Frieren: Beyond Journey\'s End'],
      fetch: mockFetch(FIXTURE_JSON),
    })
    const pmr = results.find(r => r.hash === PMR_HASH)
    expect(pmr.link).toMatch(/^magnet:\?xt=urn:btih:[a-f0-9]{40}/)
    expect(pmr.link).toContain('&tr=')
  })
})

describe('SeaDex — missing anilistId', () => {
  it('throws when anilistId is not provided', async () => {
    await expect(
      seadex.single({
        anilistId: undefined,
        titles: ['Frieren: Beyond Journey\'s End'],
        fetch: mockFetch(FIXTURE_JSON),
      })
    ).rejects.toThrow()
  })
})

describe('SeaDex — empty results', () => {
  it('returns [] when SeaDex has no entry for the given AniList ID', async () => {
    const emptyFixture = JSON.stringify({ page: 1, perPage: 1, totalItems: -1, totalPages: -1, items: [] })
    const results = await seadex.single({
      anilistId: 999999999,
      titles: ['NonExistentAnime'],
      fetch: mockFetch(emptyFixture),
    })
    expect(results).toEqual([])
  })
})

describe('SeaDex — single/batch/movie return same results', () => {
  it('batch() returns the same results as single() since SeaDex is ID-based', async () => {
    const query = {
      anilistId: 154587,
      titles: ['Frieren: Beyond Journey\'s End'],
      episodeCount: 28,
    }
    const single = await seadex.single({ ...query, fetch: mockFetch(FIXTURE_JSON) })
    const batch  = await seadex.batch({ ...query, fetch: mockFetch(FIXTURE_JSON) })
    expect(batch.length).toBe(single.length)
  })
})
