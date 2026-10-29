// session.js — logic for ONE homework item (puzzle / opening / engine / mate), UI-independent.
import { Chess } from 'chess.js';
import { uciToMove, moveToUci, engineDelayForPly, engineSkillForPly } from './model.js';

export const OPPONENT_REPLY_DELAY_MS = 500;
// Smart feedback — same constants as the desktop app (app.py).
export const FEEDBACK_BEFORE_MS = 800, FEEDBACK_AFTER_MS = 400, FEEDBACK_THRESHOLD_CP = 150, GOOD_MOVE_THRESHOLD_CP = 150;
export const newProgress = (item) => ({
  completed: false, move_index: 0, moves_played: [], move_think_times: [], wrong_attempts: 0,
  rating_applied: false, time_forfeit: false, objective_met: null,
  mistake_count: 0, worst_mistake_drop_cp: 0, worst_mistake_ply: null, good_move_count: 0, best_good_move_gain_cp: 0, best_good_move_ply: null,
  student_clock: item.student_clock_seconds || 0, engine_clock: item.engine_clock_seconds || 0,
});

const realEnv = { now: () => Date.now(), setTimeout: (f, ms) => setTimeout(f, ms), clearTimeout: (h) => clearTimeout(h), random: Math.random };

export class ItemSession {
  /** ui: {render(state), sound(kind), reject(from,to), tooFast(ms), status(key,params), clocks(), save(), complete(prog)} */
  constructor({ item, prog, engine, ui, env = realEnv }) {
    this.item = item; this.prog = prog; this.engine = engine; this.ui = ui; this.env = env;
    this.board = new Chess(item.fen);
    this.token = 0; this.destroyed = false; this.timers = new Set();
    this.turnStart = env.now(); this.lastTick = env.now(); this.lastMove = null;
    this.isFree = item.type === 'engine' || item.type === 'mate';
    this.studentChar = item.player_color === 'white' ? 'w' : 'b';
    this.nagCount = 0; this.engineWaitEnd = 0;
    this.feedbackOn = this.isFree && !!item.engine_feedback_enabled && typeof engine?.evalFen === 'function';
    this.beforeCp = null; this.pending = null; this.evalGen = 0;
  }

  start() {
    const list = this.isFree ? this.prog.moves_played : this.item.moves.slice(0, this.prog.move_index);
    for (const uci of list) { const m = uciToMove(this.board, uci); if (!m) break; this.board.move(m); this.lastMove = m; }
    this.lastTick = this.env.now();
    this._render();
    if (this.prog.completed) { this.ui.status('already_done'); return; }
    this._next();
  }
  destroy() { this.destroyed = true; this.token++; this.evalGen++; this.timers.forEach((h) => this.env.clearTimeout(h)); this.timers.clear(); }
  get studentTurn() { return this.board.turn() === this.studentChar; }
  get plyCount() { return this.isFree ? this.prog.moves_played.length : this.prog.move_index; }
  /** Moves still needed (for the "remaining" badge). */
  get remaining() {
    return this.isFree ? Math.max(0, this.item.full_moves * 2 - this.prog.moves_played.length)
      : Math.max(0, this.item.moves.length - this.prog.move_index);
  }
  isPromotion(from, to) { return this.board.moves({ verbose: true }).some((m) => m.from === from && m.to === to && m.promotion); }
  /** True while the student has an unfinished exercise with progress worth protecting. */
  get inProgress() { return !this.prog.completed && (this.isFree || this.prog.move_index > 0); }

  _later(fn, ms) { const h = this.env.setTimeout(() => { this.timers.delete(h); if (!this.destroyed) fn(); }, ms); this.timers.add(h); return h; }
  _render() {
    this.ui.render({ fen: this.board.fen(), lastMove: this.lastMove ? { from: this.lastMove.from, to: this.lastMove.to } : null,
      inCheck: this.board.inCheck(), turn: this.board.turn() });
    this.ui.clocks();
  }
  _play(m, byStudent) {
    const mv = this.board.move(m); this.lastMove = mv;
    this.ui.sound(mv.captured ? 'capture' : 'move'); return mv;
  }

  _next() {
    if (this.destroyed || this.prog.completed) return;
    if (!this.isFree) {
      if (this.prog.move_index >= this.item.moves.length) return this._complete();
      if (this.studentTurn) { this.turnStart = this.env.now(); this.ui.status('your_turn'); return; }
      this._later(() => this._playScriptedOpponent(), OPPONENT_REPLY_DELAY_MS); return;
    }
    if (this._freeGameEnded()) return this._finishFree();
    if (this.studentTurn) { this.turnStart = this.env.now(); this.nagCount = 0; this.ui.status('your_turn'); this._requestBefore(); } else this._engineReply();
  }

