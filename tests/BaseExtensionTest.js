// tests/BaseExtensionTest.js
//
// Shared base class for all hayase-extension test files.
//
// USAGE:
//   Every new extension test MUST extend this class and call
//   super() with the extension's default export and a fixture fetch function.
//
// EXAMPLE:
//   import BaseExtensionTest from './BaseExtensionTest.js'
//   import { readFileSync } from 'fs'
//
//   const FIXTURE = readFileSync('./tests/fixtures/myext.xml', 'utf-8')
//
//   class MyExtTest extends BaseExtensionTest {
//     constructor() {
//       super({
//         extension: myExtension,           // the default export from src/myext.js
//         fixtureFetch: () => mockFetch(FIXTURE), // fetch mock returning fixture
//         name: 'MyExt',                    // used in test descriptions
//       })
//     }
//   }
//
//   const suite = new MyExtTest()
//   suite.run() // registers all shared tests via describe/it
//
// WHAT THIS ENFORCES:
//   - Every extension result has the correct shape (title, link, hash, etc.)
//   - accuracy is always 'high', 'medium', or 'low'
//   - link is always a valid magnet URI or .torrent URL
//   - test() returns true when reachable
//   - test() throws a user-friendly error on HTTP errors
//   - single() returns [] when titles is empty
//   - single() throws a user-friendly error on network failure
//
// WHAT YOU ADD IN YOUR OWN TEST FILE:
//   - Source-specific field extraction tests (title, hash, size, seeders, etc.)
//   - Source-specific option tests (keyword, domain, category, etc.)
//   - Source-specific edge cases (episode matching, resolution filtering, etc.)

import { describe, it, expect, vi } from 'vitest'

// ─── Shared mock helpers ──────────────────────────────────────────────────────
// Exported so individual test files can use them without reimplementing

/**
 * Create a mock fetch function that returns the given body string.
 * @param {string} body
 * @param {number} status
 */
export function mockFetch (body, status = 200) {
  return vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    text: () => Promise.resolve(body),
    json: () => Promise.resolve(JSON.parse(body)),
  })
}

/**
 * Create a mock fetch function that rejects with a network error.
 * @param {string} message
 */
export function mockFetchError (message = 'Network error') {
  return vi.fn().mockRejectedValue(new Error(message))
}

// ─── Valid accuracy values ────────────────────────────────────────────────────
const VALID_ACCURACY = new Set(['high', 'medium', 'low'])

// ─── Result shape validator ───────────────────────────────────────────────────

/**
 * Assert that a single TorrentResult has the correct shape.
 * Throws a descriptive error if any field is missing or the wrong type.
 * Call this on every result returned by an extension to ensure compliance.
 *
 * Required fields per Hayase extension spec:
 *   title     — string, non-empty
 *   link      — string, valid magnet URI or .torrent URL
 *   hash      — string, non-empty
 *   seeders   — number >= 0
 *   leechers  — number >= 0
 *   downloads — number >= 0
 *   size      — number >= 0
 *   date      — Date object
 *   accuracy  — 'high' | 'medium' | 'low'
 *
 * @param {object} result
 */
export function assertValidResult (result) {
  expect(result, 'Result must be an object').toBeTypeOf('object')
  expect(result, 'Result must not be null').not.toBeNull()

  // title
  expect(result.title, 'result.title must be a string').toBeTypeOf('string')
  expect(result.title.length, 'result.title must not be empty').toBeGreaterThan(0)

  // link — must be a magnet URI or a .torrent URL
  expect(result.link, 'result.link must be a string').toBeTypeOf('string')
  const isValidLink = result.link.startsWith('magnet:?xt=urn:btih:') || result.link.endsWith('.torrent')
  expect(isValidLink, `result.link must be a magnet URI or .torrent URL, got: ${result.link}`).toBe(true)

  // hash
  expect(result.hash, 'result.hash must be a string').toBeTypeOf('string')
  expect(result.hash.length, 'result.hash must not be empty').toBeGreaterThan(0)

  // numeric fields
  expect(result.seeders,   'result.seeders must be a number').toBeTypeOf('number')
  expect(result.leechers,  'result.leechers must be a number').toBeTypeOf('number')
  expect(result.downloads, 'result.downloads must be a number').toBeTypeOf('number')
  expect(result.size,      'result.size must be a number').toBeTypeOf('number')
  expect(result.seeders,   'result.seeders must be >= 0').toBeGreaterThanOrEqual(0)
  expect(result.leechers,  'result.leechers must be >= 0').toBeGreaterThanOrEqual(0)
  expect(result.downloads, 'result.downloads must be >= 0').toBeGreaterThanOrEqual(0)
  expect(result.size,      'result.size must be >= 0').toBeGreaterThanOrEqual(0)

  // date
  expect(result.date, 'result.date must be a Date object').toBeInstanceOf(Date)
  expect(Number.isFinite(result.date.getTime()), 'result.date must be a valid Date').toBe(true)

  // accuracy
  expect(result.accuracy, 'result.accuracy must be a string').toBeTypeOf('string')
  expect(
    VALID_ACCURACY.has(result.accuracy),
    `result.accuracy must be 'high', 'medium', or 'low', got: '${result.accuracy}'`
  ).toBe(true)
}

