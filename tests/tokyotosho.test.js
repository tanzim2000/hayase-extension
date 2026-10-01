// tests/tokyotosho.test.js
//
// Tests for src/tokyotosho.js — extends BaseExtensionTest for shared requirements,
// then adds Tokyo Toshokan-specific tests on top.
//
// The fixture (fixtures/tokyotosho.xml) is 11 real items from Tokyo Toshokan's
// RSS search for "Sousou no Frieren", including a manga archive and a .zip that
// must never come back as results.
//
// Run: npx vitest run tests/tokyotosho.test.js

import { describe, it, expect, vi } from 'vitest'
import { readFileSync } from 'fs'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'
import BaseExtensionTest, { mockFetch } from './BaseExtensionTest.js'

// ─── Fixture ──────────────────────────────────────────────────────────────────
const __dirname = dirname(fileURLToPath(import.meta.url))
const FIXTURE_XML = readFileSync(join(__dirname, 'fixtures/tokyotosho.xml'), 'utf-8')
const EMPTY_RSS   = '<?xml version="1.0" encoding="UTF-8"?><rss version="2.0"><channel><title>Tokyo Toshokan</title></channel></rss>'

// Info hashes of the fixture items, already converted from the feed's base32
// to hex — update these if you change the fixture
const H = {
	s2Ep07:       '66b2241832d223e5d2c3364233b43917d1924c92',  // [SubsPlease] ... S2 - 07 (1080p)
	s2Ep07Erai:   '9515b72df46f32e0a63fe532bd463cc2918dd2cc',  // [Erai-raws] ... 2nd Season - 07 [720p ...]
	s1Ep07:       '42d462368aed5f620f28ae99eacbbea776ed776d',  // [SubsPlease] ... - 07 (1080p)          — season 1
	abs38:        '48f49345772cc24ece22ef2b9cc5bf2b8e82d4f4',  // [9volt] ... - 38 (S02E10)              — absolute number
	s2Pack:       'bc25231f657d115e61e68d0e124d3ff5ec101f69',  // [SubsPlease] ... S2 (01-10) [Batch]
	s1Pack:       '1deb1dd172a50228eb8a94a9535c6d092976ee44',  // [SubsPlease] ... (01-28) [Batch]
	s1PackErai:   'c320d934e27010e1adbbf7aa549386721010e4dc',  // [Erai-raws] ... - 01 ~ 28
	plainPack:    'e029996224c8bacd252deab76d98752a4cb896ea',  // [SubsPlease] Sousou no Frieren         — "Batch" category, title says nothing
	s2PackBD:     '07a748304e430ed0367e293cab7c3f0d8d89175e',  // [Ironclad] ... - S02 [BD.1080p.AV1]     — "Anime" category
	mangaArchive: '7a72489cbccdf8257f7ffbaa61d73d912a64ab7d',  // Dekai Manga Archive                     — not the show at all
	zip:          '04c6dc6c1c628f170a2a0359a115ac6fe31b2951',  // ... Fern.zip                            — not a video
}

const S1_TITLES = ['Sousou no Frieren', "Frieren: Beyond Journey's End"]
const S2_TITLES = ['Sousou no Frieren 2nd Season', "Frieren: Beyond Journey's End Season 2", '葬送のフリーレン 第2期']

// ─── Mock fetch ───────────────────────────────────────────────────────────────

/**
 * Fake Tokyo Toshokan: every search returns the fixture, or an empty feed when
 * `emptyFor(url)` says so.
 * @param {{ emptyFor?: (url: URL) => boolean }} [opts]
 */
function ttFetch ({ emptyFor = () => false } = {}) {
	return vi.fn(async url => {
		const body = emptyFor(new URL(url)) ? EMPTY_RSS : FIXTURE_XML
		return { ok: true, status: 200, text: () => Promise.resolve(body) }
	})
}

const query = overrides => ({
	titles: S2_TITLES, episode: undefined, resolution: '', exclusions: [],
	fetch: ttFetch(), ...overrides,
})

