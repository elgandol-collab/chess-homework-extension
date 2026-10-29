// app.js — UI for the Chess Homework Trainer extension page (layout mirrors the desktop app: board | clocks | side panel).
import { loadHomework, HomeworkFileError } from './model.js';
import { ItemSession, newProgress } from './session.js';
import { UciEngine, workerTransport } from './engine.js';
import { BoardView } from './board.js';
import { SoundBoard } from './sound.js';
import { applyPuzzleResult, freshRating, parseLegacyRating } from './rating.js';
import { buildZip } from './report.js';
import * as store from './storage.js';
import { t, setLang, getLang } from './i18n.js';
import { SOURCE_URL, STOCKFISH_URL, STOCKFISHJS_URL, VERSION } from './config.js';

const isChrome = typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.getURL;
const url = (p) => (isChrome ? chrome.runtime.getURL(p) : p);
const S = { hw: null, id: null, filename: '', raw: '', progress: {}, rating: freshRating(), session: null, current: -1, engine: null, engineFailed: false,
  board: null, lastRender: null, flip: false, saveTimer: null, bannerTimer: null, saved: [] };
const sb = new SoundBoard(url);
const ICON = { puzzle: '🧩', opening: '📖', engine: '🤖', mate: '🎯' };
const $ = (id) => document.getElementById(id);

