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
 * Send the full report to ntfy as one notification, formatted as a
 * markdown table. Note: markdown only renders when you open the
 * notification in the ntfy app/web client — the initial banner/lock
 * screen preview on your phone shows plain text, since that's an OS
 * limitation, not something this script controls.
 * @param {{ name: string, alive: boolean, message: string, ms: number|null }[]} results
 */
async function sendReport (results) {
	const deadCount = results.filter(r => !r.alive).length

	// Plain-text title for the system notification banner — headers
	// don't reliably support markdown or raw unicode
	const title = deadCount === 0
		? `All ${results.length} sources alive`
		: `${deadCount}/${results.length} source(s) down`

	const heading = deadCount === 0
		? `# Hayase Extensions: All ${results.length} sources alive`
		: `# Hayase Extensions: ${deadCount}/${results.length} sources down`

	// One row per extension. Alive rows show response time; dead rows
	// show the error message that extension's test() threw.
	const rows = results
		.map(r => {
			const status = r.alive ? '✅' : '❌'
			const detail = r.alive ? `${r.ms}ms` : r.message
			return `| ${status} | ${r.name} | ${detail} |`
		})
		.join('\n')

	const body = [
		heading,
		'',
		'| Status | Extension | Detail |',
		'|---|---|---|',
		rows,
	].join('\n')

	const res = await fetch(`https://ntfy.sh/${NTFY_TOPIC}`, {
		method: 'POST',
		headers: {
			'Title': title,
			'Priority': deadCount > 0 ? 'high' : 'default',
			// ntfy converts these shortcodes into real emoji on the device
			'Tags': deadCount > 0 ? 'warning' : 'white_check_mark',
			// Tells ntfy to render the body as markdown when opened
			'Markdown': 'yes',
		},
		body,
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