  _playScriptedOpponent() {
    const uci = this.item.moves[this.prog.move_index]; const m = uciToMove(this.board, uci);
    if (!m) return;
    this._play(m, false); this.prog.move_index++; this.ui.voiceNote?.(this.item, this.prog.move_index - 1); this._render(); this.ui.save(); this._next();
  }

  /** Student attempts a move. Returns {ok, reason?}. */
  tryMove({ from, to, promotion }) {
    if (this.destroyed || this.prog.completed || !this.studentTurn || this._thinking) return { ok: false, reason: 'not_turn' };
    const think = (this.env.now() - this.turnStart) / 1000;
    if (!this.isFree) {
      const uci = from + to + (promotion || '');
      const legal = uciToMove(this.board, uci);
      if (!legal || uci !== this.item.moves[this.prog.move_index]) {
        this.prog.wrong_attempts++; this.ui.reject(from, to); this.ui.status('wrong_move'); this.ui.wrong?.(this.item.type); this.ui.save();
        return { ok: false, reason: 'wrong' };
      }
      this._play(legal, true); this.prog.move_think_times.push(think); this.prog.move_index++;
      this.ui.voiceNote?.(this.item, this.prog.move_index - 1); this.ui.status('correct');
      this._render(); this.ui.save(); this._next(); return { ok: true };
    }
    // free play (engine / mate)
    const m = this.board.moves({ verbose: true }).find((x) => x.from === from && x.to === to && (x.promotion || undefined) === (promotion || undefined));
    if (!m) { this.ui.reject(from, to); return { ok: false, reason: 'illegal' }; }
    const minMs = this.item.player_min_delay_ms || 0; const elapsed = this.env.now() - this.turnStart;
    if (minMs > 0 && elapsed < minMs) { this.nagCount++; this.ui.tooFast(minMs - elapsed, this.nagCount); this.ui.reject(from, to); return { ok: false, reason: 'too_fast' }; }
    const preFen = this.board.fen(); const plyIndex = this.prog.moves_played.length;
    this._play(m, true);
    this.prog.moves_played.push(moveToUci(m)); this.prog.move_think_times.push(think);
    if (this.feedbackOn) this._startFeedback(preFen, plyIndex, m.san);
    if (this.item.student_clock_seconds > 0) this.prog.student_clock += this.item.clock_increment_seconds || 0;
    this._render(); this.ui.save(); this._next(); return { ok: true };
  }

  // ---------- smart feedback ("you had a better move" / "strong move") ----------
  _evalSafe(fen, ms, cb) {
    const gen = this.evalGen; if (!this.feedbackOn) return;
    this.engine.evalFen(fen, ms).then((cp) => { if (cp != null && !this.destroyed && gen === this.evalGen) cb(cp); }, () => {});
  }
  _requestBefore() {
    if (!this.feedbackOn) return; this.beforeCp = null; const fen = this.board.fen();
    this._evalSafe(fen, FEEDBACK_BEFORE_MS, (cp) => {
      if (this.board.fen() === fen) this.beforeCp = cp;
      if (this.pending && this.pending.before == null && this.pending.preFen === fen) { this.pending.before = cp; this._maybeFinishFeedback(); }
    });
  }
  _startFeedback(preFen, plyIndex, san) {
    this.pending = { preFen, before: this.beforeCp, after: null, color: this.item.player_color, plyIndex, san };
    if (this.pending.before == null) this._evalSafe(preFen, FEEDBACK_BEFORE_MS, (cp) => { if (this.pending && this.pending.preFen === preFen && this.pending.before == null) { this.pending.before = cp; this._maybeFinishFeedback(); } });
    if (this._freeGameEnded()) this._requestAfter(this.board.fen());
  }
  _requestAfter(fen) { const pend = this.pending; this._evalSafe(fen, FEEDBACK_AFTER_MS, (cp) => { if (this.pending === pend && pend.after == null) { pend.after = cp; this._maybeFinishFeedback(); } }); }
  _setAfter(scoreWhiteOrStm) { if (this.pending) { this.pending.after = scoreWhiteOrStm; this._maybeFinishFeedback(); } }
  _maybeFinishFeedback() {
    const p = this.pending; if (!p || p.before == null || p.after == null) return; this.pending = null;
    const white = p.color === 'white'; const before = white ? p.before : -p.before, after = white ? p.after : -p.after;
    const drop = before - after; const prog = this.prog;
    if (drop >= (this.item.engine_feedback_threshold_cp || FEEDBACK_THRESHOLD_CP)) {
      prog.mistake_count++; if (drop > prog.worst_mistake_drop_cp) { prog.worst_mistake_drop_cp = drop; prog.worst_mistake_ply = p.plyIndex; }
      this.ui.feedback?.('warn', { dropCp: drop, ply: p.plyIndex });
    }
    const gain = -drop;
    if (gain >= (this.item.good_move_threshold_cp || GOOD_MOVE_THRESHOLD_CP)) {
      prog.good_move_count++; if (gain > prog.best_good_move_gain_cp) { prog.best_good_move_gain_cp = gain; prog.best_good_move_ply = p.plyIndex; }
      this.ui.feedback?.('praise', { gainCp: gain, ply: p.plyIndex });
    }
    this.ui.save();
  }

