// tests/mikan.test.js
//
// Tests for src/mikan.js — extends BaseExtensionTest for shared requirements,
// then adds Mikan-specific tests on top.
//
// The fixture (fixtures/mikan.xml) is 9 real items from Mikan's RSS search
// for "Sousou no Frieren 2nd Season" and "Sousou no Frieren".
//
// Run: npx vitest run tests/mikan.test.js

import { describe, it, expect, vi } from 'vitest'
import { readFileSync } from 'fs'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'
import BaseExtensionTest, { mockFetch } from './BaseExtensionTest.js'

// ─── Fixture ──────────────────────────────────────────────────────────────────
const __dirname = dirname(fileURLToPath(import.meta.url))
const FIXTURE_XML = readFileSync(join(__dirname, 'fixtures/mikan.xml'), 'utf-8')
const EMPTY_RSS   = '<?xml version="1.0" encoding="utf-8"?><rss version="2.0"><channel><title>Mikan Project</title></channel></rss>'

// Info hashes of the fixture items — update these if you change the fixture
const H = {
	s2PackBD:      'f7f11b17b95b00313ededdeb0d2c2057c13309e9',  // [H-Enc] ... 2nd Season (BDRip ...)        — pack, no episode
	s2Pack01to10:  '1f01b9c6de60857a5ba31a484e583c71956cdf8b',  // [Zzz睡不醒] ... 2nd Season [01-10]           — pack
	s2Ep10End:     '6749019e7e0560e89b9d69f2838638467f28f6df',  // [jibaketa合成] ... 2nd Season - 10 END
	s2Ep07:        'b903be6eabc4bb55a521d5d8b5df2aeca4ff6164',  // [jibaketa合成] ... 2nd Season - 07
	s2Abs35Bracket:'1db436cd8bdf2ef2a3a3ead05cbb6baae1123351',  // 【悠哈璃羽字幕社】[... 第二季 ...][35]        — S2E7, absolute number
	s2Ep07CR:      '7ccdb2db99294c3ae5f14c03aaaa4b9b92ab2efe',  // [黒ネズミたち] ... 2nd Season - 07 (CR ...)
	s2Abs35:       '61064205fc3b348e6d12b1c710ca55e4c065c4bb',  // [黒ネズミたち] ... 2nd Season - 35 (B-Global) — S2E7, absolute number
	s1Pack:        'f8651444a2c0b3ff7e3da3cbd75da58ef5f09e19',  // [7³ACG] ... S01 | 01-28                     — season 1 pack
	noSeason38:    '82b85cfd2c634cbef831e939e6fcb11cdfa73faf',  // [喵萌奶茶屋&LoliHouse] Sousou no Frieren - 38 — no season stated
}

const S2_TITLES = ['Sousou no Frieren 2nd Season', "Frieren: Beyond Journey's End Season 2", '葬送のフリーレン 第2期']

// ─── Mock fetch ───────────────────────────────────────────────────────────────

/**
 * Fake Mikan:
 *   /RSS/Classic        → a tiny feed (used by test())
 *   /RSS/Search?...     → the fixture, or an empty feed when `emptyFor(term)` says so
 * @param {{ emptyFor?: (term: string) => boolean }} [opts]
 */
function mikanFetch ({ emptyFor = () => false } = {}) {
	return vi.fn(async url => {
		const respond = body => ({ ok: true, status: 200, text: () => Promise.resolve(body) })
		if (url.includes('/RSS/Classic')) return respond(EMPTY_RSS)
		const term = new URL(url).searchParams.get('searchstr') ?? ''
		return respond(emptyFor(term) ? EMPTY_RSS : FIXTURE_XML)
	})
}

const query = overrides => ({
	titles: S2_TITLES, episode: undefined, resolution: '', exclusions: [],
	fetch: mikanFetch(), ...overrides,
})

const hashes = results => results.map(r => r.hash).sort()

// ─── Import extension ─────────────────────────────────────────────────────────
const { default: mikan } = await import('../src/mikan.js')

// ─── Suite setup ─────────────────────────────────────────────────────────────

class MikanTest extends BaseExtensionTest {
	constructor () {
		super({
			extension:    mikan,
			fixtureFetch: () => mikanFetch(),
			name:         'Mikan',
		})
	}
}

// Register all shared BaseExtensionTest checks
const suite = new MikanTest()
suite.runStringSearch()

// ─── Mikan-specific tests ─────────────────────────────────────────────────────

describe('Mikan — RSS parsing', () => {
	it('extracts title, hash, .torrent link, size and date correctly', async () => {
		const results = await mikan.single(query({ episode: 7 }))
		const ep7 = results.find(r => r.hash === H.s2Ep07)
		expect(ep7).toBeDefined()
		expect(ep7.title).toContain('Sousou no Frieren 2nd Season - 07')
		expect(ep7.link).toBe('https://mikanani.me/Download/20260515/b903be6eabc4bb55a521d5d8b5df2aeca4ff6164.torrent')
		expect(ep7.size).toBe(797756608)
		// Mikan writes China time (UTC+8): 2026-05-15T15:00:00 there = 07:00 UTC
		expect(ep7.date.toISOString()).toBe('2026-05-15T07:00:00.000Z')
		expect(ep7.seeders).toBe(0)
		expect(ep7.leechers).toBe(0)
	})

	it('handles dates with 6 decimal places of seconds', async () => {
		const results = await mikan.batch(query())
		const pack = results.find(r => r.hash === H.s2PackBD)
		// 2026-08-12T06:12:15.638227 China time
		expect(pack.date.toISOString()).toBe('2026-08-11T22:12:15.638Z')
	})

	it('decodes entities in titles ("&amp;" → "&")', async () => {
		const results = await mikan.movie(query({ titles: ['Sousou no Frieren'] }))
		const lolihouse = results.find(r => r.hash === H.noSeason38)
		expect(lolihouse.title).toContain('[喵萌奶茶屋&LoliHouse]')
	})

	it('throws a user-friendly error when Mikan returns something that is not RSS', async () => {
		await expect(
			mikan.single(query({ episode: 7, fetch: mockFetch('<html>Just a moment...</html>') }))
		).rejects.toThrow(/Mikan/)
	})
})

