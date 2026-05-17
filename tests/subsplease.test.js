// tests/subsplease.test.js
//
// Tests for src/subsplease.js — extends BaseExtensionTest for shared requirements,
// then adds SubsPlease-specific tests on top.
//
// Run: npx vitest run tests/subsplease.test.js

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'
import BaseExtensionTest, { mockFetch, mockFetchError } from './BaseExtensionTest.js'

// ─── Fixture ──────────────────────────────────────────────────────────────────
const __dirname = dirname(fileURLToPath(import.meta.url))
const FIXTURE_JSON = readFileSync(join(__dirname, 'fixtures/subsplease.json'), 'utf-8')

// SubsPlease uses a schedule endpoint for test() — we need a minimal valid response
const SCHEDULE_FIXTURE = JSON.stringify({ schedule: {} })

// Known values from the fixture
// Episode 10 of S2 — 1080p Base32 hash: M7TFKY5L64IYJGIKKTENHIIR4NE52ZZP
// Decoded hex (from base32): 9fac96cb5de1c60c86852d1ca72a3da27b6bd33f (approx — we test the magnet link format)
const EP10_S2_SHOW    = 'Sousou no Frieren S2'
const EP09_S2_SHOW    = 'Sousou no Frieren S2'
const EP09_S1_SHOW    = 'Sousou no Frieren'    // S1 — different show title
const EP10_RELEASE    = 'Fri, 27 Mar 2026 11:02:39 -0400'

// ─── Import extension ─────────────────────────────────────────────────────────
const { default: subsplease } = await import('../src/subsplease.js')

// ─── Suite setup ─────────────────────────────────────────────────────────────
// SubsPlease test() uses the schedule endpoint, not search
// So fixtureFetch uses the schedule fixture for test(), search fixture for single/batch/movie

class SubsPleaseTest extends BaseExtensionTest {
  constructor () {
    super({
      extension:    subsplease,
      fixtureFetch: () => mockFetch(FIXTURE_JSON),
      name:         'SubsPlease',
    })
  }

  makeQuery (overrides = {}) {
    return super.makeQuery({
      titles: ['Sousou no Frieren S2', 'Frieren'],
      episode: 10,
      ...overrides,
    })
  }
}

// Override test() shared check since SubsPlease uses schedule endpoint
// We handle this by making fixtureFetch return valid JSON for both endpoints
const suite = new SubsPleaseTest()
suite.run()

// ─── SubsPlease-specific tests ────────────────────────────────────────────────

describe('SubsPlease — Base32 hash decoding', () => {
  it('converts Base32 hashes in magnet links to lowercase hex', async () => {
    const results = await subsplease.single({
      titles: [EP10_S2_SHOW], episode: 10, resolution: '1080', exclusions: [],
      fetch: mockFetch(FIXTURE_JSON),
    })
    expect(results.length).toBeGreaterThan(0)
    // Hash must be hex (40 lowercase hex chars), not Base32
    for (const r of results) {
      expect(r.hash).toMatch(/^[a-f0-9]{40}$/)
    }
  })

  it('produces a valid magnet URI from a Base32-encoded hash', async () => {
    const results = await subsplease.single({
      titles: [EP10_S2_SHOW], episode: 10, resolution: '1080', exclusions: [],
      fetch: mockFetch(FIXTURE_JSON),
    })
    expect(results[0].link).toMatch(/^magnet:\?xt=urn:btih:[a-f0-9A-Z]{32,40}/)
  })
})

describe('SubsPlease — title matching', () => {
  it('only returns results matching the requested show title', async () => {
    const results = await subsplease.single({
      titles: [EP10_S2_SHOW], episode: 10, resolution: '', exclusions: [],
      fetch: mockFetch(FIXTURE_JSON),
    })
    for (const r of results) {
      expect(r.title.toLowerCase()).toContain('frieren')
    }
  })

  it('returns results case-insensitively matching the show title', async () => {
    const results = await subsplease.single({
      titles: ['sousou no frieren s2'], episode: 10, resolution: '', exclusions: [],
      fetch: mockFetch(FIXTURE_JSON),
    })
    expect(results.length).toBeGreaterThan(0)
  })
})

