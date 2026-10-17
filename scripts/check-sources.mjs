// check-sources.mjs — health check for all Hayase extensions
//
// Goes through every extension file in src/, and calls the SAME test()
// function Hayase itself calls to check "is this source alive?".
// No per-extension logic needed here — every extension already exports
// test(query), so this script just loads each file and calls it.
//
// Usage: node scripts/check-sources.mjs
//
// At the end, sends one full report to ntfy — so you find out even if
// you're not watching the GitHub Actions tab — and rewrites two parts
// of README.md (the "dashboard") from this run's actual results:
//   1. The Status column of the Torrent Sources table: one colored badge
//      per source ("online", "offline", or "issue"). Response times are
//      deliberately NOT shown there — they're measured from GitHub's
//      servers, so they say little about what a real user would see.
//      They only go in the ntfy report.
//   2. The LAST_CHECKED date in the centered "Last checked" line right
//      under that table.

import { execFile } from 'node:child_process'
import { readdir, readFile, writeFile } from 'node:fs/promises'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

// The ntfy topic comes from a GitHub Actions secret, NOT hardcoded here.
// This repo is public — anyone can read a committed file. If the topic
// name were written directly in this script, anyone could subscribe to
// your ntfy topic (read your alerts) or even publish fake ones to it.
const NTFY_TOPIC = process.env.NTFY_TOPIC

if (!NTFY_TOPIC) {
	console.error('NTFY_TOPIC environment variable is not set. Add it as a repo secret — see the workflow file for instructions.')
	process.exit(1)
}

// Folder containing all extension source files.
// This script now lives in scripts/, so src/ is one level up.
const SRC_DIR = new URL('../src/', import.meta.url)

// Status badge colors. Change them here and the next run repaints the table.
const COLORS = {
	online: '22C55E',   // green — source responded
	issue: 'F59E0B',    // amber — responds, but listed in KNOWN_ISSUES below
	offline: 'FD0000',  // Hayase red — source did not respond
}

/**
 * Read index.json and group its entries by the src/ file that backs them.
 *
 * Several manifest entries can share one src/ file — "Nyaa", "Nyaa (Dub)"
 * and "Nyaa (Non-English)" are all nyaasi.js — so each key maps to an
 * ARRAY of entries, first one first.
 *
 * @returns {Promise<Map<string, object[]>>} e.g. "nyaasi" -> [entry, entry, entry]
 */
async function loadManifestByFile () {
	const indexPath = new URL('../index.json', import.meta.url)
	const manifest = JSON.parse(await readFile(indexPath, 'utf8'))

	const byFile = new Map()
	for (const entry of manifest) {
		const match = entry.code?.match(/\/([^/]+)\.js$/)
		if (!match) continue
		const fileKey = match[1]
		if (!byFile.has(fileKey)) byFile.set(fileKey, [])
		byFile.get(fileKey).push(entry)
	}
	return byFile
}

/**
 * Pull the default value out of every option a manifest entry declares.
 *
 * This is what gets handed to the extension during the check. It is NOT
 * what any individual user is running — real option values live in that
 * person's Hayase settings and this script can't see them. What it can
 * verify is the configuration the repo actually ships, which is the thing
 * a new install gets and the thing this repo is responsible for.
 *
 * @param {object} [entry]
 * @returns {object}
 */
function optionDefaults (entry) {
	const options = entry?.options
	if (!options) return {}
	return Object.fromEntries(
		Object.entries(options).map(([key, spec]) => [key, spec?.default ?? ''])
	)
}

/**
 * A small fetch() stand-in that makes the request with the curl program.
 *
 * WHY: on GitHub's servers, Node's built-in fetch() cannot connect to some
 * sites (Sukebei, for one) — it times out while setting up the secure
 * connection — but curl, run on the very same machine, connects in a tenth
 * of a second. The sites accept curl and drop Node's handshake, which
 * has nothing to do with whether they work for real users. Using curl here
 * makes the check measure "is the site up?" instead of "does this site like
 * Node's handshake?".
 *
 * It only supports what the extensions use: GET requests, custom headers,
 * an abort signal, and reading the body as text or JSON.
 *
 * @param {string | URL} url
 * @param {{ headers?: Record<string, string>, signal?: AbortSignal }} [init]
 * @returns {Promise<{ ok: boolean, status: number, text: () => Promise<string>, json: () => Promise<any> }>}
 */
