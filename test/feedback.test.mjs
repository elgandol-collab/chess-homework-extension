// Unit tests for the smart feedback with a scripted fake engine (deterministic), then one run with real Stockfish.
import assert from 'node:assert/strict'; import { spawn } from 'node:child_process'; import { createRequire } from 'node:module';
import { loadHomework } from '../src/model.js'; import { ItemSession, newProgress } from '../src/session.js'; import { UciEngine } from '../src/engine.js';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms)); const R = [];
const test = async (n, f) => { try { await f(); R.push(1); console.log('PASS', n); } catch (e) { R.push(0); console.log('FAIL', n, '\n   ', e.stack.split('\n').slice(0, 3).join(' | ')); } };
const item = (o = {}) => loadHomework(JSON.stringify({ sequential: false, items: [{ type: 'engine', fen: 'start', player_color: 'white', full_moves: 3, engine_skill: 5, engine_movetime_ms: 30,
  engine_min_delay_ms: 0, player_min_delay_ms: 0, student_clock_seconds: 0, engine_clock_seconds: 0, engine_feedback_enabled: true, ...o }] }), 'x.json').items[0];
const mkui = () => { const ev = []; return { ev, render() {}, clocks() {}, sound() {}, reject() {}, tooFast() {}, status() {}, save() {}, complete() {}, feedback: (k, i) => ev.push([k, i]) }; };
// fake engine: evalFen(fen)-> scripted by call order; search -> {uci, scoreStm}
function fake({ evals, searches }) { const e = { evalCalls: [], searchCalls: 0, evalFen: async (fen) => { e.evalCalls.push(fen); const v = evals.shift(); return v; }, search: async () => searches[e.searchCalls++] }; return e; }
const play = async (s, from, to) => { assert.ok(s.tryMove({ from, to }).ok); await sleep(80); };

