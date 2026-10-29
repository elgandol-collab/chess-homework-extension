// build.mjs — bundles src/ and copies static assets into dist/ (the folder you load in chrome://extensions or zip for the Web Store).
import esbuild from 'esbuild'; import fs from 'node:fs'; import path from 'node:path';
const dist = 'dist'; fs.rmSync(dist, { recursive: true, force: true }); fs.mkdirSync(dist + '/engine', { recursive: true });
await esbuild.build({ entryPoints: ['src/app.js'], bundle: true, format: 'iife', outfile: dist + '/app.js', target: 'chrome102', legalComments: 'none', logLevel: 'warning' });
for (const f of fs.readdirSync('static')) fs.copyFileSync(path.join('static', f), path.join(dist, f));
for (const f of ['stockfish-19-lite-single.js', 'stockfish-19-lite-single.wasm']) fs.copyFileSync('node_modules/stockfish/bin/' + f, `${dist}/engine/${f}`);
fs.cpSync('assets/pieces', dist + '/pieces', { recursive: true }); fs.cpSync('assets/sounds', dist + '/sounds', { recursive: true }); fs.cpSync('assets/icons', dist + '/icons', { recursive: true });
for (const f of ['LICENSE', 'NOTICE', 'PRIVACY.md']) fs.copyFileSync(f, path.join(dist, f));
const cfg = fs.readFileSync('src/config.js', 'utf8');
if (cfg.includes('REPLACE-ME')) console.warn('\n⚠️  src/config.js still has the placeholder SOURCE_URL — set your real repository URL before publishing (GPLv3 requires a source link).\n');
const size = (d) => fs.readdirSync(d, { withFileTypes: true }).reduce((n, e) => n + (e.isDirectory() ? size(path.join(d, e.name)) : fs.statSync(path.join(d, e.name)).size), 0);
console.log(`built dist/ — ${(size(dist) / 1048576).toFixed(2)} MB`);