async function curlFetch (url, init = {}) {
	// "-w" makes curl print the HTTP status after the body, on its own line.
	const args = ['-sS', '-L', '--max-time', '20', '-w', '\n%{http_code}']
	for (const [key, value] of Object.entries(init.headers ?? {})) {
		args.push('-H', `${key}: ${value}`)
	}
	args.push(String(url))

	// If the extension aborts (its own timeout), execFile throws an
	// AbortError — the same error name real fetch() throws, which the
	// extensions already know how to handle.
	let stdout
	try {
		({ stdout } = await execFileAsync('curl', args, {
			maxBuffer: 64 * 1024 * 1024,
			signal: init.signal,
		}))
	} catch (err) {
		if (err.name === 'AbortError') throw err
		// Keep only curl's own one-line reason, e.g.
		// "curl: (6) Could not resolve host: example.invalid"
		const reason = String(err.stderr || err.message).trim().split('\n').pop()
		throw new TypeError(`fetch failed (${reason})`)
	}

	const split = stdout.lastIndexOf('\n')
	const status = Number(stdout.slice(split + 1))
	const body = stdout.slice(0, split)
	return {
		ok: status >= 200 && status < 300,
		status,
		text: async () => body,
		json: async () => JSON.parse(body),
	}
}

/**
 * Pick the fetch the checks will use: curl if this machine has it,
 * otherwise Node's own fetch().
 * @returns {Promise<typeof fetch>}
 */
async function pickFetch () {
	try {
		await execFileAsync('curl', ['--version'])
		return curlFetch
	} catch {
		console.warn('curl not found — using Node fetch() instead (some sites may time out from GitHub\'s servers)')
		return fetch
	}
}

/**
 * Wrap fetch so we can see which sites an extension talks to during its check.
 *
 * WHY: inside Hayase, extensions run in a browser worker, and Hayase only
 * switches off the browser's cross-origin blocking for the site written in
 * each extension's manifest "url" field (base64 in index.json). If test()
 * fetches a DIFFERENT site than the manifest declares, Hayase blocks it and
 * the user sees a vague "Failed to fetch" — even though the site is perfectly
 * alive. This script runs in Node, which has no such blocking, so without
 * this wrapper it would report that broken extension as healthy.
 * (This is exactly what happened with a typo'd Tokyo Toshokan url.)
 *
 * @param {typeof fetch} baseFetch — the fetch to call after recording the host
 * @returns {{ fetch: typeof fetch, hosts: Set<string> }}
 */
function trackedFetch (baseFetch) {
	const hosts = new Set()
	const wrapped = (input, init) => {
		try {
			const raw = typeof input === 'string' ? input : (input?.url ?? String(input))
			hosts.add(new URL(raw).host)
		} catch {
			// Not a parseable URL — the real fetch below will complain about it.
		}
		return baseFetch(input, init)
	}
	return { fetch: wrapped, hosts }
}

/**
 * Compare the sites test() fetched against the sites the manifest declares.
 *
 * @param {Set<string>} fetchedHosts — hosts seen by trackedFetch()
 * @param {object[]} entries — manifest entries backed by this file
 * @returns {string|null} a problem description, or null when everything matches
 */
function manifestMismatch (fetchedHosts, entries) {
	for (const entry of entries) {
		if (!entry.url) continue
		let declared
		try {
			declared = new URL(atob(entry.url)).host
		} catch {
			return `manifest "url" of ${entry.name} is not valid base64 / a valid URL`
		}
		const stray = [...fetchedHosts].filter(h => h !== declared)
		if (stray.length > 0) {
			return `manifest url of ${entry.name} says ${declared}, but test() fetched ${stray.join(', ')} — Hayase will block that as cross-origin ("Failed to fetch")`
		}
	}
	return null
}

