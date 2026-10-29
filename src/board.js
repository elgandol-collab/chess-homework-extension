// board.js — DOM chessboard: click-click and drag-and-drop, last-move / check / reject highlights.
const FILES = 'abcdefgh';
const sqName = (f, r) => FILES[f] + (r + 1);

export function parseFenBoard(fen) {
  const rows = fen.split(' ')[0].split('/'); const map = {};
  rows.forEach((row, i) => { let f = 0; for (const ch of row) { if (/\d/.test(ch)) f += +ch; else { map[sqName(f, 7 - i)] = (ch === ch.toUpperCase() ? 'w' : 'b') + ch.toUpperCase(); f++; } } });
  return map;
}

export class BoardView {
  /** opts: {onMove(from,to), pieceBase:'pieces/'} */
  constructor(root, opts) {
    this.root = root; this.opts = opts; this.orientation = 'white'; this.state = null; this.selected = null;
    this.interactiveColor = null; this.drag = null; this.rejectTimer = null;
    root.classList.add('board'); root.setAttribute('dir', 'ltr');
    root.addEventListener('pointerdown', (e) => this._down(e));
    window.addEventListener('pointermove', (e) => this._move(e));
    window.addEventListener('pointerup', (e) => this._up(e));
  }
  setOrientation(o) { this.orientation = o; this._draw(); }
  /** color of pieces the student may pick up ('w'|'b'|null = none) */
  setInteractive(color) { this.interactiveColor = color; if (!color) this.selected = null; this._draw(); }
  setState(state) { this.state = state; this.selected = null; this._draw(); }
  flashReject(from, to) {
    clearTimeout(this.rejectTimer); this.reject = [from, to]; this._draw();
    this.rejectTimer = setTimeout(() => { this.reject = null; this._draw(); }, 450);
  }
  _draw() {
    if (!this.state) { this.root.innerHTML = ''; return; }
    const pieces = parseFenBoard(this.state.fen); const flip = this.orientation === 'black';
    const kingSq = this.state.inCheck ? Object.keys(pieces).find((s) => pieces[s] === this.state.turn + 'K') : null;
    const frag = document.createDocumentFragment();
    for (let vr = 0; vr < 8; vr++) for (let vf = 0; vf < 8; vf++) {
      const f = flip ? 7 - vf : vf, r = flip ? vr : 7 - vr; const sq = sqName(f, r);
      const d = document.createElement('div'); d.className = 'sq ' + ((f + r) % 2 === 0 ? 'dark' : 'light'); d.dataset.sq = sq;
      const lm = this.state.lastMove; if (lm && (lm.from === sq || lm.to === sq)) d.classList.add('last');
      if (this.selected === sq) d.classList.add('sel'); if (kingSq === sq) d.classList.add('check');
      if (this.reject && this.reject.includes(sq)) d.classList.add('reject');
      if (vf === 0) { const c = document.createElement('span'); c.className = 'coord rank'; c.textContent = r + 1; d.appendChild(c); }
      if (vr === 7) { const c = document.createElement('span'); c.className = 'coord file'; c.textContent = FILES[f]; d.appendChild(c); }
      const p = pieces[sq];
      if (p) { const img = document.createElement('img'); img.className = 'piece'; img.draggable = false; img.alt = p; img.src = `${this.opts.pieceBase}${p}.png`; d.appendChild(img); }
      frag.appendChild(d);
    }
    this.root.replaceChildren(frag);
  }
  _sqAt(x, y) {
    const rect = this.root.getBoundingClientRect(); if (x < rect.left || x > rect.right || y < rect.top || y > rect.bottom) return null;
    const vf = Math.min(7, Math.floor(((x - rect.left) / rect.width) * 8)), vr = Math.min(7, Math.floor(((y - rect.top) / rect.height) * 8));
    const flip = this.orientation === 'black'; return sqName(flip ? 7 - vf : vf, flip ? vr : 7 - vr);
  }
  _down(e) {
    if (!this.state || !this.interactiveColor || e.button > 0) return;
    const sq = this._sqAt(e.clientX, e.clientY); if (!sq) return;
    const pieces = parseFenBoard(this.state.fen); const p = pieces[sq];
    if (this.selected && this.selected !== sq && !(p && p[0] === this.interactiveColor)) { const from = this.selected; this.selected = null; this._draw(); this.opts.onMove(from, sq); return; }
    if (p && p[0] === this.interactiveColor) {
      this.selected = sq; this._draw();
      const img = this.root.querySelector(`[data-sq="${sq}"] img`); if (!img) return;
      const rect = this.root.getBoundingClientRect(); const size = rect.width / 8;
      const ghost = img.cloneNode(); ghost.className = 'ghost'; ghost.style.width = ghost.style.height = size + 'px'; document.body.appendChild(ghost);
      this.drag = { from: sq, ghost, size, moved: false, sx: e.clientX, sy: e.clientY }; this._place(e); img.style.opacity = '0.35'; e.preventDefault();
    } else if (this.selected) { this.selected = null; this._draw(); }
  }
  _place(e) { const d = this.drag; d.ghost.style.left = e.clientX - d.size / 2 + 'px'; d.ghost.style.top = e.clientY - d.size / 2 + 'px'; }
  _move(e) { if (!this.drag) return; if (Math.hypot(e.clientX - this.drag.sx, e.clientY - this.drag.sy) > 5) this.drag.moved = true; this._place(e); }
  _up(e) {
    if (!this.drag) return; const { from, ghost, moved } = this.drag; ghost.remove(); this.drag = null;
    const to = this._sqAt(e.clientX, e.clientY);
    if (moved && to && to !== from) { this.selected = null; this._draw(); this.opts.onMove(from, to); } else this._draw();
  }
}