const hashes = results => results.map(r => r.hash).sort()

/** The search URLs a fake fetch was called with, as URL objects. */
const searchesOf = fetch => fetch.mock.calls.map(c => new URL(c[0]))

// ─── Import extension ─────────────────────────────────────────────────────────
const { default: tokyotosho } = await import('../src/tokyotosho.js')

// ─── Suite setup ─────────────────────────────────────────────────────────────

class TokyoToshoTest extends BaseExtensionTest {
	constructor () {
		super({
			extension:    tokyotosho,
			fixtureFetch: () => ttFetch(),
			name:         'Tokyo Toshokan',
		})
	}
}

// Register all shared BaseExtensionTest checks
const suite = new TokyoToshoTest()
suite.runStringSearch()

// ─── Tokyo Toshokan-specific tests ────────────────────────────────────────────

describe('Tokyo Toshokan — RSS parsing', () => {
	it('reads plain-text titles, size and date', async () => {
		const results = await tokyotosho.single(query({ episode: 7 }))
		const ep7 = results.find(r => r.hash === H.s2Ep07)
		expect(ep7).toBeDefined()
		expect(ep7.title).toBe('[SubsPlease] Sousou no Frieren S2 - 07 (1080p) [56170200].mkv')
		expect(ep7.size).toBe(Math.round(1.37 * 1024 ** 3))
		expect(ep7.date.toISOString()).toBe('2026-03-06T15:34:37.000Z')
		expect(ep7.seeders).toBe(0)
	})

	it('converts the base32 info hash to 40-character hex (checked against Nyaa)', async () => {
		const results = await tokyotosho.single(query({ episode: 7 }))
		for (const r of results) expect(r.hash).toMatch(/^[0-9a-f]{40}$/)
		expect(hashes(results)).toContain(H.s2Ep07)
	})

	it('builds a magnet with the hex hash and keeps the original trackers', async () => {
		const [ep7] = (await tokyotosho.single(query({ episode: 7 }))).filter(r => r.hash === H.s2Ep07)
		expect(ep7.link.startsWith(`magnet:?xt=urn:btih:${H.s2Ep07}&dn=`)).toBe(true)
		expect(ep7.link).toContain(`&tr=${encodeURIComponent('http://nyaa.tracker.wf:7777/announce')}`)
	})

	it('never returns non-video files or things that are not the show', async () => {
		const all = [
			...await tokyotosho.single(query({ titles: S1_TITLES, episode: 7 })),
			...await tokyotosho.batch(query({ titles: S1_TITLES })),
			...await tokyotosho.movie(query({ titles: S1_TITLES })),
		]
		expect(all.find(r => r.hash === H.zip)).toBeUndefined()
		expect(all.find(r => r.hash === H.mangaArchive)).toBeUndefined()
	})

	it('throws a user-friendly error when the site returns something that is not RSS', async () => {
		await expect(
			tokyotosho.single(query({ episode: 7, fetch: mockFetch('<html>Just a moment...</html>') }))
		).rejects.toThrow(/Tokyo Toshokan/)
	})
})

describe('Tokyo Toshokan — episode matching', () => {
	it('returns only the requested episode of the requested season', async () => {
		const results = await tokyotosho.single(query({ episode: 7 }))
		expect(hashes(results)).toEqual([H.s2Ep07, H.s2Ep07Erai].sort())
	})

	it('treats a show with no season in its name as season 1', async () => {
		const results = await tokyotosho.single(query({ titles: S1_TITLES, episode: 7 }))
		expect(hashes(results)).toEqual([H.s1Ep07])
	})

	it('also matches by absolute episode number ("- 38" = season 2 episode 10)', async () => {
		const results = await tokyotosho.single(query({ episode: 10, absoluteEpisodeNumber: 38 }))
		expect(hashes(results)).toEqual([H.abs38])
	})

	it('never returns packs for a single episode', async () => {
		const results = await tokyotosho.single(query({ titles: S1_TITLES, episode: 1 }))
		expect(results).toEqual([])
	})

	it('marks title-verified episode matches as accuracy="medium", never "high"', async () => {
		const results = await tokyotosho.single(query({ episode: 7 }))
		expect(results.length).toBeGreaterThan(0)
		expect(results.every(r => r.accuracy === 'medium')).toBe(true)
	})
})

