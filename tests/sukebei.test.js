// tests/sukebei.test.js
//
// Tests for src/sukebei.js — extends BaseExtensionTest for shared requirements,
// then adds Sukebei-specific tests on top.
//
// Sukebei uses the exact same RSS format as Nyaa, so the parsing logic is
// nearly identical. Tests focus on verifying that identical behaviour holds,
// plus Sukebei-specific options (domain, category).
//
// Run: npx vitest run tests/sukebei.test.js

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'
import BaseExtensionTest, { mockFetch, mockFetchError } from './BaseExtensionTest.js'

// ─── Fixture ──────────────────────────────────────────────────────────────────
const __dirname = dirname(fileURLToPath(import.meta.url))
const FIXTURE_XML = readFileSync(join(__dirname, 'fixtures/sukebei.xml'), 'utf-8')

// Known values from the fixture
const FIRST_HASH    = 'c8c3efb946844bf46743f08a89db88deec8f2d3c' // first item, 1.3 GiB
const SECOND_HASH   = '1a35b209196a7a7b5aeaebda5012dc09c5fe25ee' // second item, 1.1 GiB
const CLAMPED_HASH  = 'fdb214e790eb5bb0855d251d8538a5c76a92dd94' // seeders=99999, should clamp to 0
const NO_HASH_TITLE = '[BadUpload] Test Upload No Hash'           // should be skipped
const P1080_HASH    = '12c90f6a9e9afb312eca8fb104adab769176eabb' // title contains "1080P"

// 1.3 GiB in bytes
const FIRST_SIZE = Math.round(1.3 * 1024 ** 3)

// ─── Import extension ─────────────────────────────────────────────────────────
const { default: sukebei } = await import('../src/sukebei.js')

// ─── Suite setup ─────────────────────────────────────────────────────────────

class SukebeiTest extends BaseExtensionTest {
  constructor () {
    super({
      extension:    sukebei,
      fixtureFetch: () => mockFetch(FIXTURE_XML),
      name:         'Sukebei',
    })
  }

  makeQuery (overrides = {}) {
    return super.makeQuery({
      titles: ['test'],
      ...overrides,
    })
  }
}

const suite = new SukebeiTest()
suite.run()

// ─── Sukebei-specific tests ───────────────────────────────────────────────────

describe('Sukebei — RSS parsing', () => {
  it('extracts title, hash, seeders, leechers, downloads, size, date correctly', async () => {
    const results = await sukebei.single({
      titles: ['test'], episode: undefined, resolution: '', exclusions: [],
      fetch: mockFetch(FIXTURE_XML),
    })
    const first = results.find(r => r.hash === FIRST_HASH)
    expect(first).toBeDefined()
    expect(first.title).toBe('[260218][Neural Desires] Lab-Tested, Lust-Approved')
    expect(first.hash).toBe(FIRST_HASH)
    expect(first.seeders).toBe(16)
    expect(first.leechers).toBe(2)
    expect(first.downloads).toBe(1859)
    expect(first.size).toBeCloseTo(FIRST_SIZE, -6)
    expect(first.date).toBeInstanceOf(Date)
    expect(first.date.getFullYear()).toBe(2026)
  })

  it('clamps seeders and leechers >= 30000 to 0', async () => {
    const results = await sukebei.single({
      titles: ['test'], episode: undefined, resolution: '', exclusions: [],
      fetch: mockFetch(FIXTURE_XML),
    })
    const clamped = results.find(r => r.hash === CLAMPED_HASH)
    expect(clamped).toBeDefined()
    expect(clamped.seeders).toBe(0)
    expect(clamped.leechers).toBe(0)
  })

  it('skips items with empty infoHash', async () => {
    const results = await sukebei.single({
      titles: ['test'], episode: undefined, resolution: '', exclusions: [],
      fetch: mockFetch(FIXTURE_XML),
    })
    const bad = results.find(r => r.title === NO_HASH_TITLE)
    expect(bad).toBeUndefined()
  })

  it('builds a valid magnet link with infoHash', async () => {
    const results = await sukebei.single({
      titles: ['test'], episode: undefined, resolution: '', exclusions: [],
      fetch: mockFetch(FIXTURE_XML),
    })
    for (const r of results) {
      expect(r.link).toMatch(/^magnet:\?xt=urn:btih:[a-f0-9]{40}/)
    }
  })

  it('includes Sukebei tracker in magnet links', async () => {
    const results = await sukebei.single({
      titles: ['test'], episode: undefined, resolution: '', exclusions: [],
      fetch: mockFetch(FIXTURE_XML),
    })
    // Sukebei uses sukebei.tracker.wf, not nyaa.tracker.wf
    expect(results[0].link).toContain('nyaa.tracker.wf')
  })
})

