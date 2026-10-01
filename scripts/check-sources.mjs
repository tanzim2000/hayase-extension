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
// you're not watching the GitHub Actions tab — and rewrites two blocks
// of README.md from this run's actual results: the "Sources last verified"
// timestamp and the Available column of the Torrent Sources table.

import { readdir, readFile, writeFile } from 'node:fs/promises'

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
 * @returns {{ fetch: typeof fetch, hosts: Set<string> }}
 */
function trackedFetch () {
	const hosts = new Set()
	const wrapped = (input, init) => {
		try {
			const raw = typeof input === 'string' ? input : (input?.url ?? String(input))
			hosts.add(new URL(raw).host)
		} catch {
			// Not a parseable URL — the real fetch below will complain about it.
		}
		return fetch(input, init)
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
	const tracker = trackedFetch()
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
 * Replace a marked block in README.md.
 * Everything between <!-- NAME --> and <!-- /NAME --> is swapped out, and
 * the markers themselves are rewritten too so the block stays replaceable
 * on the next run.
 *
 * If the markers aren't present the README is returned untouched rather
 * than throwing — a missing block means "this README doesn't want that
 * section", not a broken script.
 *
 * @param {string} readme
 * @param {string} markerName — e.g. "LAST_CHECKED"
 * @param {string} body — the content to put between the markers
 * @returns {string}
 */
function replaceBlock (readme, markerName, body) {
	const pattern = new RegExp(`<!-- ${markerName} -->[\\s\\S]*?<!-- \\/${markerName} -->`)
	if (!pattern.test(readme)) {
		console.warn(`  (README has no <!-- ${markerName} --> block — skipping that section)`)
		return readme
	}
	return readme.replace(pattern, `<!-- ${markerName} -->\n${body}\n<!-- /${markerName} -->`)
}

/**
 * Build the "Sources last verified" line.
 * @returns {string}
 */
function buildTimestampBlock () {
	const now = new Date()
	const datePart = now.toLocaleString('en-US', {
		month: 'long',
		day: 'numeric',
		year: 'numeric',
		timeZone: 'UTC',
	})
	const timePart = now.toLocaleString('en-US', {
		hour: '2-digit',
		minute: '2-digit',
		hour12: false,
		timeZone: 'UTC',
	})
	return `> 🕐 Sources last verified: ${datePart} at ${timePart} UTC`
}

// Manifest entries with a known functional problem beyond simple
// reachability (see "Known Issues" in README.md). The automated check
// below only tests whether test() resolves — it can't detect "resolves
// fine but search results are broken" — so without this list, a source
// like Tokyo Toshokan would show a plain "✅ Yes" right above a Known
// Issues bullet saying it doesn't work. Keep this in sync with that
// section by hand when you add or resolve an issue.
// Empty right now. Add a manifest name, e.g. new Set(['Tokyo Toshokan']), when needed.
const KNOWN_ISSUES = new Set([])

/**
 * Rewrite the "Available" cell of every row in the README's Torrent
 * Sources table, based on this run's actual results — so the table
 * never drifts from reality the way a hand-typed one would.
 *
 * Several manifest entries in index.json can share one src/ file (e.g.
 * "Nyaa", "Nyaa (Dub)", and "Nyaa (Non-English)" are all backed by
 * nyaasi.js), so this maps each manifest entry's `code` field back to
 * the src/ filename that was actually tested, then updates every
 * README row whose Name cell matches that manifest entry's `name`.
 *
 * Only the Available cell is touched — Description/Media/Languages are
 * left exactly as a human wrote them.
 *
 * @param {string} readme
 * @param {object[]} results
 * @param {Map<string, object[]>} manifestByFile
 * @returns {string}
 */
function applyAvailability (readme, results, manifestByFile) {
	// src/ filename (no extension) → alive, straight from this run.
	const aliveByFile = new Map(results.map(r => [r.name, r.alive]))

	// Manifest display name (e.g. "Nyaa (Dub)") → alive, resolved via
	// the src/ file that actually backs that manifest entry. Every entry
	// sharing a file gets that file's result, which is correct: if
	// nyaasi.js can't reach Nyaa, all three Nyaa rows are down.
	const aliveByDisplayName = new Map()
	for (const [fileKey, entries] of manifestByFile) {
		if (!aliveByFile.has(fileKey)) continue
		for (const entry of entries) {
			aliveByDisplayName.set(entry.name, aliveByFile.get(fileKey))
		}
	}

	return readme.split('\n').map(line => {
		if (!line.startsWith('|')) return line

		const cells = line.split('|')
		// A real data row looks like: "", " **Nyaa** ", ..., " ✅ Yes ", ""
		// — need at least a name cell and an Available cell between the
		// leading/trailing empties from split().
		if (cells.length < 4) return line

		const rawName = cells[1].trim().replace(/\*\*/g, '')
		if (!aliveByDisplayName.has(rawName)) return line

		const alive = aliveByDisplayName.get(rawName)
		let cell
		if (!alive) {
			cell = '❌ No'
		} else if (KNOWN_ISSUES.has(rawName)) {
			// Reachable, but flagged in Known Issues as not actually
			// working — say so here instead of a bare, misleading "Yes".
			cell = '⚠️ Yes\\*'
		} else {
			cell = '✅ Yes'
		}
		cells[cells.length - 2] = ` ${cell} `
		return cells.join('|')
	}).join('\n')
}

/**
 * Read README.md once, apply every update, write it back once.
 *
 * Doing both edits in a single read/write is deliberate: the previous
 * version read and wrote the file separately per section, so a crash
 * partway through could leave the README half-updated and internally
 * inconsistent.
 *
 * @param {object[]} results
 * @param {Map<string, object[]>} manifestByFile
 */
async function updateReadme (results, manifestByFile) {
	const readmePath = new URL('../README.md', import.meta.url)
	let readme = await readFile(readmePath, 'utf8')

	readme = replaceBlock(readme, 'LAST_CHECKED', buildTimestampBlock())
	readme = applyAvailability(readme, results, manifestByFile)

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
