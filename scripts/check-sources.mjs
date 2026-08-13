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
// you're not watching the GitHub Actions tab — and rewrites the
// "Sources last verified" line in README.md so it always reflects the
// most recent actual run.

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
 * Test one extension file by loading it and calling its test() function.
 * @param {string} filename — e.g. "nyaasi.js"
 * @returns {Promise<{ name: string, alive: boolean, message: string, ms: number|null }>}
 */
async function checkExtension (filename) {
	const name = filename.replace(/\.js$/, '')
	const fileUrl = new URL(filename, SRC_DIR)

	// Step 1 — try to load the file as a module
	let extension
	try {
		extension = (await import(fileUrl.href)).default
	} catch (err) {
		return { name, alive: false, message: `Failed to load file: ${err.message}`, ms: null }
	}

	// Step 2 — make sure it actually has a test() function to call
	if (typeof extension?.test !== 'function') {
		return { name, alive: false, message: 'No test() function exported — cannot verify', ms: null }
	}

	// Step 3 — call test(), timing how long it takes. Each extension's
	// test() either resolves (alive) or throws a descriptive Error (dead)
	// — that's the existing convention already used by every file in src/.
	const start = Date.now()
	try {
		await extension.test({ fetch })
		return { name, alive: true, message: 'OK', ms: Date.now() - start }
	} catch (err) {
		return { name, alive: false, message: err.message || 'Unknown error', ms: Date.now() - start }
	}
}

/**
 * Rewrite the "Sources last verified" line in README.md with the
 * current time, so the README always shows when this last actually ran
 * instead of a stale hand-typed date.
 *
 * Looks for the block between <!-- LAST_CHECKED --> and
 * <!-- /LAST_CHECKED --> markers in README.md and replaces it entirely.
 */
async function updateReadmeTimestamp () {
	const readmePath = new URL('../README.md', import.meta.url)
	const readme = await readFile(readmePath, 'utf8')

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

	const newBlock = `<!-- LAST_CHECKED -->\n> 🕐 Sources last verified: ${datePart} at ${timePart} UTC\n<!-- /LAST_CHECKED -->`

	const updated = readme.replace(
		/<!-- LAST_CHECKED -->[\s\S]*?<!-- \/LAST_CHECKED -->/,
		newBlock,
	)

	await writeFile(readmePath, updated, 'utf8')
}

/**
 * Send the full report to ntfy as one plain-text notification.
 *
 * Sent as JSON rather than headers+body, because the title contains
 * emoji — HTTP headers are latin-1 only, so raw unicode in an
 * X-Title header gets mangled. ntfy's JSON endpoint is UTF-8 safe.
 *
 * Body layout: any dead sources listed first (outside the main list),
 * then the alive ones sorted fastest → slowest, with the fastest and
 * slowest tagged.
 * @param {{ name: string, alive: boolean, message: string, ms: number|null }[]} results
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

const files = (await readdir(SRC_DIR)).filter(f => f.endsWith('.js'))

console.log(`Checking ${files.length} extension(s)...\n`)

const results = []
for (const file of files) {
	const result = await checkExtension(file)
	results.push(result)
	console.log(`${result.alive ? 'PASS' : 'FAIL'} — ${result.name}${result.alive ? '' : `: ${result.message}`}`)
}

await sendReport(results)
await updateReadmeTimestamp()

const deadCount = results.filter(r => !r.alive).length
console.log(`\n${results.length - deadCount}/${results.length} sources alive`)

// If anything's down, exit with a failure code. This makes the GitHub
// Actions run itself show as failed (red X) as a second signal beyond
// ntfy. Remove the next line if you'd rather the run always show green
// and rely on ntfy alone.
if (deadCount > 0) process.exit(1)