describe('SubsPlease — episode matching', () => {
  it('returns only episode 10 when episode=10', async () => {
    const results = await subsplease.single({
      titles: [EP10_S2_SHOW], episode: 10, resolution: '', exclusions: [],
      fetch: mockFetch(FIXTURE_JSON),
    })
    expect(results.length).toBeGreaterThan(0)
    for (const r of results) {
      expect(r.title).toContain('10')
    }
  })

  it('does not return episode 10 when searching for episode 9', async () => {
    const results = await subsplease.single({
      titles: [EP09_S2_SHOW], episode: 9, resolution: '', exclusions: [],
      fetch: mockFetch(FIXTURE_JSON),
    })
    const ep10 = results.find(r => r.title.includes('S2 - 10'))
    expect(ep10).toBeUndefined()
  })
})

describe('SubsPlease — resolution picking', () => {
  it('returns 1080p result when resolution is 1080', async () => {
    const results = await subsplease.single({
      titles: [EP10_S2_SHOW], episode: 10, resolution: '1080', exclusions: [],
      fetch: mockFetch(FIXTURE_JSON),
    })
    expect(results.length).toBeGreaterThan(0)
    expect(results[0].title).toContain('1080p')
  })

  it('returns 480p result when resolution is 480', async () => {
    const results = await subsplease.single({
      titles: [EP10_S2_SHOW], episode: 10, resolution: '480', exclusions: [],
      fetch: mockFetch(FIXTURE_JSON),
    })
    expect(results.length).toBeGreaterThan(0)
    expect(results[0].title).toContain('480p')
  })

  it('falls back to 1080p when requested resolution is unavailable', async () => {
    const results = await subsplease.single({
      titles: [EP10_S2_SHOW], episode: 10, resolution: '2160', exclusions: [],
      fetch: mockFetch(FIXTURE_JSON),
    })
    // 2160 doesn't exist — should fall back to 1080
    expect(results.length).toBeGreaterThan(0)
    expect(results[0].title).toContain('1080p')
  })
})

describe('SubsPlease — date parsing', () => {
  it('parses release_date into a valid Date object', async () => {
    const results = await subsplease.single({
      titles: [EP10_S2_SHOW], episode: 10, resolution: '1080', exclusions: [],
      fetch: mockFetch(FIXTURE_JSON),
    })
    expect(results[0].date).toBeInstanceOf(Date)
    expect(results[0].date.getFullYear()).toBe(2026)
    expect(results[0].date.getMonth()).toBe(2) // March = 2 (0-indexed)
  })
})

describe('SubsPlease — accuracy', () => {
  it('always returns accuracy="high" since SubsPlease is a trusted single group', async () => {
    const results = await subsplease.single({
      titles: [EP10_S2_SHOW], episode: 10, resolution: '', exclusions: [],
      fetch: mockFetch(FIXTURE_JSON),
    })
    for (const r of results) {
      expect(r.accuracy).toBe('high')
    }
  })
})

describe('SubsPlease — deduplication', () => {
  it('does not return duplicate results for the same hash', async () => {
    const results = await subsplease.single({
      titles: [EP10_S2_SHOW, EP10_S2_SHOW], episode: 10, resolution: '', exclusions: [],
      fetch: mockFetch(FIXTURE_JSON),
    })
    const hashes = results.map(r => r.hash)
    const unique = new Set(hashes)
    expect(unique.size).toBe(hashes.length)
  })
})

describe('SubsPlease — test()', () => {
  it('returns true when schedule endpoint is reachable', async () => {
    const result = await subsplease.test({ fetch: mockFetch(SCHEDULE_FIXTURE) })
    expect(result).toBe(true)
  })

  it('throws when schedule endpoint returns non-200', async () => {
    await expect(
      subsplease.test({ fetch: mockFetch('', 503) })
    ).rejects.toThrow('503')
  })
})

describe('SubsPlease — empty results', () => {
  it('returns [] when no shows match the query titles', async () => {
    const results = await subsplease.single({
      titles: ['NonExistentAnimeXYZ'], episode: 1, resolution: '', exclusions: [],
      fetch: mockFetch(FIXTURE_JSON),
    })
    expect(results).toEqual([])
  })

  it('returns [] when the API returns an empty object', async () => {
    const results = await subsplease.single({
      titles: ['Frieren'], episode: 1, resolution: '', exclusions: [],
      fetch: mockFetch('[]'),
    })
    expect(results).toEqual([])
  })
})
