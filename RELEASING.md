# Release checklist

## 0. Revoke the leaked credentials (do this FIRST — they were inside the old desktop .exe files)
1. **GitHub token:** github.com → Settings → Developer settings → Personal access tokens (classic / fine-grained) → find the token the old app used → **Delete**. Then open Settings → Security log and check for activity you don't recognise, and review the repos/gists the token could reach.
2. **Google Drive:** myaccount.google.com/permissions → find the app (named after your Google Cloud project) → **Remove access** (this kills the refresh token). Then Google Cloud Console → APIs & Services → Credentials → the OAuth client the old app used → **delete it, or reset its secret**. If a service-account key was ever used, delete that key too. Finally review the coach Drive folder's contents and sharing settings.
3. **ntfy:** stop using the old topic name (it was effectively public).
4. Old `.exe` copies keep working only offline after this; cloud features stop (that is intended). Move students to the extension.
5. Never commit `cloud_sync_config.json`, `_embedded_config.py` or similar. Before the first push: `git grep -nE "ghp_|github_pat_|GOCSPX|refresh_token|ntfy"` must print nothing.

## 1. Source link (GPLv3)
1. Create a public GitHub repo (e.g. `chess-homework-extension`) and push this folder (the `.gitignore` already skips `node_modules/` and `dist/`).
2. `node scripts/set-source-url.mjs https://github.com/<you>/<repo>` then `node build.mjs`.
3. Commit, push, and tag the exact release: `git tag v1.2.0 && git push --tags`. The store zip must be built from that tag.

## 2. Sounds
Follow `SOUNDS-AUDIT.md`. Remove or replace anything you cannot clear, update `NOTICE`, rebuild.

## 3. Chrome Web Store
1. Register a developer account (one-time **US$5** fee, per the Chromium blog).
2. Zip the **contents** of `dist/` (so `manifest.json` is at the zip root) and upload it.
3. Store listing: use `STORE-LISTING.md`; add 1280×800 screenshots (take them from the running extension).
4. Privacy practices tab: single purpose, permission justification for `storage`, "no data collected", no remote code, and a public URL for the privacy policy (e.g. the GitHub link to `PRIVACY.md`, or GitHub Pages). Put a real contact in `PRIVACY.md` first.
5. Submit for review; fixes are re-submitted as a new version (bump `version` in `static/manifest.json` and `src/config.js`).
