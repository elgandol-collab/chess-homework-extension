// sound.js — move/capture sounds + the coach's voice clips (rush warnings, focus/wrong alerts, move voice notes).
// Same rules as the desktop app: round-robin for the "don't rush" pool, a missing file is a silent no-op, one global mute.
const cache = new Map();
export class SoundBoard {
  constructor(urlFn) { this.url = urlFn; this.muted = false; this.rushIdx = 0; this.current = new Set(); }
  _audio(name) { let a = cache.get(name); if (!a) { a = new Audio(this.url('sounds/' + encodeURIComponent(name))); a.preload = 'auto'; cache.set(name, a); } return a; }
  play(name, volume = 0.9) {
    if (this.muted || !name) return;
    try { const a = this._audio(name); a.volume = volume; a.currentTime = 0; a.play().catch(() => {}); } catch { /* missing file: stay silent */ }
  }
  move(kind) { this.play(kind === 'capture' ? 'capture.wav' : 'move.wav', 0.7); }
  /** Plays the next "don't rush" clip (round-robin over the filled slots). */
  rush(sounds) {
    const pool = ['rush_voice_file', 'rush_voice_file2', 'rush_voice_file3', 'rush_voice_file4'].map((k) => sounds?.[k]).filter(Boolean);
    if (!pool.length) return; this.play(pool[this.rushIdx % pool.length]); this.rushIdx++;
  }
  /** Round-robin pools with a per-slot cooldown (same rules as the desktop app): 'warn' = "you had a better move", 'good' = "strong move". */
  pool(kind, sounds) {
    const P = { warn: { keys: ['hint_sound_file', 'engine_advantage_tier2_sound_file', 'engine_advantage_tier3_sound_file', 'engine_advantage_slot4_sound_file'], defaults: ['hint.wav', '2.wav', '3.wav', '4.wav'] },
      good: { keys: ['good_move_sound1_file', 'good_move_sound2_file', 'good_move_sound3_file', 'good_move_sound4_file'], defaults: ['5.wav', '', 'striking.mp3', 'chess-horse.mp3'] } }[kind];
    this.poolState ||= { warn: { next: 0, last: {} }, good: { next: 0, last: {} } }; const st = this.poolState[kind];
    const slot = st.next; st.next = (slot + 1) % 4; const name = sounds?.[P.keys[slot]] || P.defaults[slot]; if (!name) return;
    const now = Date.now(); if (now - (st.last[slot] || 0) < 3000) return; st.last[slot] = now; this.play(name);
  }
  preload(sounds, items) {
    const names = new Set(['move.wav', 'capture.wav', 'hint.wav', '2.wav', '3.wav', '4.wav', '5.wav', 'striking.mp3', 'chess-horse.mp3', ...Object.values(sounds || {}).filter(Boolean)]);
    (items || []).forEach((it) => Object.values(it.move_voice_notes || {}).forEach((n) => names.add(n)));
    names.forEach((n) => { try { this._audio(n); } catch { /* ignore */ } });
  }
}
