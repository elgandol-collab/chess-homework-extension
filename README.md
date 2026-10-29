# Chess Homework Trainer (Chrome extension)

Student-side trainer for chess homework files from a coach. Open a `.pgn` or `.chesshw.json` homework file and solve **puzzles, opening drills, checkmate drills, and games against Stockfish** — entirely in the browser, offline, with all data kept on the student's device.

- Manifest V3, no host permissions, only `storage`.
- Engine: Stockfish 19 (lite, single-threaded WebAssembly) via [stockfish.js](https://github.com/nmrugg/stockfish.js), running in a Web Worker.
- Results are exported as a `.zip` (PGN + report + JSON) that the student sends to the coach (file or WhatsApp). No accounts, no servers.
- License: **GNU GPL v3 or later** (see `LICENSE`, `NOTICE`). Privacy: see `PRIVACY.md`.

## Build & try
```bash
npm install
node build.mjs          # outputs dist/
```
Chrome → `chrome://extensions` → Developer mode → **Load unpacked** → select `dist/` (the folder that contains `manifest.json`).

## Test
```bash
node test/session.test.mjs     # exercise logic vs real Stockfish
node test/feedback.test.mjs    # smart feedback ("you had a better move" / "strong move")
cd test && pip install chess && python3 dump.py && node diff.mjs   # file parser vs the original Python app
```
Browser UI test: `test/browser/ui3.test.mjs` (needs `@sparticuz/chromium` and `puppeteer-core`).

## Before publishing
See `RELEASING.md`, `SOUNDS-AUDIT.md`, `STORE-LISTING.md`.

---

## بالعربي
إضافة كروم لنسخة الطالب من برنامج واجبات الشطرنج: تفتح ملف الواجب من المدرب (`.pgn` أو `.chesshw.json`) وتحل الألغاز والافتتاحيات وتلعب ضد Stockfish جوه المتصفح. التقدم بيتخزن على جهاز الطالب فقط، والنتيجة بتتصدّر كملف zip يبعته للمدرب. الترخيص GPLv3.
