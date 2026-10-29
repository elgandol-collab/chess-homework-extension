import { createRequire } from 'node:module';
import assert from 'node:assert/strict';
import { Chess } from 'chess.js';
import { loadHomework } from '../src/model.js';
import { UciEngine } from '../src/engine.js';
import { ItemSession, newProgress } from '../src/session.js';
import { applyPuzzleResult, freshRating, parseLegacyRating } from '../src/rating.js';

const require = createRequire(import.meta.url);
import { spawn } from 'node:child_process';
const enginePath = require('stockfish').findEngine('lite-single');
const child = spawn(process.execPath, [enginePath], { stdio: ['pipe', 'pipe', 'inherit'] });
const cbs = []; let buf = '';
child.stdout.on('data', (d) => { buf += d; let i; while ((i = buf.indexOf('\n')) >= 0) { const line = buf.slice(0, i).replace(/\r$/, ''); buf = buf.slice(i + 1); cbs.forEach((cb) => cb(line)); } });
const engine = new UciEngine({ send: (l) => child.stdin.write(l + '\n'), onLine: (cb) => cbs.push(cb), terminate: () => child.kill() });

const results = []; const test = async (name, fn) => { try { await fn(); results.push([name, true]); console.log('PASS', name); } catch (e) { results.push([name, false]); console.log('FAIL', name, '\n   ', e.message); } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const mkui = () => { const log = { statuses: [], rejects: 0, tooFast: 0, saves: 0, completes: [], sounds: [] };
  return { log, render() {}, clocks() {}, sound: (k) => log.sounds.push(k), reject: () => log.rejects++, tooFast: () => log.tooFast++,
    status: (k, p) => log.statuses.push(k), save: () => log.saves++, complete: (p, o) => log.completes.push(o) }; };
const hw = (items) => loadHomework(JSON.stringify({ sequential: false, items }), 'x.json');
const waitFor = async (cond, ms = 15000) => { const t = Date.now(); while (!cond()) { if (Date.now() - t > ms) throw new Error('waitFor timeout'); await sleep(20); } };

await test('puzzle: wrong move rejected + counted, right moves accepted, opponent auto-replies, completes', async () => {
  const item = hw([{ type: 'puzzle', fen: 'start', solution: ['e2e4', 'e7e5', 'g1f3'] }]).items[0];
  const ui = mkui(); const prog = newProgress(item); const s = new ItemSession({ item, prog, engine, ui }); s.start();
  assert.equal(s.tryMove({ from: 'd2', to: 'd4' }).reason, 'wrong');
  assert.equal(prog.wrong_attempts, 1); assert.equal(prog.move_index, 0); assert.equal(s.board.fen().split(' ')[0].includes('3P4'), false);
  assert.ok(s.tryMove({ from: 'e2', to: 'e4' }).ok); assert.equal(s.tryMove({ from: 'a2', to: 'a3' }).reason, 'not_turn');
  await waitFor(() => prog.move_index === 2);
  assert.ok(s.tryMove({ from: 'g1', to: 'f3' }).ok); assert.equal(prog.completed, true); assert.equal(ui.log.completes.length, 1);
  assert.equal(prog.move_think_times.length, 2); s.destroy();
});

await test('opening as black: scripted white move auto-plays first; student must follow the line', async () => {
  const item = hw([{ type: 'opening', fen: 'start', player_color: 'black', line: ['d2d4', 'g8f6', 'c2c4'] }]).items[0];
  const ui = mkui(); const prog = newProgress(item); const s = new ItemSession({ item, prog, engine, ui }); s.start();
  await waitFor(() => prog.move_index === 1); assert.equal(s.studentTurn, true);
  assert.equal(s.tryMove({ from: 'e7', to: 'e6' }).reason, 'wrong'); assert.ok(s.tryMove({ from: 'g8', to: 'f6' }).ok);
  await waitFor(() => prog.completed); assert.equal(prog.move_index, 3); s.destroy();
});

await test('promotion: only the exact promotion piece in the solution is accepted', async () => {
  const item = hw([{ type: 'puzzle', fen: '8/P6k/8/8/8/8/6K1/8 w - - 0 1', solution: ['a7a8q'] }]).items[0];
  const ui = mkui(); const prog = newProgress(item); const s = new ItemSession({ item, prog, engine, ui }); s.start();
  assert.equal(s.isPromotion('a7', 'a8'), true);
  assert.equal(s.tryMove({ from: 'a7', to: 'a8', promotion: 'n' }).reason, 'wrong');
  assert.ok(s.tryMove({ from: 'a7', to: 'a8', promotion: 'q' }).ok); assert.ok(prog.completed); s.destroy();
});

await test('engine item vs REAL Stockfish: plays to full_moves, all plies legal, think-times/clock increments recorded', async () => {
  const item = hw([{ type: 'engine', fen: 'start', player_color: 'white', full_moves: 4, engine_skill: 0, engine_movetime_ms: 60,
    engine_min_delay_ms: 0, player_min_delay_ms: 0, student_clock_seconds: 100, engine_clock_seconds: 100, clock_increment_seconds: 5 }]).items[0];
  const ui = mkui(); const prog = newProgress(item); const s = new ItemSession({ item, prog, engine, ui }); s.start();
  let guard = 0;
  while (!prog.completed && guard++ < 40) {
    await waitFor(() => prog.completed || (s.studentTurn && !s._thinking));
    if (prog.completed) break;
    const mv = s.board.moves({ verbose: true }); const m = mv[Math.floor(Math.random() * mv.length)];
    assert.ok(s.tryMove({ from: m.from, to: m.to, promotion: m.promotion }).ok);
  }
  assert.equal(prog.completed, true); assert.equal(prog.moves_played.length, 8, 'ply count = full_moves*2');
  const replay = new Chess(); for (const u of prog.moves_played) replay.move({ from: u.slice(0, 2), to: u.slice(2, 4), promotion: u[4] });
  assert.equal(prog.move_think_times.length, 4); assert.equal(prog.student_clock, 100 + 4 * 5); assert.equal(prog.engine_clock, 100 + 4 * 5); s.destroy();
});

await test('engine opening book: engine replies exactly from the book while the student stays on it', async () => {
  const item = hw([{ type: 'engine', fen: 'start', player_color: 'white', full_moves: 2, engine_skill: 0, engine_movetime_ms: 50,
    engine_min_delay_ms: 0, player_min_delay_ms: 0, student_clock_seconds: 0, engine_clock_seconds: 0, engine_openings: [['e2e4', 'c7c5', 'g1f3', 'd7d6']] }]).items[0];
  const ui = mkui(); const prog = newProgress(item); const s = new ItemSession({ item, prog, engine, ui }); s.start();
  assert.ok(s.tryMove({ from: 'e2', to: 'e4' }).ok); await waitFor(() => prog.moves_played.length === 2);
  assert.equal(prog.moves_played[1], 'c7c5');
  assert.ok(s.tryMove({ from: 'g1', to: 'f3' }).ok); await waitFor(() => prog.completed); assert.equal(prog.moves_played[3], 'd7d6'); s.destroy();
});

await test('player_min_delay_ms: early move rejected (not counted as wrong), accepted after the delay', async () => {
  let t = 1_000_000; const env = { now: () => t, setTimeout: (f, ms) => setTimeout(f, 0), clearTimeout: clearTimeout, random: Math.random };
  const item = hw([{ type: 'engine', fen: 'start', player_color: 'white', full_moves: 5, engine_skill: 0, engine_movetime_ms: 30,
    engine_min_delay_ms: 0, player_min_delay_ms: 2000, student_clock_seconds: 0, engine_clock_seconds: 0 }]).items[0];
  const ui = mkui(); const prog = newProgress(item); const s = new ItemSession({ item, prog, engine, ui, env }); s.start();
  t += 500; assert.equal(s.tryMove({ from: 'e2', to: 'e4' }).reason, 'too_fast'); assert.equal(ui.log.tooFast, 1); assert.equal(prog.wrong_attempts, 0);
  t += 2000; assert.ok(s.tryMove({ from: 'e2', to: 'e4' }).ok); s.destroy();
});

await test('clock: student flag falls -> time_forfeit + completed; mate item objective_met=false', async () => {
  let t = 0; const env = { now: () => t, setTimeout: (f, ms) => setTimeout(f, 0), clearTimeout: clearTimeout, random: Math.random };
  const item = hw([{ type: 'mate', fen: '6k1/5ppp/8/8/8/8/5PPP/3R2K1 w - - 0 1', full_moves: 3, student_clock_seconds: 10, engine_clock_seconds: 10, player_min_delay_ms: 0 }]).items[0];
  const ui = mkui(); const prog = newProgress(item); const s = new ItemSession({ item, prog, engine, ui, env }); s.start();
  for (let i = 0; i < 60 && !prog.completed; i++) { t += 200; s.tick(); }
  assert.equal(prog.time_forfeit, true); assert.equal(prog.completed, true); assert.equal(prog.objective_met, false); assert.ok(prog.student_clock <= 0); s.destroy();
});

await test('mate item: delivering checkmate => objective_met true', async () => {
  const item = hw([{ type: 'mate', fen: '6k1/5ppp/8/8/8/8/5PPP/3R2K1 w - - 0 1', full_moves: 3, student_clock_seconds: 0, engine_clock_seconds: 0, player_min_delay_ms: 0 }]).items[0];
  const ui = mkui(); const prog = newProgress(item); const s = new ItemSession({ item, prog, engine, ui }); s.start();
  assert.ok(s.tryMove({ from: 'd1', to: 'd8' }).ok); assert.equal(prog.completed, true); assert.equal(prog.objective_met, true); s.destroy();
});

await test('resume: progress replays to the same position and continues (puzzle + engine)', async () => {
  const item = hw([{ type: 'puzzle', fen: 'start', solution: ['e2e4', 'e7e5', 'g1f3', 'b8c6'] }]).items[0];
  const prog = newProgress(item); const ui = mkui(); let s = new ItemSession({ item, prog, engine, ui }); s.start();
  s.tryMove({ from: 'e2', to: 'e4' }); await waitFor(() => prog.move_index === 2); s.destroy();
  const saved = JSON.parse(JSON.stringify(prog)); const s2 = new ItemSession({ item, prog: saved, engine, ui: mkui() }); s2.start();
  assert.equal(s2.board.fen(), new Chess('rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 2').fen());
  assert.ok(s2.tryMove({ from: 'g1', to: 'f3' }).ok); s2.destroy();
});

await test('rating: matches Python student_rating.py formula; legacy import validates', () => {
  // python: old=1200, puzzle=1200 clean -> 1216 ; miss -> 1184 ; old=1200, puzzle=1600 clean -> 1229 (computed in python below)
  let r = applyPuzzleResult(freshRating(), 1200, true); assert.deepEqual(r, { rating: 1216, solved: 1, correct: 1 });
  r = applyPuzzleResult(freshRating(), 1200, false); assert.equal(r.rating, 1184);
  assert.deepEqual(parseLegacyRating('{"rating":1350,"solved":10,"correct":7}'), { rating: 1350, solved: 10, correct: 7 });
  assert.equal(parseLegacyRating('{"rating":99999,"solved":1,"correct":1}'), null); assert.equal(parseLegacyRating('nope'), null);
});

engine.terminate();
const failed = results.filter(([, ok]) => !ok).length;
console.log(`\n${results.length - failed}/${results.length} passed`); process.exit(failed ? 1 : 0);
