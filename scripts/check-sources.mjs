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
// you're not watching the GitHub Actions tab — and rewrites three blocks
// of README.md from this run's actual results: the "Sources last verified"
// timestamp, the Available column of the Torrent Sources table, and the
// mirror status block.
//
// ─── THE mirrors() HOOK ──────────────────────────────────────────────────
//
// Some sources can be reached through more than one domain. Those files
// export an EXTRA function beyond Hayase's contract:
//
//   mirrors(query, options) -> { active: string|null, checked: [...] }
//
// It is optional. Hayase never calls it and never will — it exists only
// for this script. Any extension that doesn't export it is checked exactly
// as before, so adding the hook to one file changes nothing for the rest.
// Unlike test(), it does not throw: "every mirror is dead" is a result
// worth printing, not an error to swallow.
//
// ─────────────────────────────────────────────────────────────────────────

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
 * Test one extension file by loading it and calling its test() function,
 * plus its mirrors() function if it has one.
 * @param {string} filename — e.g. "nyaasi.js"
 * @param {object[]} [entries] — manifest entries backed by this file
 * @returns {Promise<{ name: string, displayName: string, alive: boolean, message: string, ms: number|null, mirrors: object|null }>}
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
		return { name, displayName, alive: false, message: `Failed to load file: ${err.message}`, ms: null, mirrors: null }
	}

	// Step 2 — make sure it actually has a test() function to call
	if (typeof extension?.test !== 'function') {
		return { name, displayName, alive: false, message: 'No test() function exported — cannot verify', ms: null, mirrors: null }
	}

	// Step 3 — call test(), timing how long it takes. Each extension's
	// test() either resolves (alive) or throws a descriptive Error (dead)
	// — that's the existing convention already used by every file in src/.
	const start = Date.now()
	let result
	try {
		await extension.test({ fetch }, options)
		result = { name, displayName, alive: true, message: 'OK', ms: Date.now() - start, mirrors: null }
	} catch (err) {
		result = { name, displayName, alive: false, message: err.message || 'Unknown error', ms: Date.now() - start, mirrors: null }
	}

	// Step 4 — if this extension reports mirrors, collect that too. Wrapped
	// in its own try/catch so a bug in an optional reporting hook can never
	// turn a healthy source into a failed one.
	if (typeof extension.mirrors === 'function') {
		try {
			result.mirrors = await extension.mirrors({ fetch }, options)
		} catch (err) {
			console.warn(`  (${name}: mirrors() hook threw — ${err.message})`)
		}
	}

	return result
}

/**
 * Turn a base URL into just its hostname, for display.
 * "https://sukebei.nyaa.si/" -> "sukebei.nyaa.si"
 * @param {string} url
 * @returns {string}
 */
function hostOf (url) {
	try {
		return new URL(url).host
	} catch {
		return url
	}
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

/**
 * Build the mirror status block — one line per source that reports mirrors.
 *
 * Only shows domains that were actually configured and probed. Sources with
 * no mirrors() hook are simply absent, which is why this reads as a short
 * note rather than a table: today it's one source, and a one-row table
 * looks broken.
 *
 * @param {object[]} results
 * @returns {string}
 */
function buildMirrorBlock (results) {
	const reporting = results.filter(r => r.mirrors)
	if (reporting.length === 0) {
		return '> No sources currently report mirror status.'
	}

	const lines = reporting.map(r => {
		const { active, checked } = r.mirrors
		const total = checked.length

		if (!active) {
			return `> **${r.displayName}** — no working domain. Tried ${total}: ` +
				checked.map(c => `\`${hostOf(c.domain)}\` (${c.error})`).join(', ')
		}

		const up = checked.filter(c => c.ok)
		const down = checked.filter(c => !c.ok)

		let line = `> **${r.displayName}** — currently served by \`${hostOf(active)}\``
		if (total > 1) {
			line += ` (${up.length} of ${total} domains responding`
			if (down.length > 0) {
				line += `; down: ${down.map(c => `\`${hostOf(c.domain)}\``).join(', ')}`
			}
			line += ')'
		}
		return line
	})

	return lines.join('\n>\n')
}

// Manifest entries with a known functional problem beyond simple
// reachability (see "Known Issues" in README.md). The automated check
// below only tests whether test() resolves — it can't detect "resolves
// fine but search results are broken" — so without this list, a source
// like Tokyo Toshokan would show a plain "✅ Yes" right above a Known
// Issues bullet saying it doesn't work. Keep this in sync with that
// section by hand when you add or resolve an issue.
const KNOWN_ISSUES = new Set(['Tokyo Toshokan'])

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
 * Doing all three edits in a single read/write is deliberate: the previous
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
	readme = replaceBlock(readme, 'MIRRORS', buildMirrorBlock(results))
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
 * slowest tagged, then mirror notes if there are any worth mentioning.
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

	// Mirror notes. Names here are file-derived (sukebei), matching the rest
	// of this notification, rather than the manifest's display name
	// (Sukebei) that README.md uses — the two audiences are different and
	// the report should be internally consistent.
	// A source with exactly one configured domain is skipped
	// entirely — "1 of 1 domains up" is noise that would appear in every
	// single notification forever. Only a real fallback situation is worth
	// putting on your phone.
	const mirrorLines = []
	for (const r of results) {
		if (!r.mirrors) continue
		const { active, checked } = r.mirrors
		if (checked.length < 2) continue

		const down = checked.filter(c => !c.ok)
		if (active && down.length === 0) continue  // all mirrors fine, nothing to say

		if (!active) {
			mirrorLines.push(`🔀 ${r.name}: no domain responding (${checked.length} tried)`)
		} else {
			mirrorLines.push(`🔀 ${r.name}: on ${hostOf(active)}; ${down.length} of ${checked.length} domains down`)
		}
	}

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
	if (mirrorLines.length > 0) sections.push(mirrorLines.join('\n'))

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

	if (result.mirrors) {
		const { active, checked } = result.mirrors
		console.log(`       mirrors: ${active ? hostOf(active) : 'NONE WORKING'} (${checked.filter(c => c.ok).length}/${checked.length} up)`)
	}
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
