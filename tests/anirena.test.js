// tests/anirena.test.js
//
// Tests for src/anirena.js — extends BaseExtensionTest for shared requirements,
// then adds AniRena-specific tests on top.
//
// The fixture (fixtures/anirena.html) is a real AniRena search page for
// "Sousou no Frieren", cut down to 10 real rows plus one made-up look-alike row.
//
// Run: npx vitest run tests/anirena.test.js

import { describe, it, expect, vi } from 'vitest'
import { readFileSync } from 'fs'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'
import { createHash } from 'crypto'
import BaseExtensionTest, { mockFetch } from './BaseExtensionTest.js'

// ─── Fixture ──────────────────────────────────────────────────────────────────
const __dirname = dirname(fileURLToPath(import.meta.url))
const FIXTURE_HTML = readFileSync(join(__dirname, 'fixtures/anirena.html'), 'utf-8')

// Known values from the fixture — update these if you change the fixture
const EP10 = {
	id:        '019d5dfe-3904-7ba1-b19d-e14ee8d217fd',
	title:     '[Ironclad] Sousou no Frieren 2nd Season - S02E10 [WEB.1080p.AV1].mkv',
	seeders:   39,     // cell shows "11(39)" — we keep the bigger number
	leechers:  5,
	downloads: 2144,
	size:      Math.round(404.4 * 1024 ** 2),
	date:      '2026-03-27T17:20:00.000Z',
}
const S2_EP7_ID      = '019d5dfd-fc17-7f02-bcff-8159ef095599'  // [Ironclad] ... S02E07
const S1_EP7_IDS     = ['019d5df2-4bcd-73a0-941d-a897c6dc0f46', '019d5df3-85fe-7283-b991-060a343f7f2d']
const S2_PACK_IDS    = ['01a01773-2d7a-70f2-8f93-1c9fba95e2d8', '019db658-7077-7612-a9d0-ff0282b62913']
const S1_PACK_ID     = '019d5df7-e75b-7fe2-a9d7-de472e6c312e'  // "(Season 1 + OVAs)"
const LOOKALIKE_ID   = '00000000-0000-7000-8000-000000000001'  // "Yama no Susume - S02E07"

const S2_TITLES = ['Sousou no Frieren 2nd Season', "Frieren: Beyond Journey's End Season 2"]

// ─── Mock fetch ───────────────────────────────────────────────────────────────

/** A fake but stable info hash for a torrent id: sha1 of the id. */
const fakeHash = id => createHash('sha1').update(id).digest('hex')

/** The id inside a link or hash, for checks below. */
const idOf = r => [EP10.id, S2_EP7_ID, LOOKALIKE_ID, S1_PACK_ID, ...S1_EP7_IDS, ...S2_PACK_IDS]
	.find(id => r.hash === fakeHash(id) || r.hash.includes(id))

/**
 * Fake AniRena:
 *   /torrent/<id>  → a detail page with that torrent's (fake) info hash
 *   /rss           → a tiny RSS feed (used by test())
 *   anything else  → the search page fixture
 * @param {{ detailStatus?: number, searchBody?: string }} [opts]
 */
function anirenaFetch ({ detailStatus = 200, searchBody = FIXTURE_HTML } = {}) {
	return vi.fn(async url => {
		const respond = (body, status = 200) => ({
			ok: status >= 200 && status < 300,
			status,
			text: () => Promise.resolve(body),
		})
		if (url.includes('/torrent/')) {
			const id = url.split('/torrent/')[1]
			return respond(`<div class=td-ov-hashes><code data-label="Info Hash (SHA-1)" class=td-ov-stat-hash>${fakeHash(id)}</code></div>`, detailStatus)
		}
		if (url.endsWith('/rss')) return respond('<rss version="2.0"><channel></channel></rss>')
		return respond(searchBody)
	})
}

