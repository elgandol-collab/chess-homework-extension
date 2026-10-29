// Usage: node scripts/set-source-url.mjs https://github.com/<you>/<repo>
// Writes your real repository URL into src/config.js (GPLv3 requires the extension to link to its source).
import fs from 'node:fs';
const url = process.argv[2];
if (!/^https:\/\/github\.com\/[\w.-]+\/[\w.-]+\/?$/.test(url || '')) { console.error('Give a GitHub repo URL, e.g. https://github.com/yourname/chess-homework-extension'); process.exit(1); }
const p = new URL('../src/config.js', import.meta.url); const s = fs.readFileSync(p, 'utf8');
fs.writeFileSync(p, s.replace(/export const SOURCE_URL = '[^']*';/, `export const SOURCE_URL = '${url.replace(/\/$/, '')}';`));
console.log('SOURCE_URL set. Now run: node build.mjs');