describe('Mikan — episode matching', () => {
	it('returns only the requested episode', async () => {
		const results = await mikan.single(query({ episode: 7 }))
		expect(hashes(results)).toEqual([H.s2Ep07, H.s2Ep07CR].sort())
	})

	it('also matches by absolute episode number ("- 35" and "[35]" = season 2 episode 7)', async () => {
		const results = await mikan.single(query({ episode: 7, absoluteEpisodeNumber: 35 }))
		expect(hashes(results)).toEqual([H.s2Ep07, H.s2Ep07CR, H.s2Abs35, H.s2Abs35Bracket].sort())
	})

	it('understands "- 10 END"', async () => {
		const results = await mikan.single(query({ episode: 10 }))
		expect(hashes(results)).toEqual([H.s2Ep10End])
	})

	it('reads the season from Japanese titles ("第2期")', async () => {
		const results = await mikan.single(query({ titles: ['葬送のフリーレン 第2期'], episode: 7 }))
		expect(hashes(results)).toEqual([H.s2Ep07, H.s2Ep07CR].sort())
	})

	it('never returns season packs for a single episode', async () => {
		const results = await mikan.single(query({ episode: 7, absoluteEpisodeNumber: 35 }))
		expect(results.every(r => r.type !== 'batch')).toBe(true)
	})

	// Marked-season-less releases could be any season's episode, so for season 2+
	// they're only trusted when they match the ABSOLUTE number.
	it('season 2+: drops releases with no season unless the absolute number matches', async () => {
		const noAbsolute = await mikan.single(query({ episode: 38 }))
		expect(noAbsolute.find(r => r.hash === H.noSeason38)).toBeUndefined()

		const withAbsolute = await mikan.single(query({ episode: 10, absoluteEpisodeNumber: 38 }))
		expect(hashes(withAbsolute)).toEqual([H.s2Ep10End, H.noSeason38].sort())
	})

	it('season not stated in the search: keeps releases with no season', async () => {
		const results = await mikan.single(query({ titles: ['Sousou no Frieren'], episode: 38 }))
		expect(hashes(results)).toEqual([H.noSeason38])
	})

	// Hayase's rule: "high" is only for ID-based matching. Mikan is a keyword search.
	it('marks title-verified episode matches as accuracy="medium", never "high"', async () => {
		const results = await mikan.single(query({ episode: 7 }))
		expect(results.length).toBeGreaterThan(0)
		expect(results.every(r => r.accuracy === 'medium')).toBe(true)
	})
})

describe('Mikan — batch()', () => {
	it('returns only the packs for the stated season', async () => {
		const results = await mikan.batch(query())
		expect(hashes(results)).toEqual([H.s2PackBD, H.s2Pack01to10].sort())
		expect(results.every(r => r.type === 'batch')).toBe(true)
	})

	it('keeps packs of every season when the search states no season', async () => {
		const results = await mikan.batch(query({ titles: ['Sousou no Frieren'] }))
		expect(hashes(results)).toEqual([H.s2PackBD, H.s2Pack01to10, H.s1Pack].sort())
	})
})

describe('Mikan — filters', () => {
	it('drops releases that state a different resolution (incl. "1920x1080")', async () => {
		const results = await mikan.single(query({ episode: 7, resolution: '720' }))
		expect(results).toEqual([])
	})

	it('filters out results containing exclusion keywords (case-insensitive)', async () => {
		const results = await mikan.single(query({ episode: 7, exclusions: ['muse'] }))
		expect(hashes(results)).toEqual([H.s2Ep07CR])
	})
})

describe('Mikan — search terms', () => {
	const searchTermsOf = fetch => fetch.mock.calls
		.map(c => c[0])
		.filter(u => u.includes('/RSS/Search'))
		.map(u => new URL(u).searchParams.get('searchstr'))

	it('searches the full titles only, when they find something', async () => {
		const fetch = mikanFetch()
		await mikan.single(query({ episode: 7, fetch }))
		expect(searchTermsOf(fetch).sort()).toEqual([...S2_TITLES].sort())
	})

	it('falls back to season-free titles when the full titles find nothing', async () => {
		const fetch = mikanFetch({ emptyFor: term => /2nd Season|Season 2|第2期/.test(term) })
		const results = await mikan.single(query({ episode: 7, fetch }))
		expect(searchTermsOf(fetch)).toContain('Sousou no Frieren')
		expect(searchTermsOf(fetch)).toContain('葬送のフリーレン')
		expect(hashes(results)).toEqual([H.s2Ep07, H.s2Ep07CR].sort())
	})

	it('uses the custom domain option', async () => {
		const fetch = mikanFetch()
		await mikan.single(query({ episode: 7, fetch }), { domain: 'https://mikan.example/' })
		expect(fetch.mock.calls[0][0].startsWith('https://mikan.example/RSS/Search?searchstr=')).toBe(true)
	})
})

describe('Mikan — test()', () => {
	it('checks the "latest uploads" feed', async () => {
		const fetch = mockFetch(EMPTY_RSS)
		await mikan.test({ fetch })
		expect(fetch.mock.calls[0][0]).toBe('https://mikanani.me/RSS/Classic')
	})
})