const query = overrides => ({
	titles: S2_TITLES, episode: undefined, resolution: '', exclusions: [],
	fetch: anirenaFetch(), ...overrides,
})

// ─── Import extension ─────────────────────────────────────────────────────────
const { default: anirena } = await import('../src/anirena.js')

// ─── Suite setup ─────────────────────────────────────────────────────────────

class AniRenaTest extends BaseExtensionTest {
	constructor () {
		super({
			extension:    anirena,
			fixtureFetch: () => anirenaFetch(),
			name:         'AniRena',
		})
	}
}

// Register all shared BaseExtensionTest checks
const suite = new AniRenaTest()
suite.runStringSearch()

// ─── AniRena-specific tests ───────────────────────────────────────────────────

describe('AniRena — search page parsing', () => {
	it('extracts title, seeders, leechers, downloads, size and date correctly', async () => {
		const results = await anirena.single(query({ episode: 10 }))
		const ep10 = results.find(r => r.hash === fakeHash(EP10.id))
		expect(ep10).toBeDefined()
		expect(ep10.title).toBe(EP10.title)
		expect(ep10.seeders).toBe(EP10.seeders)
		expect(ep10.leechers).toBe(EP10.leechers)
		expect(ep10.downloads).toBe(EP10.downloads)
		expect(ep10.size).toBe(EP10.size)
		expect(ep10.date.toISOString()).toBe(EP10.date)
	})

	it('reads the info hash from the detail page and builds a magnet link', async () => {
		const [ep10] = await anirena.single(query({ episode: 10 }))
		expect(ep10.hash).toBe(fakeHash(EP10.id))
		expect(ep10.link.startsWith(`magnet:?xt=urn:btih:${fakeHash(EP10.id)}`)).toBe(true)
		expect(ep10.link).toContain('tracker.anirena.com')
	})

	it('falls back to the .torrent URL when the detail page fails', async () => {
		const [ep10] = await anirena.single(query({ episode: 10, fetch: anirenaFetch({ detailStatus: 500 }) }))
		expect(ep10.link).toBe(`https://www.anirena.com/torrents/${EP10.id}.torrent`)
		expect(ep10.hash).toBe(ep10.link)
	})

	it('returns [] when AniRena shows its "no results" page', async () => {
		const empty = '<table class=tl-table><tbody><tr><td><div class=tl-empty-state>No torrents</div></td></tr></tbody></table>'
		const results = await anirena.single(query({ episode: 1, fetch: anirenaFetch({ searchBody: empty }) }))
		expect(results).toEqual([])
	})

	it('throws a user-friendly error when the page is not a search page', async () => {
		await expect(
			anirena.single(query({ episode: 1, fetch: anirenaFetch({ searchBody: '<html>Just a moment...</html>' }) }))
		).rejects.toThrow(/AniRena/)
	})
})

describe('AniRena — episode matching', () => {
	it('returns only the requested episode', async () => {
		const results = await anirena.single(query({ episode: 7 }))
		expect(results.map(idOf)).toEqual([S2_EP7_ID])
	})

	it('never returns season packs for a single episode', async () => {
		const results = await anirena.single(query({ episode: 7 }))
		expect(results.every(r => r.type !== 'batch')).toBe(true)
		expect(results.find(r => S2_PACK_IDS.includes(idOf(r)))).toBeUndefined()
	})

	it('drops episodes from another season when the title states the season', async () => {
		const results = await anirena.single(query({ episode: 7 }))
		expect(results.find(r => S1_EP7_IDS.includes(idOf(r)))).toBeUndefined()
	})

	it('does not treat episode 1 as a match for episode 10', async () => {
		const results = await anirena.single(query({ episode: 1 }))
		expect(results.find(r => idOf(r) === EP10.id)).toBeUndefined()
	})

	it('also matches by absoluteEpisodeNumber when it differs from episode', async () => {
		const results = await anirena.single(query({ episode: 3, absoluteEpisodeNumber: 7 }))
		expect(results.map(idOf)).toContain(S2_EP7_ID)
	})

	// Hayase's rule: "high" is only for ID-based matching. AniRena is a keyword search.
	it('marks title-verified episode matches as accuracy="medium", never "high"', async () => {
		const results = await anirena.single(query({ episode: 7 }))
		expect(results.length).toBeGreaterThan(0)
		expect(results.every(r => r.accuracy === 'medium')).toBe(true)
	})
})