  _freeGameEnded() {
    return this.board.isCheckmate() || this.board.isStalemate() || this.board.isInsufficientMaterial() ||
      this.prog.moves_played.length >= this.item.full_moves * 2 || this.board.moves().length === 0;
  }
  _finishFree() {
    if (this.item.type === 'mate') this.prog.objective_met = this.board.isCheckmate() ? this.board.turn() !== this.studentChar : false;
    this._complete();
  }

  _bookMove() {
    const played = this.prog.moves_played; const cands = [];
    for (const line of this.item.engine_openings) {
      if (line.length > played.length && played.every((u, i) => line[i] === u)) cands.push(line[played.length]);
    }
    if (!cands.length) return null;
    const pick = cands[Math.floor(this.env.random() * cands.length)];
    return uciToMove(this.board, pick) ? pick : null;
  }

  async _engineReply() {
    const my = ++this.token; this._thinking = true; this.engineSide = this.board.turn();
    const ply = this.prog.moves_played.length; const t0 = this.env.now();
    this.ui.status('engine_thinking');
    let uci = this._bookMove();
    try {
      if (!uci) {
        const r = await this.engine.search({ fen: this.item.fen, moves: this.prog.moves_played,
          skill: engineSkillForPly(this.item, ply), movetimeMs: this.item.engine_movetime_ms });
        uci = r.uci;
        // the engine already scored the position after the student's move while choosing its reply — reuse it (as the desktop app does)
        if (this.pending && this.pending.after == null && r.scoreStm != null) this._setAfter(r.scoreStm * (this.engineSide === 'b' ? -1 : 1));
      } else if (this.pending && this.pending.after == null) this._requestAfter(this.board.fen());
    } catch (e) { uci = null; }
    if (this.destroyed || my !== this.token) return;
    let m = uci && uciToMove(this.board, uci);
    if (!m) { const all = this.board.moves({ verbose: true }); m = all[Math.floor(this.env.random() * all.length)]; }
    const wait = Math.max(0, engineDelayForPly(this.item, ply) - (this.env.now() - t0));
    this.engineWaitEnd = this.env.now() + wait;
    await new Promise((r) => this._later(r, wait));
    if (this.destroyed || my !== this.token) return;
    this._thinking = false;
    this._play(m, false); this.prog.moves_played.push(moveToUci(m));
    if (this.item.engine_clock_seconds > 0) this.prog.engine_clock += this.item.clock_increment_seconds || 0;
    this._render(); this.ui.save(); this._next();
  }

  /** Call ~5x/second from the UI. Runs the clock of the side to move. */
  tick() {
    const now = this.env.now(); const dt = (now - this.lastTick) / 1000; this.lastTick = now;
    if (this.destroyed || this.prog.completed || !this.isFree) return;
    const studentSide = this.studentTurn;
    const key = studentSide ? 'student_clock' : 'engine_clock';
    const initial = studentSide ? this.item.student_clock_seconds : this.item.engine_clock_seconds;
    if (!(initial > 0)) return;
    this.prog[key] = Math.max(0, this.prog[key] - dt); this.ui.clocks();
    if (this.prog[key] <= 0) this._forfeit(studentSide ? 'student' : 'engine');
  }
  /** ms left of the student's own slow-down, or null when not applicable (panel "off"). */
  slowdownRemainingMs() {
    if (!this.isFree || this.prog.completed || !this.studentTurn || !(this.item.player_min_delay_ms > 0)) return null;
    return Math.max(0, this.item.player_min_delay_ms - (this.env.now() - this.turnStart));
  }
  /** ms left of the engine's "slow-down" pause before its move is shown, or null. */
  engineWaitMs() { return this._thinking && this.engineWaitEnd ? Math.max(0, this.engineWaitEnd - this.env.now()) : null; }
  /** Student moves left for the "Moves left" badge (engine/mate only), else null. */
  movesLeft() { return !this.isFree || this.prog.completed ? null : Math.max(0, this.item.full_moves - this.prog.move_think_times.length); }
  _forfeit(who) {
    this.prog.time_forfeit = true; if (this.item.type === 'mate') this.prog.objective_met = false;
    this.token++; this._thinking = false; this.ui.status('time_forfeit', { who });
    this.prog.completed = true; this.ui.save(); this.ui.complete(this.prog, { forfeit: true });
  }
  _complete() {
    this.prog.completed = true; this.ui.save(); this.ui.complete(this.prog, { forfeit: false });
  }
}