/**
 * Test one extension file by loading it and calling its test() function.
 * @param {string} filename — e.g. "nyaasi.js"
 * @param {object[]} [entries] — manifest entries backed by this file
 * @returns {Promise<{ name: string, displayName: string, alive: boolean, message: string, ms: number|null }>}
 */
async function checkExtension (filename, entries = []) {
	const name = filename.replace(/\.js$/, '')
	// Prefer the manifest's human-readable name ("Sukebei") over the raw
	// filename ("sukebei") wherever this gets shown to a person.
	const displayName = entries[0]?.name || name
	const options = optionDefaults(entries[0])
	const fileUrl = new URL(filename, SRC_DIR)

	// Step 1 — try to load the file as a module
	let extension
	try {
		extension = (await import(fileUrl.href)).default
	} catch (err) {
		return { name, displayName, alive: false, message: `Failed to load file: ${err.message}`, ms: null }
	}

	// Step 2 — make sure it actually has a test() function to call
	if (typeof extension?.test !== 'function') {
		return { name, displayName, alive: false, message: 'No test() function exported — cannot verify', ms: null }
	}

	// Step 3 — call test(), timing how long it takes. Each extension's
	// test() either resolves (alive) or throws a descriptive Error (dead)
	// — that's the existing convention already used by every file in src/.
	const tracker = trackedFetch(checkFetch)
	const start = Date.now()
	let result
	try {
		await extension.test({ fetch: tracker.fetch }, options)
		result = { name, displayName, alive: true, message: 'OK', ms: Date.now() - start }
	} catch (err) {
		result = { name, displayName, alive: false, message: err.message || 'Unknown error', ms: Date.now() - start }
	}

	// Step 3b — the site answered, but would Hayase actually let the
	// extension talk to it? See trackedFetch() for why Node can't tell.
	if (result.alive) {
		const mismatch = manifestMismatch(tracker.hosts, entries)
		if (mismatch) result = { ...result, alive: false, message: mismatch }
	}

	return result
}

/**
 * Replace a marked piece of README.md.
 * Everything between <!-- NAME --> and <!-- /NAME --> is swapped out, and
 * the markers themselves are kept so it stays replaceable on the next run.
 *
 * The markers can sit in the middle of a line, e.g.
 *   > 🕐 Last checked: <!-- LAST_CHECKED -->October 17, 2026<!-- /LAST_CHECKED -->
 * and the new text goes in exactly where the old text was, on the same
 * line. That keeps the "Last checked" line (a quote line inside the
 * centered block under the table) intact: only the date changes, so the
 * surrounding HTML and quote formatting are never touched.
 *
 * If the markers aren't present the README is returned untouched rather
 * than throwing — a missing block means "this README doesn't want that
 * section", not a broken script.
 *
 * @param {string} readme
 * @param {string} markerName — e.g. "LAST_CHECKED"
 * @param {string} body — the text to put between the markers
 * @returns {string}
 */
function replaceBlock (readme, markerName, body) {
	const pattern = new RegExp(`<!-- ${markerName} -->[\\s\\S]*?<!-- \\/${markerName} -->`)
	if (!pattern.test(readme)) {
		console.warn(`  (README has no <!-- ${markerName} --> block — skipping that section)`)
		return readme
	}
	// A function as the replacement, not a string: a "$&" or "$1" in the
	// text would otherwise be read as a regex back-reference and garble it.
	return readme.replace(pattern, () => `<!-- ${markerName} -->${body}<!-- /${markerName} -->`)
}

/**
 * Build the "last checked" date, e.g. "October 17, 2026 at 06:00 UTC".
 * @returns {string}
 */
function buildLastChecked () {
	const now = new Date()
	const datePart = now.toLocaleString('en-US', { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' })
	const timePart = now.toLocaleString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'UTC' })
	return `${datePart} at ${timePart} UTC`
}

