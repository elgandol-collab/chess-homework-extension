// engine.js — minimal UCI client over any transport {send(line), onLine(cb), terminate()}.
// In the extension the transport is a Web Worker running Stockfish (WASM); in tests it is the Node build.
export class UciEngine {
  constructor(transport) {
    this.t = transport; this.waiters = new Set(); this.chain = Promise.resolve();
    transport.onLine((line) => { for (const w of [...this.waiters]) w(line); });
    this.ready = this._init();
  }
  _wait(test, timeoutMs, what) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.waiters.delete(h); reject(new Error(`engine timeout: ${what}`)); }, timeoutMs);
      const h = (line) => { const r = test(line); if (r !== undefined && r !== false) { clearTimeout(timer); this.waiters.delete(h); resolve(r); } };
      this.waiters.add(h);
    });
  }
  async _init() {
    const up = this._wait((l) => /^uciok/.test(l) || undefined, 20000, 'uciok');
    this.t.send('uci'); await up;
    const rd = this._wait((l) => /^readyok/.test(l) || undefined, 20000, 'readyok');
    this.t.send('isready'); await rd;
  }
  /** Queue a search. Resolves to {uci, scoreStm} — uci is null if the engine has no move; scoreStm is the engine's own score in centipawns
   *  from the side-to-move's point of view (mate = ±100000), or null if no score was reported. */
  search({ fen, moves = [], skill = 20, movetimeMs = 600 }) {
    const run = async () => {
      await this.ready;
      this.t.send(`setoption name Skill Level value ${Math.max(0, Math.min(20, skill | 0))}`);
      this.t.send('ucinewgame');
      this.t.send(`position fen ${fen}${moves.length ? ' moves ' + moves.join(' ') : ''}`);
      let score = null, depth = -1;
      const onInfo = (l) => {
        if (!l.startsWith('info ') || /\bupperbound\b|\blowerbound\b/.test(l)) return;
        const mp = /\bmultipv (\d+)/.exec(l); if (mp && mp[1] !== '1') return;
        const sc = /\bscore (cp|mate) (-?\d+)/.exec(l); if (!sc) return;
        const d = +((/\bdepth (\d+)/.exec(l) || [0, 0])[1]); if (d < depth) return; depth = d;
        score = sc[1] === 'cp' ? +sc[2] : (+sc[2] > 0 ? 100000 : -100000);
      };
      this.waiters.add(onInfo);
      try {
        const done = this._wait((l) => { const m = /^bestmove\s+(\S+)/.exec(l); return m ? m : undefined; }, movetimeMs + 15000, 'bestmove');
        this.t.send(`go movetime ${Math.max(10, movetimeMs | 0)}`);
        const m = await done;
        return { uci: m[1] === '(none)' || m[1] === '0000' ? null : m[1], scoreStm: score };
      } finally { this.waiters.delete(onInfo); }
    };
    const p = this.chain.then(run, run);
    this.chain = p.catch(() => {});
    return p;
  }
  async bestMove(opts) { return (await this.search(opts)).uci; }
  /** Quick silent evaluation of a position at full strength. Resolves to centipawns from WHITE's point of view (mate = ±100000), or null. */
  async evalFen(fen, movetimeMs = 400) {
    const { scoreStm } = await this.search({ fen, skill: 20, movetimeMs });
    if (scoreStm == null) return null;
    return fen.split(' ')[1] === 'b' ? -scoreStm : scoreStm;
  }
  stop() { this.t.send('stop'); }
  terminate() { try { this.t.terminate(); } catch { /* ignore */ } }
}

/** Browser transport: a Stockfish Web Worker (UCI over postMessage). */
export function workerTransport(url) {
  const w = new Worker(url);
  const cbs = [];
  w.onmessage = (ev) => { const line = typeof ev.data === 'string' ? ev.data : ev.data?.data ?? ''; cbs.forEach((cb) => cb(String(line))); };
  return { send: (l) => w.postMessage(l), onLine: (cb) => cbs.push(cb), terminate: () => w.terminate() };
}