await test('white mistake: drop >= 150cp -> warn (and counted, worst ply recorded)', async () => {
  const it = item(); const prog = newProgress(it); const ui = mkui();
  // before=+30 (white POV), engine search after e4 returns score from BLACK stm POV = +200 (black better) -> white POV -200 => drop 230
  const eng = fake({ evals: [30], searches: [{ uci: 'e7e5', scoreStm: 200 }, { uci: 'b8c6', scoreStm: 0 }, { uci: 'a7a6', scoreStm: 0 }] });
  const s = new ItemSession({ item: it, prog, engine: eng, ui }); s.start(); await sleep(50);
  await play(s, 'e2', 'e4'); await sleep(100);
  assert.deepEqual(ui.ev.map((e) => e[0]), ['warn']); assert.equal(prog.mistake_count, 1); assert.equal(prog.worst_mistake_drop_cp, 230); assert.equal(prog.worst_mistake_ply, 0); s.destroy();
});
await test('black student: POV sign handled (white-POV evals negated)', async () => {
  const it = item({ player_color: 'black', fen: 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1' }); const prog = newProgress(it); const ui = mkui();
  // before (white POV) = +40 -> black POV -40. After black's move, white to move: engine stm=white score +300 => white POV +300 -> black POV -300 => drop 260 (warn)
  const eng = fake({ evals: [40], searches: [{ uci: 'g1f3', scoreStm: 300 }, { uci: 'b1c3', scoreStm: 0 }, { uci: 'd2d4', scoreStm: 0 }] });
  const s = new ItemSession({ item: it, prog, engine: eng, ui }); s.start(); await sleep(50);
  await play(s, 'a7', 'a6'); await sleep(100); assert.deepEqual(ui.ev.map((e) => e[0]), ['warn']); assert.equal(prog.worst_mistake_drop_cp, 260); s.destroy();
});
await test('strong move: gain >= 150cp -> praise (not warn)', async () => {
  const it = item(); const prog = newProgress(it); const ui = mkui();
  const eng = fake({ evals: [-100], searches: [{ uci: 'e7e5', scoreStm: -120 }, { uci: 'b8c6', scoreStm: 0 }, { uci: 'a7a6', scoreStm: 0 }] }); // after: black stm -120 => white +120 ; gain = 120-(-100)=220
  const s = new ItemSession({ item: it, prog, engine: eng, ui }); s.start(); await sleep(50); await play(s, 'e2', 'e4'); await sleep(100);
  assert.deepEqual(ui.ev.map((e) => e[0]), ['praise']); assert.equal(prog.good_move_count, 1); assert.equal(prog.best_good_move_gain_cp, 220); s.destroy();
});
await test('small change (<150cp both ways) -> no feedback; thresholds from the item are honoured', async () => {
  const it = item({ engine_feedback_threshold_cp: 60 }); const prog = newProgress(it); const ui = mkui();
  const eng = fake({ evals: [0], searches: [{ uci: 'e7e5', scoreStm: 80 }, { uci: 'b8c6', scoreStm: 0 }, { uci: 'a7a6', scoreStm: 0 }] }); // drop 80 >= 60 => warn
  const s = new ItemSession({ item: it, prog, engine: eng, ui }); s.start(); await sleep(50); await play(s, 'e2', 'e4'); await sleep(100); assert.equal(ui.ev.length, 1);
  const it2 = item(); const p2 = newProgress(it2); const ui2 = mkui(); const e2 = fake({ evals: [0], searches: [{ uci: 'e7e5', scoreStm: 80 }, { uci: 'b8c6', scoreStm: 0 }, { uci: 'a7a6', scoreStm: 0 }] });
  const s2 = new ItemSession({ item: it2, prog: p2, engine: e2, ui: ui2 }); s2.start(); await sleep(50); await play(s2, 'e2', 'e4'); await sleep(100); assert.equal(ui2.ev.length, 0); s.destroy(); s2.destroy();
});
await test('feedback disabled -> engine never asked to evaluate', async () => {
  const it = item({ engine_feedback_enabled: false }); const prog = newProgress(it); const ui = mkui(); const eng = fake({ evals: [], searches: [{ uci: 'e7e5', scoreStm: 0 }, { uci: 'b8c6', scoreStm: 0 }, { uci: 'a7a6', scoreStm: 0 }] });
  const s = new ItemSession({ item: it, prog, engine: eng, ui }); s.start(); await sleep(50); await play(s, 'e2', 'e4'); await sleep(100); assert.equal(eng.evalCalls.length, 0); assert.equal(ui.ev.length, 0); s.destroy();
});
await test("'before' eval arriving AFTER the student's move still completes the comparison", async () => {
  const it = item(); const prog = newProgress(it); const ui = mkui(); const rels = [];
  const eng = { evalFen: () => new Promise((r) => { rels.push(r); }), search: async () => ({ uci: 'e7e5', scoreStm: 500 }) };
  const s = new ItemSession({ item: it, prog, engine: eng, ui }); s.start(); await sleep(30); await play(s, 'e2', 'e4'); await sleep(100); assert.equal(ui.ev.length, 0);
  rels.forEach((r) => r(20)); await sleep(50); assert.deepEqual(ui.ev.map((e) => e[0]), ['warn']); s.destroy();
});
await test('book move reply: after-eval requested separately', async () => {
  const it = item({ engine_openings: [['e2e4', 'e7e5']] }); const prog = newProgress(it); const ui = mkui();
  const eng = fake({ evals: [0, -400], searches: [{ uci: 'x', scoreStm: 0 }, { uci: 'b8c6', scoreStm: 0 }] });
  const s = new ItemSession({ item: it, prog, engine: eng, ui }); s.start(); await sleep(50); await play(s, 'e2', 'e4'); await sleep(150);
  assert.equal(prog.moves_played[1], 'e7e5'); assert.equal(eng.evalCalls.length, 3, 'before#1, after(book), before#2 for the next turn'); assert.deepEqual(ui.ev.map((e) => e[0]), ['warn'], 'white POV -400 after e4 = bad for white'); s.destroy();
});
// ---- REAL Stockfish: a real blunder (queen takes a protected pawn) must be flagged; a quiet developing move must not
const require = createRequire(import.meta.url); const child = spawn(process.execPath, [require('stockfish').findEngine('lite-single')], { stdio: ['pipe', 'pipe', 'inherit'] });
const cbs = []; let buf = ''; child.stdout.on('data', (d) => { buf += d; let i; while ((i = buf.indexOf('\n')) >= 0) { const l = buf.slice(0, i).replace(/\r$/, ''); buf = buf.slice(i + 1); cbs.forEach((cb) => cb(l)); } });
const real = new UciEngine({ send: (l) => child.stdin.write(l + '\n'), onLine: (cb) => cbs.push(cb), terminate: () => child.kill() });
const FEN = 'r1bqkbnr/pppp1ppp/2n5/4p2Q/4P3/8/PPPP1PPP/RNB1KBNR w KQkq - 2 3';
for (const [name, from, to, expect] of [['REAL Stockfish: Qxe5?? (hangs the queen) -> warn', 'h5', 'e5', 'warn'], ['REAL Stockfish: Nf3 (quiet, good) -> no warn', 'g1', 'f3', null]]) {
  await test(name, async () => {
    const it = item({ fen: FEN, engine_skill: 10, engine_movetime_ms: 150 }); const prog = newProgress(it); const ui = mkui();
    const s = new ItemSession({ item: it, prog, engine: real, ui }); s.start(); await sleep(1100); // 'before' eval (800ms)
    assert.ok(s.tryMove({ from, to }).ok); await sleep(1500);
    const kinds = ui.ev.map((e) => e[0]); if (expect) assert.ok(kinds.includes(expect), 'events: ' + JSON.stringify(ui.ev)); else assert.ok(!kinds.includes('warn'), 'events: ' + JSON.stringify(ui.ev));
    if (expect) console.log('    drop:', prog.worst_mistake_drop_cp, 'cp'); s.destroy();
  });
}
real.terminate(); console.log(`\n${R.filter(Boolean).length}/${R.length} passed`); process.exit(R.includes(0) ? 1 : 0);
