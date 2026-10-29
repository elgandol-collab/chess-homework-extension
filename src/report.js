// report.js — result bundle for the coach: PGN (+[%clk] think times), text report, JSON, zipped. Mirrors cloud_sync.build_pgn_text + app._build_report_text.
import { Chess } from 'chess.js';
import { zipSync, strToU8 } from 'fflate';
import { STARTING_FEN, uciToMove } from './model.js';
import { t } from './i18n.js';

export const fmtClk = (sec) => { const total = Math.max(0, Math.round(sec)); const h = Math.floor(total / 3600), m = Math.floor((total % 3600) / 60), s = total % 60;
  return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`; };
export const fmtDuration = (sec) => { const total = Math.max(0, Math.round(sec)); const m = Math.floor(total / 60), s = total % 60; return m ? `${m}m ${String(s).padStart(2, '0')}s` : `${s}s`; };
const esc = (s) => String(s).replace(/[\\"]/g, '\\$&');
const pgnDate = (d) => `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, '0')}.${String(d.getDate()).padStart(2, '0')}`;

function movetext(item, ucis, thinkTimes, instructions) {
  const board = new Chess(item.fen); const studentIsWhite = item.player_color === 'white';
  const studentPlies = ucis.map((_, i) => i).filter((i) => (i % 2 === 0) === studentIsWhite);
  const byPly = new Map(studentPlies.map((p, k) => [p, thinkTimes[k]]).filter(([, v]) => v !== undefined));
  const out = [];
  if (instructions) out.push(`{${instructions.replace(/[{}]/g, '')}}`);
  ucis.forEach((u, i) => {
    const m = uciToMove(board, u); if (!m) return; const mv = board.move(m);
    const white = i % 2 === (new Chess(item.fen).turn() === 'w' ? 0 : 1);
    const num = Math.floor((i + (new Chess(item.fen).turn() === 'w' ? 0 : 1)) / 2) + parseInt(item.fen.split(' ')[5] || '1', 10);
    if (white) out.push(`${num}.`); else if (i === 0) out.push(`${num}...`);
    out.push(mv.san);
    if (byPly.has(i)) out.push(`{[%clk ${fmtClk(byPly.get(i))}]}`);
  });
  return out.join(' ');
}

export function buildPgn(hw, progress, now = new Date()) {
  const games = [];
  hw.items.forEach((item) => {
    const p = progress[item.id]; if (!p) return;
    const isLine = item.type === 'puzzle' || item.type === 'opening';
    const ucis = isLine ? item.moves : p.moves_played;
    if (!ucis.length) return;
    const stu = item.player_color === 'white';
    const other = isLine ? "Coach's line" : 'Engine';
    const H = [['Event', hw.title || 'Chess Homework'], ['Site', 'Chess Homework Trainer'], ['Date', pgnDate(now)],
      ['White', stu ? (hw.student || 'Student') : other], ['Black', stu ? other : (hw.student || 'Student')], ['Result', '*']];
    if (item.fen !== STARTING_FEN) H.push(['FEN', item.fen], ['SetUp', '1']);
    if (isLine) H.push(['Annotator', p.completed ? 'Solved' : `Solved ${p.move_index}/${item.moves.length} plies so far`]);
    else if (p.time_forfeit) H.push(['Termination', 'time forfeit']); else if (p.completed) H.push(['Termination', 'normal']);
    games.push(H.map(([k, v]) => `[${k} "${esc(v)}"]`).join('\n') + '\n\n' + movetext(item, ucis, p.move_think_times || [], isLine ? item.instructions : '') + ' *');
  });
  return games.join('\n\n') + (games.length ? '\n' : '');
}

export function buildReport(hw, progress, now = new Date()) {
  const ps = hw.items.map((it) => progress[it.id]).filter(Boolean);
  const done = ps.filter((p) => p.completed).length; const all = ps.flatMap((p) => p.move_think_times || []);
  const d = `${pgnDate(now).replace(/\./g, '-')} ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
  const lines = [t('rep.title', { title: hw.title }), t('rep.student', { student: hw.student || t('rep.no_student') }), t('rep.date', { date: d }),
    t('rep.score', { done, total: hw.items.length })];
  if (all.length) lines.push(t('rep.think_all', { avg: fmtDuration(all.reduce((a, b) => a + b, 0) / all.length), total: fmtDuration(all.reduce((a, b) => a + b, 0)) }));
  lines.push('-'.repeat(40));
  hw.items.forEach((item, i) => {
    const p = progress[item.id]; if (!p) return;
    let status, kind;
    if (item.type === 'engine' || item.type === 'mate') {
      const limit = item.full_moves * 2;
      if (item.type === 'mate' && p.completed && !p.time_forfeit) status = p.objective_met ? t('rep.mate_ok') : t('rep.mate_fail');
      else if (p.time_forfeit) status = t('rep.forfeit');
      else status = p.completed ? t('rep.complete') : t('rep.inc_ply', { done: p.moves_played.length, total: limit });
      kind = t(item.type === 'mate' ? 'rep.kind_mate' : 'rep.kind_engine');
    } else {
      status = p.completed ? t('rep.complete') : t('rep.inc_moves', { done: p.move_index, total: item.moves.length });
      kind = t(item.type === 'puzzle' ? 'rep.kind_puzzle' : 'rep.kind_opening');
    }
    let line = t('rep.item', { n: i + 1, kind, status, wrong: p.wrong_attempts });
    const tt = p.move_think_times || [];
    if (tt.length) line += ' ' + t('rep.item_think', { avg: fmtDuration(tt.reduce((a, b) => a + b, 0) / tt.length), total: fmtDuration(tt.reduce((a, b) => a + b, 0)) });
    lines.push(line);
  });
  return lines.join('\n');
}

export function buildResultJson(hw, progress, rating, now = new Date()) {
  return JSON.stringify({ format: 'chess-homework-result/1', title: hw.title, student: hw.student, exported_at: now.toISOString(), rating,
    items: hw.items.map((it) => ({ id: it.id, type: it.type, ...(progress[it.id] || {}) })) }, null, 2);
}

export function safeBaseName(hw) { return (hw.title || 'homework').replace(/[\\/:*?"<>|\s]+/g, '_').slice(0, 60) || 'homework'; }

export function buildZip(hw, progress, rating, now = new Date()) {
  const base = safeBaseName(hw);
  const files = { [`${base}.pgn`]: strToU8(buildPgn(hw, progress, now) || '(no games yet)\n'), [`${base}_report.txt`]: strToU8(buildReport(hw, progress, now)),
    [`${base}_result.json`]: strToU8(buildResultJson(hw, progress, rating, now)) };
  return { name: `${base}_result.zip`, bytes: zipSync(files) };
}