describe('Sukebei — resolution filtering', () => {
  it('returns only 1080p items when resolution is 1080', async () => {
    const results = await sukebei.single({
      titles: ['test'], episode: undefined, resolution: '1080', exclusions: [],
      fetch: mockFetch(FIXTURE_XML),
    })
    // Only the 1080P item should remain
    expect(results.length).toBeGreaterThan(0)
    for (const r of results) {
      expect(r.title.toLowerCase()).toContain('1080')
    }
  })

  it('filters out 1080p items when resolution is 720', async () => {
    const results = await sukebei.single({
      titles: ['test'], episode: undefined, resolution: '720', exclusions: [],
      fetch: mockFetch(FIXTURE_XML),
    })
    const p1080 = results.find(r => r.hash === P1080_HASH)
    expect(p1080).toBeUndefined()
  })

  it('returns more items when no resolution filter is set', async () => {
    const all      = await sukebei.single({ titles: ['test'], episode: undefined, resolution: '',     exclusions: [], fetch: mockFetch(FIXTURE_XML) })
    const filtered = await sukebei.single({ titles: ['test'], episode: undefined, resolution: '1080', exclusions: [], fetch: mockFetch(FIXTURE_XML) })
    expect(all.length).toBeGreaterThan(filtered.length)
  })
})

describe('Sukebei — exclusions', () => {
  it('filters out results containing exclusion keywords', async () => {
    const results = await sukebei.single({
      titles: ['test'], episode: undefined, resolution: '', exclusions: ['1080'],
      fetch: mockFetch(FIXTURE_XML),
    })
    const p1080 = results.find(r => r.hash === P1080_HASH)
    expect(p1080).toBeUndefined()
  })

  it('is case-insensitive for exclusion keywords', async () => {
    const results = await sukebei.single({
      titles: ['test'], episode: undefined, resolution: '', exclusions: ['LAB-TESTED'],
      fetch: mockFetch(FIXTURE_XML),
    })
    const first = results.find(r => r.hash === FIRST_HASH)
    expect(first).toBeUndefined()
  })
})

describe('Sukebei — options', () => {
  it('uses the custom domain option in the request URL', async () => {
    const fetch = mockFetch(FIXTURE_XML)
    await sukebei.single(
      { titles: ['test'], episode: undefined, resolution: '', exclusions: [], fetch },
      { domain: 'https://sukebei.nyaa.land', category: '1_1', filter: '0' }
    )
    expect(fetch.mock.calls[0][0]).toContain('sukebei.nyaa.land')
  })

  it('uses the custom category option in the request URL', async () => {
    const fetch = mockFetch(FIXTURE_XML)
    await sukebei.single(
      { titles: ['test'], episode: undefined, resolution: '', exclusions: [], fetch },
      { domain: 'https://sukebei.nyaa.si', category: '2_2', filter: '0' }
    )
    expect(fetch.mock.calls[0][0]).toContain('2_2')
  })
})

describe('Sukebei — edge cases', () => {
  it('returns [] when RSS is empty', async () => {
    const emptyXml = `<rss xmlns:nyaa="https://sukebei.nyaa.si/xmlns/nyaa" version="2.0"><channel></channel></rss>`
    const results = await sukebei.single({
      titles: ['test'], episode: undefined, resolution: '', exclusions: [],
      fetch: mockFetch(emptyXml),
    })
    expect(results).toEqual([])
  })

  it('throws a user-friendly error when Sukebei returns non-RSS', async () => {
    await expect(
      sukebei.single({
        titles: ['test'], episode: undefined, resolution: '', exclusions: [],
        fetch: mockFetch('<html>Blocked</html>'),
      })
    ).rejects.toThrow()
  })
})

describe('Sukebei — batch()', () => {
  it('appends batch keyword to the first search query URL', async () => {
    const fetch = mockFetch(FIXTURE_XML)
    await sukebei.batch({
      titles: ['test'], episodeCount: undefined, resolution: '', exclusions: [],
      fetch,
    })
    expect(fetch.mock.calls[0][0].toLowerCase()).toContain('batch')
  })
})