// Manifest entries with a known functional problem beyond simple
// reachability (see "Known Issues" in README.md). The automated check
// below only tests whether test() resolves — it can't detect "resolves
// fine but search results are broken" — so without this list, a source
// like Tokyo Toshokan would show a green "online" badge right above a
// Known Issues bullet saying it doesn't work. Keep this in sync with that
// section by hand when you add or resolve an issue.
// Empty right now. Add a manifest name, e.g. new Set(['Tokyo Toshokan']), when needed.
const KNOWN_ISSUES = new Set([])

/**
 * Make text safe to put inside a shields.io badge URL.
 *
 * shields.io reads "-" as "the next part starts here" and "_" as a space,
 * so a literal dash or underscore has to be doubled ("--", "__"). After
 * that, encodeURIComponent turns spaces into %20 and "·" into %C2%B7,
 * so the text is safe to drop into a URL.
 *
 * @param {string} text
 * @returns {string}
 */
function shieldsText (text) {
	return encodeURIComponent(text.replace(/-/g, '--').replace(/_/g, '__'))
}

/**
 * Work out the status of every manifest entry (every row of the README
 * table) from the per-file results.
 *
 * Several manifest entries can share one src/ file, so each entry simply
 * gets its file's result: if nyaasi.js can't reach Nyaa, all three Nyaa
 * rows are down, and they share one response time.
 *
 * @param {object[]} results — one per src/ file, from checkExtension()
 * @param {Map<string, object[]>} manifestByFile
 * @returns {Map<string, { state: 'online'|'issue'|'offline' }>} keyed by manifest name
 */
function statusByEntry (results, manifestByFile) {
	const resultByFile = new Map(results.map(r => [r.name, r]))
	const statuses = new Map()
	for (const [fileKey, entries] of manifestByFile) {
		const result = resultByFile.get(fileKey)
		if (!result) continue
		for (const entry of entries) {
			let state = 'offline'
			if (result.alive) state = KNOWN_ISSUES.has(entry.name) ? 'issue' : 'online'
			statuses.set(entry.name, { state })
		}
	}
	return statuses
}

/**
 * Build the small badge that goes in one row's Status cell.
 * @param {{ state: string }} status
 * @returns {string} HTML
 */
function statusCell (status) {
	// A one-part badge: "/badge/<message>-<color>" has no gray left half,
	// just the colored pill — it reads the same on dark and light themes.
	const url = `https://img.shields.io/badge/${shieldsText(status.state)}-${COLORS[status.state]}?style=flat-square`
	return `<img src="${url}" alt="${status.state}" />`
}

/**
 * Rewrite the Status cell (the LAST cell) of every row in the README's
 * Torrent Sources table, based on this run's actual results — so the
 * table never drifts from reality the way a hand-typed one would.
 *
 * A row is matched by the bold name in its first cell, e.g.
 *   | <img ... /> **Nyaa (Dub)** | ... | <status badge> |
 * so the icon in front of the name doesn't get in the way.
 *
 * Only the Status cell is touched — Description/Media/Languages are
 * left exactly as a human wrote them.
 *
 * @param {string} readme
 * @param {Map<string, { state: string }>} statuses
 * @returns {string}
 */
function applyStatusColumn (readme, statuses) {
	return readme.split('\n').map(line => {
		if (!line.startsWith('|')) return line

		const cells = line.split('|')
		// A real data row looks like: "", " <img/> **Nyaa** ", ..., " <badge> ", ""
		// — need at least a name cell and a Status cell between the
		// leading/trailing empties from split().
		if (cells.length < 4) return line

		const nameMatch = cells[1].match(/\*\*(.+?)\*\*/)
		if (!nameMatch) return line
		const status = statuses.get(nameMatch[1].trim())
		if (!status) return line

		cells[cells.length - 2] = ` ${statusCell(status)} `
		return cells.join('|')
	}).join('\n')
}

/**
 * Read README.md once, apply every update, write it back once.
 *
 * Doing both edits in a single read/write is deliberate: reading and
 * writing the file separately per section means a crash partway through
 * could leave the README half-updated and internally inconsistent.
 *
 * @param {object[]} results
 * @param {Map<string, object[]>} manifestByFile
 */