// ---------- helpers (never innerHTML: homework files are untrusted input) ----------
function h(tag, attrs = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === false || v == null) continue;
    if (k === 'class') el.className = v; else if (k.startsWith('on')) el.addEventListener(k.slice(2), v); else el.setAttribute(k, v === true ? '' : v);
  }
  for (const k of kids.flat()) if (k != null && k !== false) el.append(k.nodeType ? k : document.createTextNode(String(k)));
  return el;
}
let toastTimer = null;
function toast(msg, kind = 'info') { const el = $('toast'); el.textContent = msg; el.className = 'show ' + kind; clearTimeout(toastTimer); toastTimer = setTimeout(() => { el.className = ''; }, 5000); }
const fmtClock = (s) => { s = Math.max(0, Math.ceil(s)); return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`; };
function applyDir() { const rtl = getLang() === 'ar'; document.documentElement.lang = getLang(); document.documentElement.dir = 'ltr'; document.documentElement.style.setProperty('--txtdir', rtl ? 'rtl' : 'ltr'); document.title = `${t('brand')} — Chess Homework`; }

// ---------- persistence ----------
async function loadIndex() { return (await store.get('hw:index', [])).filter((e) => e && e.id); }
function scheduleSave() { clearTimeout(S.saveTimer); S.saveTimer = setTimeout(saveNow, 150); }
async function saveNow() {
  if (!S.hw) return;
  await store.set('hw:' + S.id, { raw: S.raw, filename: S.filename, progress: S.progress, updated: Date.now() });
  const idx = (await loadIndex()).filter((e) => e.id !== S.id);
  idx.unshift({ id: S.id, title: S.hw.title, student: S.hw.student, total: S.hw.items.length, done: S.hw.items.filter((i) => S.progress[i.id]?.completed).length, updated: Date.now() });
  await store.set('hw:index', idx.slice(0, 50)); S.saved = idx;
}

// ---------- engine (lazy; Stockfish WASM in a worker) ----------
function getEngine() {
  if (S.engine || S.engineFailed) return S.engine;
  try { S.engine = new UciEngine(workerTransport(url('engine/stockfish-19-lite-single.js'))); S.engine.ready.catch(() => { S.engineFailed = true; toast(t('err.engine'), 'bad'); }); }
  catch { S.engineFailed = true; toast(t('err.engine'), 'bad'); }
  return S.engine;
}

// ---------- shell ----------
function buildShell() {
  applyDir();
  const fileInput = h('input', { type: 'file', accept: '.pgn,.json,.chesshw.json', class: 'hidden', id: 'fileinput', onchange: (e) => { const f = e.target.files[0]; e.target.value = ''; if (f) openFile(f); } });
  const toolbar = h('header', { class: 'toolbar' },
    h('button', { class: 'tbtn', id: 'b-open', onclick: () => fileInput.click() }, t('tb.open')),
    h('button', { class: 'tbtn', id: 'b-export', onclick: exportResult, disabled: !S.hw }, t('tb.export')),
    h('button', { class: 'tbtn', id: 'b-wa', onclick: sendWhatsApp, disabled: !S.hw }, t('tb.whatsapp')),
    h('div', { class: 'grow' }), h('div', { class: 'brand' }, t('brand')), h('div', { class: 'grow' }),
    h('button', { class: 'tbtn', id: 'b-flip', onclick: () => { S.flip = !S.flip; applyOrientation(); } }, t('tb.flip')),
    h('button', { class: 'tbtn', id: 'b-sound', title: t('tb.sound'), onclick: toggleMute }, sb.muted ? '🔇' : '🔊'),
    h('button', { class: 'tbtn', id: 'b-lang', onclick: () => { setLang(getLang() === 'ar' ? 'en' : 'ar'); store.set('lang', getLang()); rebuild(); } }, '🌐 ' + t('tb.lang')), fileInput);
  const panel = (id, icon, cap) => h('div', { class: 'cpanel off', id }, h('div', { class: 'ico' }, icon), h('div', { class: 'val', id: id + '-v' }, '--:--'), h('div', { class: 'sub', id: id + '-s' }), h('div', { class: 'cap' }, cap));
  const rack = h('section', { class: 'rack' }, panel('p-engine', '🤖', t('clk.engine')),
    h('div', { class: 'mid' },
      h('div', { class: 'badge slow off', id: 'b-slow' }, h('div', { class: 'bv', id: 'b-slow-v' }, '--:--'), h('div', { class: 'bt' }, t('clk.slow'))),
      h('div', { class: 'badge left off', id: 'b-left' }, h('div', { class: 'bv', id: 'b-left-v' }, '--'), h('div', { class: 'bt' }, t('clk.left')))),
    panel('p-you', '🧑', t('clk.you')));
  const side = h('aside', { class: 'side txt' },
    h('div', { class: 'hwtitle', id: 'hw-title' }), h('div', { class: 'ratingrow', id: 'rating-row' }),
    h('div', { class: 'box listbox', id: 'list' }), h('div', { class: 'box banner', id: 'banner' }), h('div', { class: 'statusline', id: 'status' }),
    h('button', { class: 'sbtn', id: 'b-reset', onclick: resetItem, disabled: true }, t('btn.reset')),
    h('button', { class: 'linkbtn', onclick: showAbout }, t('btn.about')));
  const main = h('main', { class: 'main' }, h('section', { class: 'boardwrap' }, h('div', { id: 'board' }), h('div', { id: 'fbanner', class: 'txt' })), rack, side);
  $('app').replaceChildren(h('div', { class: 'app' }, toolbar, main));
  S.board = new BoardView($('board'), { pieceBase: url('pieces/'), onMove: onBoardMove });
  S.board.setState(S.lastRender || { fen: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1', lastMove: null, inCheck: false, turn: 'w' });
  document.body.dataset.drop = t('drop.hint');
  renderSide(); applyOrientation(); updateRack();
}
function rebuild() { buildShell(); if (S.session) { const it = S.session.item; setBanner(it.instructions || '', ''); } }

function applyOrientation() {
  const it = S.hw && S.hw.items[S.current]; const base = it ? it.player_color : 'white';
  const o = (base === 'black') !== S.flip ? 'black' : 'white'; S.board?.setOrientation(o);
}
function toggleMute() { sb.muted = !sb.muted; store.set('muted', sb.muted); const b = $('b-sound'); if (b) b.textContent = sb.muted ? '🔇' : '🔊'; }

// ---------- side panel ----------
const accessible = (i) => !S.hw.sequential || S.hw.items.slice(0, i).every((it) => S.progress[it.id]?.completed);
function setBanner(text, kind = '', autoClearMs = 0) {
  const el = $('banner'); if (!el) return; el.textContent = text; el.className = 'box banner txt ' + kind; clearTimeout(S.bannerTimer);
  if (autoClearMs) S.bannerTimer = setTimeout(() => setBanner(S.session?.item.instructions || '', ''), autoClearMs);
}
let hintTimer = null;
/** Floating banner over the board (the desktop app's "hint banner"). */
function showHint(text, ms = 2200) { const el = $('fbanner'); if (!el) return; el.textContent = text; el.className = 'txt show'; clearTimeout(hintTimer); hintTimer = setTimeout(() => { el.className = 'txt'; }, ms); }
const rnd = (n) => 1 + Math.floor(Math.random() * n);
function mistakeSummary(p) {
  if (p.mistake_count === 0 && p.good_move_count === 0) return t('fb.sum.clean');
  if (p.mistake_count === 0) return t('fb.sum.clean_good', { good_count: p.good_move_count });
  if (p.good_move_count === 0) return p.worst_mistake_ply != null ? t('fb.sum.mistakes', { count: p.mistake_count, ply: p.worst_mistake_ply + 1 }) : t('fb.sum.no_ply', { count: p.mistake_count });
  return t('fb.sum.both', { count: p.mistake_count, good_count: p.good_move_count });
}
function setStatus(text) { const el = $('status'); if (el) el.textContent = text; }
function renderSide() {
  const hw = S.hw;
  $('hw-title').textContent = hw ? hw.title : t('hw.none');
  const done = hw ? hw.items.filter((i) => S.progress[i.id]?.completed).length : 0;
  $('rating-row').replaceChildren('🏆 ', String(S.rating.rating), hw ? h('span', { class: 'sub' }, ' · ' + [hw.student && t('hw.student', { s: hw.student }), t('hw.progress', { done, total: hw.items.length })].filter(Boolean).join(' · ')) : '');
  $('rating-row').title = t('rating.tip', S.rating);
  const list = $('list');
  if (!hw) {
    const ratingInput = h('input', { type: 'file', accept: '.json', class: 'hidden', onchange: async (e) => { const f = e.target.files[0]; e.target.value = ''; if (!f) return; const r = parseLegacyRating(await f.text());
      if (!r) return toast(t('toast.rating_bad'), 'bad'); S.rating = r; await store.set('rating', r); toast(t('toast.rating_imported', r), 'good'); renderSide(); } });
    list.replaceChildren(h('div', { class: 'sub', style: 'margin:2px 4px 8px' }, t('hw.saved')),
      S.saved.length ? h('ul', { class: 'saved' }, S.saved.map((e) => h('li', {}, h('div', { class: 'grow', style: 'min-width:0' }, h('b', { class: 'clip', style: 'display:block' }, e.title || '—'),
        h('div', { class: 'sub' }, [e.student, t('hw.progress', { done: e.done, total: e.total })].filter(Boolean).join(' · '))),
        h('button', { class: 'mini pri', onclick: () => openSaved(e.id) }, t('btn.resume')),
        h('button', { class: 'mini', onclick: async () => { await store.remove('hw:' + e.id); S.saved = S.saved.filter((x) => x.id !== e.id); await store.set('hw:index', S.saved); renderSide(); } }, t('btn.delete')))))
        : h('div', { class: 'sub', style: 'margin:4px' }, t('hw.saved_none')),
      h('button', { class: 'mini', style: 'margin:10px 4px 0', onclick: () => ratingInput.click() }, t('btn.import_rating')), ratingInput);
    setBanner('🔒 ' + (getLang() === 'ar' ? 'كل شيء بيتخزن على جهازك فقط. مفيش حسابات ولا إرسال تلقائي.' : 'Everything stays on your device. No accounts, no automatic uploads.'), '');
    setStatus(t('status.idle')); $('b-reset').disabled = true; return;
  }
  list.replaceChildren(h('ul', { class: 'items' }, hw.items.map((it, i) => {
    const p = S.progress[it.id]; const ok = accessible(i);
    const mark = p.completed ? (it.type === 'mate' && p.objective_met === false ? '❌' : '✅') : ok ? ICON[it.type] : '🔒';
    return h('li', { class: ['item', i === S.current && 'active', p.completed && 'done', !ok && 'locked'].filter(Boolean).join(' '), onclick: () => (ok ? selectItem(i) : (toast(t('status.locked')), setStatus(t('status.locked')))) },
      h('span', { class: 'mk' }, mark), h('div', { class: 'grow txt' }, h('b', {}, `${i + 1}. ` + (getLang() === 'ar' ? ({ puzzle: 'لغز', opening: 'افتتاحية', engine: 'لعب ضد المحرك', mate: 'كش ملك' })[it.type] : ({ puzzle: 'Puzzle', opening: 'Opening', engine: 'Vs engine', mate: 'Checkmate' })[it.type])),
        h('div', { class: 'sub clip' }, it.instructions || '')));
  })));
  $('b-reset').disabled = S.current < 0; $('b-export').disabled = false; $('b-wa').disabled = false;
}

// ---------- clocks rack ----------
function setPanel(id, state, val, sub) { const p = $(id); if (!p) return; p.className = 'cpanel ' + state; $(id + '-v').textContent = val; $(id + '-s').textContent = sub || ''; }
function updateRack() {
  const s = S.session; const it = s?.item; const p = it && S.progress[it.id];
  const timedE = it && it.engine_clock_seconds > 0, timedY = it && it.student_clock_seconds > 0; const free = s?.isFree;
  const youTurn = s && !p.completed && s.studentTurn;
  setPanel('p-engine', free && timedE ? (!youTurn && !p.completed ? 'active' : 'idle') : 'off', free && timedE ? fmtClock(p.engine_clock) : '--:--', s && s.engineWaitMs() != null ? (s.engineWaitMs() / 1000).toFixed(1) + 's' : '');
  setPanel('p-you', free && timedY ? (youTurn ? 'active' : 'idle') : 'off', free && timedY ? fmtClock(p.student_clock) : '--:--', '');
  const rem = s ? s.slowdownRemainingMs() : null; const slow = $('b-slow'); if (slow) {
    slow.className = 'badge slow ' + (rem == null ? 'off' : rem <= 0 ? 'idle' : 'active'); $('b-slow-v').textContent = rem == null ? '--:--' : (rem / 1000).toFixed(1) + 's'; }
  const left = s ? s.movesLeft() : null; const lb = $('b-left'); if (lb) { lb.className = 'badge left ' + (left == null ? 'off' : 'active'); $('b-left-v').textContent = left == null ? '--' : String(left); }
  if (s && free && !p.completed && youTurn && !s._thinking) setStatus(t('status.play_remaining', { remaining: s.remaining }));
}

// ---------- homework loading ----------
async function openFile(file) {
  if (file.size > 5 * 1024 * 1024) return toast(t('err.file', { msg: '> 5MB' }), 'bad');
  await openText(await file.text(), file.name);
}
async function openText(raw, filename) {
  let hw;
  try { hw = loadHomework(raw, filename); } catch (e) { return toast(t('err.file', { msg: e instanceof HomeworkFileError ? e.message : String(e.message || e) }), 'bad'); }
  const id = store.hashText(raw); const saved = await store.get('hw:' + id);
  startHomework(hw, id, raw, filename, saved?.progress || {});
}
async function openSaved(id) {
  const saved = await store.get('hw:' + id); if (!saved) return;
  try { startHomework(loadHomework(saved.raw, saved.filename), id, saved.raw, saved.filename, saved.progress || {}); } catch (e) { toast(t('err.file', { msg: e.message }), 'bad'); }
}
function startHomework(hw, id, raw, filename, progress) {
  if (S.session?.inProgress && !confirm(t('leave.warn'))) { sb.play(S.hw?.sounds?.close_warning_sound_file); return; }
  endSession(); S.hw = hw; S.id = id; S.raw = raw; S.filename = filename; S.flip = false; S.current = -1;
  S.progress = {}; hw.items.forEach((it) => { S.progress[it.id] = { ...newProgress(it), ...(progress[it.id] || {}) }; });
  sb.preload(hw.sounds, hw.items); scheduleSave(); buildShell();
  const next = hw.items.findIndex((it, i) => !S.progress[it.id].completed && accessible(i)); selectItem(next >= 0 ? next : 0);
}

// ---------- item sessions ----------
function endSession() { if (S.session) { S.session.destroy(); S.session = null; } }
function selectItem(i) {
  const item = S.hw.items[i]; if (!item) return; endSession(); S.current = i; S.flip = false;
  const prog = S.progress[item.id]; const free = item.type === 'engine' || item.type === 'mate';
  const engine = free ? getEngine() : null;
  S.session = new ItemSession({ item, prog, engine: engine || { bestMove: () => Promise.reject(new Error('no engine')) }, ui: sessionUi(item) });
  applyOrientation(); S.board.setInteractive(prog.completed ? null : item.player_color === 'white' ? 'w' : 'b');
  setBanner(item.instructions || '', ''); setStatus(''); renderSide(); S.session.start(); updateRack();
}
function sessionUi(item) {
  return {
    render: (st) => { S.lastRender = st; S.board?.setState(st); updateRack(); },
    sound: (k) => sb.move(k), reject: (f, to) => S.board?.flashReject(f, to),
    tooFast: (ms, nag) => { sb.rush(S.hw.sounds); showHint(nag <= 3 ? t('banner.rush', { seconds: (ms / 1000).toFixed(1) }) : t('banner.rush_soft'), 3500); },
    wrong: (type) => {
      if (type === 'puzzle') { showHint(t('banner.focus')); sb.play(S.hw.sounds.puzzle_focus_sound_file); }
      else if (type === 'opening') { showHint(t('banner.opening_wrong')); sb.play(S.hw.sounds.opening_wrong_sound_file); }
    },
    feedback: (kind) => { if (kind === 'warn') { showHint(t('fb.warn.' + rnd(9))); sb.pool('warn', S.hw.sounds); } else { showHint(t('fb.good.' + rnd(9))); sb.pool('good', S.hw.sounds); } },
    voiceNote: (it, idx) => sb.play(it.move_voice_notes?.[idx]),
    status: (key, params) => {
      if (key === 'time_forfeit') return setStatus(t('status.forfeit', { who: t(params.who === 'student' ? 'who.you' : 'who.engine') }));
      const map = { wrong_move: 'status.wrong', correct: 'status.correct', engine_thinking: 'status.engine_thinking', already_done: 'status.already_done' };
      if (map[key]) setStatus(t(map[key]));
    },
    clocks: updateRack, save: scheduleSave,
    complete: (prog, { forfeit }) => onItemComplete(item, prog, forfeit),
  };
}
async function onItemComplete(item, prog, forfeit) {
  S.board?.setInteractive(null);
  if ((item.type === 'engine' || item.type === 'mate') && item.engine_feedback_enabled) setTimeout(() => showHint(mistakeSummary(prog), 4500), 300);
  if (item.type === 'puzzle' && !prog.rating_applied && !forfeit) {
    const old = S.rating.rating; S.rating = applyPuzzleResult(S.rating, item.puzzle_rating, prog.wrong_attempts === 0); prog.rating_applied = true;
    await store.set('rating', S.rating); toast(t('toast.rating_up', { old, new: S.rating.rating }), S.rating.rating >= old ? 'good' : 'warn');
  }
  const allDone = S.hw.items.every((it) => S.progress[it.id].completed);
  if (!forfeit) { setStatus(item.type === 'mate' ? t(prog.objective_met ? 'status.mate_ok' : 'status.mate_fail') : t('status.item_done')); setBanner(t('status.already_done'), 'good'); }
  if (allDone) setStatus(t('status.all_done'));
  scheduleSave(); renderSide(); updateRack();
  if (!allDone) setTimeout(() => { if (S.session && S.hw.items[S.current] === item) { const n = S.hw.items.findIndex((it, i) => !S.progress[it.id].completed && accessible(i)); if (n >= 0) selectItem(n); } }, 1800);
}
function resetItem() {
  const it = S.hw?.items[S.current]; if (!it || !confirm(t('confirm.reset'))) return;
  S.progress[it.id] = { ...newProgress(it), rating_applied: S.progress[it.id].rating_applied }; scheduleSave(); selectItem(S.current);
}
async function onBoardMove(from, to) {
  const s = S.session; if (!s) return; let promotion;
  if (s.isPromotion(from, to)) { promotion = await pickPromotion(s.item.player_color === 'white' ? 'w' : 'b'); if (!promotion) return; }
  s.tryMove({ from, to, promotion });
}
function pickPromotion(color) {
  return new Promise((resolve) => {
    const close = (v) => { ov.remove(); resolve(v); };
    const ov = h('div', { class: 'overlay', onclick: (e) => e.target === ov && close(null) }, h('div', { class: 'modal' }, h('b', {}, t('promo.title')),
      h('div', { class: 'promo' }, ['Q', 'R', 'B', 'N'].map((p) => h('button', { class: 'btn', onclick: () => close(p.toLowerCase()) }, h('img', { src: url(`pieces/${color}${p}.png`), alt: p }))))));
    document.body.append(ov);
  });
}

// ---------- export / WhatsApp / about ----------
function download(name, bytes) {
  const a = h('a', { href: URL.createObjectURL(new Blob([bytes], { type: 'application/zip' })), download: name }); document.body.append(a); a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 2000);
}
function exportResult() { if (!S.hw) return; const { name, bytes } = buildZip(S.hw, S.progress, S.rating); download(name, bytes); sb.play(S.hw.sounds.publish_sound_file); toast(t('toast.exported'), 'good'); }
function sendWhatsApp() {
  if (!S.hw) return; const { name, bytes } = buildZip(S.hw, S.progress, S.rating); download(name, bytes); sb.play(S.hw.sounds.publish_sound_file);
  if (!S.hw.coach_whatsapp) return toast(t('toast.no_wa'), 'warn');
  // wa.me can only open a chat; it cannot attach files, so the chat opens EMPTY and the student attaches the saved file.
  window.open(`https://wa.me/${S.hw.coach_whatsapp}`, '_blank', 'noopener'); toast(t('toast.wa_hint'), 'good');
}
function showAbout() {
  const link = (href) => h('a', { href, target: '_blank', rel: 'noopener noreferrer' }, href);
  const ov = h('div', { class: 'overlay', onclick: (e) => e.target === ov && ov.remove() }, h('div', { class: 'modal txt' }, h('b', {}, `${t('about.title')} — v${VERSION}`), h('div', {}, t('about.body')), h('div', {}, t('about.gpl')), link(SOURCE_URL),
    h('div', {}, 'Stockfish: ', link(STOCKFISH_URL)), h('div', {}, 'Stockfish.js: ', link(STOCKFISHJS_URL)), h('div', { class: 'sub' }, t('about.third')), h('button', { class: 'mini pri', onclick: () => ov.remove() }, 'OK')));
  document.body.append(ov);
}

// ---------- boot ----------
let dragDepth = 0;
document.addEventListener('dragenter', (e) => { e.preventDefault(); dragDepth++; document.body.classList.add('dragging'); });
document.addEventListener('dragleave', () => { if (--dragDepth <= 0) { dragDepth = 0; document.body.classList.remove('dragging'); } });
document.addEventListener('dragover', (e) => e.preventDefault());
document.addEventListener('drop', (e) => { e.preventDefault(); dragDepth = 0; document.body.classList.remove('dragging'); const f = e.dataTransfer?.files?.[0]; if (f) openFile(f); });
window.addEventListener('beforeunload', (e) => { if (S.session?.inProgress) { sb.play(S.hw?.sounds?.close_warning_sound_file); e.preventDefault(); e.returnValue = t('leave.warn'); } });
setInterval(() => { if (S.session) { S.session.tick(); updateRack(); } }, 100);
(async function boot() {
  setLang(await store.get('lang', 'en')); sb.muted = await store.get('muted', false); S.rating = await store.get('rating', freshRating()); S.saved = await loadIndex();
  buildShell();
})();
