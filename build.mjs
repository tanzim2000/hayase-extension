// build.mjs — esbuild bundler script for hayase-extension
//
// Usage:
//   node build.mjs          → builds all extensions into dist/ (minified)
//   node build.mjs --watch  → rebuilds on every save (not minified, easier to read)
//
// Output: dist/nyaasi.js, dist/animetosho.js, etc.
// Each output file is fully self-contained — no imports, ready for Hayase to load.

import esbuild from 'esbuild'

// Check if --watch flag was passed (e.g. node build.mjs --watch)
const watch = process.argv.includes('--watch')

// esbuild configuration
const config = {

  // One entry per extension — esbuild will bundle each independently
  entryPoints: {
    nyaasi:     'src/nyaasi.js',
    animetosho: 'src/animetosho.js',
    seadex:     'src/seadex.js',
    subsplease: 'src/subsplease.js',
    tokyotosho: 'src/tokyotosho.js',
    sukebei:    'src/sukebei.js',
  },

  // bundle: true — follow all imports and inline them into one file
  // This is the key step that makes Hayase able to load the extension
  // without needing abstract.js or any other file separately
  bundle: true,

  // ESM format — uses export default syntax, required by Hayase
  format: 'esm',

  // Target modern browsers/environments (Hayase runs on Electron which supports ES2022)
  target: 'es2022',

  // platform: browser — don't use Node.js built-ins like fs, path, etc.
  platform: 'browser',

  // Output directory — all bundled files go here
  outdir: 'dist',

  // Minify in production (build), don't minify in watch mode (easier to debug)
  minify: !watch,

  // Strip all comments from output (keeps file size small)
  legalComments: 'none',

  // No source maps needed — extensions run in Hayase, not a browser devtools
  sourcemap: false,

  // Show build info in terminal
  logLevel: 'info',
}

if (watch) {
  // Watch mode — rebuild dist/ whenever a src/ file changes
  const ctx = await esbuild.context(config)
  await ctx.watch()
  console.log('Watching src/ for changes — press Ctrl+C to stop')
} else {
  // Normal build — bundle everything once and exit
  await esbuild.build(config)
}