describe('AniRena — look-alike shows', () => {
	it('drops rows that are not the searched show (AniRena search is fuzzy)', async () => {
		const results = await anirena.movie(query({ titles: ['Sousou no Frieren'] }))
		expect(results.length).toBeGreaterThan(0)
		expect(results.find(r => idOf(r) === LOOKALIKE_ID)).toBeUndefined()
	})
})

describe('AniRena — batch()', () => {
	it('returns only the packs for the stated season', async () => {
		const results = await anirena.batch(query())
		expect(results.map(idOf).sort()).toEqual([...S2_PACK_IDS].sort())
		expect(results.every(r => r.type === 'batch')).toBe(true)
	})

	it('treats "Season 1 + OVAs" with no episode number as a pack', async () => {
		const results = await anirena.batch(query({ titles: ['Sousou no Frieren'] }))
		expect(results.map(idOf)).toContain(S1_PACK_ID)
	})
})

describe('AniRena — filters', () => {
	it('drops releases that state a different resolution', async () => {
		const results = await anirena.single(query({ episode: 7, resolution: '720' }))
		expect(results).toEqual([])
	})

	it('filters out results containing exclusion keywords (case-insensitive)', async () => {
		const results = await anirena.single(query({ episode: 7, exclusions: ['av1'] }))
		expect(results).toEqual([])
	})
})

describe('AniRena — request URL', () => {
	it('searches by title only, with category, sub-category and page size', async () => {
		const fetch = anirenaFetch()
		await anirena.single(query({ episode: 7, fetch }))
		const searchUrls = fetch.mock.calls.map(c => c[0]).filter(u => !u.includes('/torrent/'))
		expect(searchUrls.length).toBeGreaterThan(0)
		for (const url of searchUrls) {
			const params = new URL(url).searchParams
			expect(params.get('q')).not.toMatch(/\b0?7\b/)  // no episode number in the query
			expect(params.get('cat')).toBe('anime')
			expect(params.get('sub')).toBe('sub-audio')
			expect(params.get('per_page')).toBe('250')
		}
	})

	it('also searches the title without "2nd Season"', async () => {
		const fetch = anirenaFetch()
		await anirena.single(query({ episode: 7, fetch }))
		const queries = fetch.mock.calls.map(c => c[0]).filter(u => !u.includes('/torrent/')).map(u => new URL(u).searchParams.get('q'))
		expect(queries).toContain('Sousou no Frieren 2nd Season')
		expect(queries).toContain('Sousou no Frieren')
	})

	it('uses the custom domain option', async () => {
		const fetch = anirenaFetch()
		await anirena.single(query({ episode: 7, fetch }), { domain: 'https://anirena.example/' })
		expect(fetch.mock.calls[0][0].startsWith('https://anirena.example/?')).toBe(true)
	})

	it('leaves out the sub-category when it is set to ""', async () => {
		const fetch = anirenaFetch()
		await anirena.single(query({ episode: 7, fetch }), { subcategory: '' })
		expect(new URL(fetch.mock.calls[0][0]).searchParams.has('sub')).toBe(false)
	})
})

describe('AniRena — test()', () => {
	it('checks the RSS feed (small) instead of the search page', async () => {
		const fetch = mockFetch('<rss></rss>')
		await anirena.test({ fetch })
		expect(fetch.mock.calls[0][0]).toBe('https://www.anirena.com/rss')
	})
})