// ─── Base class ───────────────────────────────────────────────────────────────

export default class BaseExtensionTest {
  /**
   * @param {object} opts
   * @param {object} opts.extension      — the default export from the source file
   * @param {Function} opts.fixtureFetch — function that returns a mock fetch using the fixture
   * @param {string} opts.name           — extension name, used in test descriptions
   */
  constructor ({ extension, fixtureFetch, name }) {
    if (!extension) throw new Error('BaseExtensionTest: extension is required')
    if (!fixtureFetch) throw new Error('BaseExtensionTest: fixtureFetch is required')
    if (!name) throw new Error('BaseExtensionTest: name is required')

    this.extension    = extension
    this.fixtureFetch = fixtureFetch
    this.name         = name
  }

  /**
   * Build a minimal valid AnimeQuery object for testing.
   * Individual tests can override specific fields as needed.
   * @param {object} overrides
   * @returns {object}
   */
  makeQuery (overrides = {}) {
    return {
      titles:      ['Test Anime'],
      episode:     undefined,
      resolution:  '',
      exclusions:  [],
      anilistId:   12345,
      anidbEid:    undefined,
      anidbAid:    undefined,
      fetch:       this.fixtureFetch(),
      ...overrides,
    }
  }

  /**
   * Register all shared tests.
   * Call this at the bottom of your test file after instantiating your class.
   *
   * These tests run for EVERY extension — if any fail, the extension
   * does not meet the minimum requirements for this repo.
   */
  run () {
    const { extension, name, fixtureFetch } = this

    // ── Result shape ──────────────────────────────────────────────────────────
    describe(`${name} — result shape`, () => {
      it('every result from single() has the correct shape', async () => {
        const results = await extension.single(this.makeQuery())
        // Skip if the extension legitimately returns empty for this query
        // (e.g. ID-based extensions with no anilistId match) — that's OK
        for (const result of results) {
          assertValidResult(result)
        }
      })

      it('every result from batch() has the correct shape', async () => {
        const results = await extension.batch(this.makeQuery())
        for (const result of results) {
          assertValidResult(result)
          // batch() results must have type='batch'
          expect(result.type, 'batch() results must have type="batch"').toBe('batch')
        }
      })

      it('every result from movie() has the correct shape', async () => {
        const results = await extension.movie(this.makeQuery())
        for (const result of results) {
          assertValidResult(result)
        }
      })
    })

    // ── Empty titles ──────────────────────────────────────────────────────────
    describe(`${name} — empty titles`, () => {
      it('single() returns [] when titles is empty', async () => {
        const results = await extension.single(this.makeQuery({ titles: [], fetch: fixtureFetch() }))
        expect(results).toEqual([])
      })

      it('batch() returns [] when titles is empty', async () => {
        const results = await extension.batch(this.makeQuery({ titles: [], fetch: fixtureFetch() }))
        expect(results).toEqual([])
      })

      it('movie() returns [] when titles is empty', async () => {
        const results = await extension.movie(this.makeQuery({ titles: [], fetch: fixtureFetch() }))
        expect(results).toEqual([])
      })
    })

    // ── Network errors ────────────────────────────────────────────────────────
    describe(`${name} — network errors`, () => {
      it('single() throws a user-friendly error on network failure', async () => {
        await expect(
          extension.single(this.makeQuery({ fetch: mockFetchError() }))
        ).rejects.toThrow()
        // Error message must not be a raw JS error — must be human readable
        try {
          await extension.single(this.makeQuery({ fetch: mockFetchError('fetch failed') }))
        } catch (err) {
          expect(err.message, 'Error message must not be a raw TypeError').not.toMatch(/^TypeError/)
          expect(err.message.length, 'Error message must be descriptive').toBeGreaterThan(10)
        }
      })
    })

    // ── test() method ─────────────────────────────────────────────────────────
    describe(`${name} — test()`, () => {
      it('test() returns true when the source is reachable', async () => {
        const result = await extension.test({ fetch: fixtureFetch() })
        expect(result).toBe(true)
      })

      it('test() throws when the source returns HTTP 503', async () => {
        await expect(
          extension.test({ fetch: mockFetch('Service Unavailable', 503) })
        ).rejects.toThrow('503')
      })
    })
  }
}