async function updateReadme (results, manifestByFile) {
	const readmePath = new URL('../README.md', import.meta.url)
	let readme = await readFile(readmePath, 'utf8')

	readme = applyStatusColumn(readme, statusByEntry(results, manifestByFile))
	readme = replaceBlock(readme, 'LAST_CHECKED', buildLastChecked())

	await writeFile(readmePath, readme, 'utf8')
}

/**
 * Send the full report to ntfy as one plain-text notification.
 *
 * Sent as JSON rather than headers+body, because the title contains
 * emoji — HTTP headers are latin-1 only, so raw unicode in an
 * X-Title header gets mangled. ntfy's JSON endpoint is UTF-8 safe.
 *
 * No markdown anywhere: ntfy's renderer doesn't parse tables, so pipes
 * and dashes show up literally.
 *
 * Body layout: any dead sources listed first (outside the main list),
 * then the alive ones sorted fastest → slowest, with the fastest and
 * slowest tagged.
 * @param {object[]} results
 */
async function sendReport (results) {
	const dead = results.filter(r => !r.alive)
	const alive = results.filter(r => r.alive).sort((a, b) => a.ms - b.ms)

	let title
	if (dead.length === 0) {
		title = `Hayase Extensions: All ${results.length} sources alive 👌`
	} else if (alive.length === 0) {
		title = results.length === 1
			? `Hayase Extensions: The only source is dead 💀`
			: `Hayase Extensions: All ${results.length} sources dead 💀`
	} else {
		title = `Hayase Extensions: ${alive.length} source${alive.length === 1 ? '' : 's'} alive; ${dead.length} dead`
	}

	// Alive lines, fastest first. Only tag fastest/slowest when there
	// are at least two — otherwise one line would get both tags.
	const aliveLines = alive.map((r, i) => {
		let tag = ''
		if (alive.length > 1) {
			if (i === 0) tag = ' [FASTEST]'
			else if (i === alive.length - 1) tag = ' [SLOWEST]'
		}
		return `✅ ${r.name} (${r.ms}ms)${tag}`
	})

	const sections = []

	if (dead.length > 0) {
		sections.push(dead.map(r => `🪦 ${r.name} couldn't make it!`).join('\n'))
		// Only promise survivors if there actually are any — otherwise
		// we'd print "rest of it is alive" above an empty list.
		sections.push(alive.length > 0
			? 'Rest of it is alive, more or less...'
			: "Not a single one made it. That's everything, gone.")
	}

	if (alive.length > 0) sections.push(aliveLines.join('\n'))

	const res = await fetch('https://ntfy.sh/', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({
			topic: NTFY_TOPIC,
			title,
			// 3 = default, 5 = high
			priority: dead.length > 0 ? 5 : 3,
			message: sections.join('\n\n'),
		}),
	})

	if (!res.ok) {
		console.error(`ntfy notification failed: HTTP ${res.status}`)
	}
}

// ─── Main ─────────────────────────────────────────────────────────────────

const checkFetch = await pickFetch()
const manifestByFile = await loadManifestByFile()
const files = (await readdir(SRC_DIR)).filter(f => f.endsWith('.js'))

console.log(`Checking ${files.length} extension(s)...\n`)

const results = []
for (const file of files) {
	const fileKey = file.replace(/\.js$/, '')
	const result = await checkExtension(file, manifestByFile.get(fileKey) ?? [])
	results.push(result)

	console.log(`${result.alive ? 'PASS' : 'FAIL'} — ${result.displayName}${result.alive ? '' : `: ${result.message}`}`)
}

await sendReport(results)
await updateReadme(results, manifestByFile)

const deadCount = results.filter(r => !r.alive).length
const aliveCount = results.length - deadCount
console.log(`\n${aliveCount}/${results.length} sources alive`)

// Only fail the Actions run (red X) when EVERY source is down. A single
// flaky/dead source is expected from time to time and already gets
// surfaced clearly via the ntfy report above — it shouldn't turn the
// whole scheduled run red on its own. Total outage (nothing responding
// at all) is the actual signal worth a failed run.
// Remove the next line entirely if you'd rather the run always show
// green and rely on ntfy alone.
if (aliveCount === 0) process.exit(1)