describe('Tokyo Toshokan — batch()', () => {
	it('season 2: returns only season 2 packs', async () => {
		const results = await tokyotosho.batch(query())
		expect(hashes(results)).toEqual([H.s2Pack, H.s2PackBD].sort())
		expect(results.every(r => r.type === 'batch')).toBe(true)
	})

	it('season 1: returns season 1 packs, including the site\'s "Batch" category with a bare title', async () => {
		const results = await tokyotosho.batch(query({ titles: S1_TITLES }))
		expect(hashes(results)).toEqual([H.s1Pack, H.s1PackErai, H.plainPack].sort())
	})
})

describe('Tokyo Toshokan — filters', () => {
	it('drops releases that state a different resolution', async () => {
		const results = await tokyotosho.single(query({ episode: 7, resolution: '720' }))
		expect(hashes(results)).toEqual([H.s2Ep07Erai])
	})

	it('filters out results containing exclusion keywords (case-insensitive)', async () => {
		const results = await tokyotosho.single(query({ episode: 7, exclusions: ['erai'] }))
		expect(hashes(results)).toEqual([H.s2Ep07])
	})
})

describe('Tokyo Toshokan — search requests', () => {
	it('searches season-free names with the episode number, in Anime + Batch by default', async () => {
		const fetch = ttFetch()
		await tokyotosho.single(query({ episode: 7, fetch }))
		const searches = searchesOf(fetch)
		expect(searches.map(u => u.searchParams.get('terms')).sort()).toEqual([
			'Frieren: Beyond Journey\'s End 07',
			'Sousou no Frieren 07',
			'葬送のフリーレン 07',
		].sort())
		for (const u of searches) {
			expect(u.origin + u.pathname).toBe('https://www.tokyotosho.info/rss.php')
			expect(u.searchParams.get('filter')).toBe('1,11')
		}
	})

	it('adds a search for the absolute episode number when it differs', async () => {
		const fetch = ttFetch()
		await tokyotosho.single(query({ titles: ['Sousou no Frieren 2nd Season'], episode: 7, absoluteEpisodeNumber: 35, fetch }))
		expect(searchesOf(fetch).map(u => u.searchParams.get('terms')).sort())
			.toEqual(['Sousou no Frieren 07', 'Sousou no Frieren 35'])
	})

	it('batch() also searches the "Batch" category on its own', async () => {
		const fetch = ttFetch()
		await tokyotosho.batch(query({ titles: ['Sousou no Frieren'], fetch }))
		expect(searchesOf(fetch).map(u => u.searchParams.get('filter')).sort()).toEqual(['1,11', '11'])
	})

	it('uses the categories option, keeping only digits and commas', async () => {
		const fetch = ttFetch()
		await tokyotosho.single(query({ titles: ['Sousou no Frieren'], episode: 7, fetch }), { categories: ' 1, 10 ' })
		expect(searchesOf(fetch)[0].searchParams.get('filter')).toBe('1,10')
	})

	it('uses the results from searches that worked when another one finds nothing', async () => {
		const fetch = ttFetch({ emptyFor: u => u.searchParams.get('terms').startsWith('Sousou') })
		const results = await tokyotosho.single(query({ episode: 7, fetch }))
		expect(hashes(results)).toEqual([H.s2Ep07, H.s2Ep07Erai].sort())
	})
})

describe('Tokyo Toshokan — test()', () => {
	it('checks the RSS feed on the manifest\'s domain', async () => {
		const fetch = mockFetch(EMPTY_RSS)
		await tokyotosho.test({ fetch })
		expect(fetch.mock.calls[0][0]).toBe('https://www.tokyotosho.info/rss.php')
	})
})