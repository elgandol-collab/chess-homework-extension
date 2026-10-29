// pgn.js — PGN reader for homework files (headers + mainline SAN), mirrors pgn_import.py.
import { Chess } from 'chess.js';
import { HomeworkFileError } from './model.js';

const HEADER_RE = /^\s*\[\s*(\w+)\s+"((?:[^"\\]|\\.)*)"\s*\]\s*$/;

function splitGames(text) {
  const games = [];
  let cur = null, inMoves = false;
  for (const line of text.split(/\r?\n/)) {
    const h = HEADER_RE.exec(line);
    if (h) {
      if (!cur || inMoves) { cur = { headers: {}, movetext: [] }; games.push(cur); inMoves = false; }
      cur.headers[h[1]] = h[2].replace(/\\(["\\])/g, '$1');
    } else if (line.trim()) {
      if (!cur) { cur = { headers: {}, movetext: [] }; games.push(cur); }
      inMoves = true; cur.movetext.push(line);
    }
  }
  return games;
}

/** Tokenise movetext: returns {preComment, firstMoveComment, sans[]} (mainline only). */
function readMovetext(lines) {
  const s = lines.join('\n');
  const sans = []; let preComment = '', firstMoveComment = '';
  let i = 0, depth = 0;
  while (i < s.length) {
    const c = s[i];
    if (c === '{') {
      const j = s.indexOf('}', i); const end = j < 0 ? s.length : j;
      const txt = s.slice(i + 1, end).trim();
      if (depth === 0) { if (sans.length === 0 && !preComment) preComment = txt; else if (sans.length === 1 && !firstMoveComment) firstMoveComment = txt; }
      i = end + 1;
    } else if (c === ';') { const j = s.indexOf('\n', i); i = j < 0 ? s.length : j + 1; }
    else if (c === '(') { depth++; i++; }
    else if (c === ')') { depth = Math.max(0, depth - 1); i++; }
    else if (/\s/.test(c)) i++;
    else {
      let j = i; while (j < s.length && !/[\s{};()]/.test(s[j])) j++;
      const tok = s.slice(i, j); i = j;
      if (depth > 0) continue;
      if (/^\$\d+$/.test(tok) || /^(1-0|0-1|1\/2-1\/2|\*)$/.test(tok)) continue;
      const stripped = tok.replace(/^\d+\.+/, '');
      if (!stripped || /^[!?]+$/.test(stripped)) continue;
      sans.push(stripped.replace(/[!?]+$/, ''));
    }
  }
  return { preComment, firstMoveComment, sans };
}

const intHeader = (h, key, d) => { const r = (h[key] ?? '').trim(); if (!r) return d; return /^[+-]?\d+$/.test(r) ? parseInt(r, 10) : d; };
const truthy = (v) => ['1', 'true', 'yes', 'on'].includes((v ?? '').trim().toLowerCase());

function parseStages(raw) {
  const out = [];
  for (const part of raw.split(';')) {
    const p = part.trim(); if (!p || !p.includes(':')) continue;
    const [a, b] = p.split(':', 2);
    if (/^[+-]?\d+$/.test(a.trim()) && /^[+-]?\d+$/.test(b.trim())) out.push([parseInt(a, 10), parseInt(b, 10)]);
  }
  return out;
}

export function parsePgnGames(text) {
  const items = []; let meta = {};
  splitGames(text).forEach((g, gi) => {
    const n = gi + 1, h = g.headers;
    const { preComment, firstMoveComment, sans } = readMovetext(g.movetext);
    if (n === 1) {
      if ((h.HWTitle ?? '').trim()) meta.title = h.HWTitle.trim();
      if ((h.HWStudent ?? '').trim()) meta.student = h.HWStudent.trim();
      const seq = (h.HWSequential ?? '').trim().toLowerCase();
      if (seq) meta.sequential = ['1', 'true', 'yes', 'on'].includes(seq);
      if ((h.HWWhatsApp ?? '').trim()) meta.whatsapp = h.HWWhatsApp.trim();
    }
    const fen = (h.FEN ?? '').trim() || 'start';
    let board;
    try { board = new Chess(fen === 'start' ? undefined : fen); }
    catch (e) { throw new HomeworkFileError(`اللعبة رقم ${n}: قيمة [FEN] غير صالحة '${fen}'`); }
    const startTurn = board.turn() === 'w' ? 'white' : 'black';
    const uci = [];
    for (const san of sans) {
      let m;
      try { m = board.move(san); }
      catch (e) { throw new HomeworkFileError(`اللعبة رقم ${n} ('${h.Event ?? '?'}'): نقلة غير قانونية ${san} - تأكد من النقلات الرئيسية في ملف الـ PGN.`); }
      uci.push(m.from + m.to + (m.promotion || ''));
    }
    let type = (h.HWType ?? 'opening').trim().toLowerCase();
    if (!['puzzle', 'opening', 'engine'].includes(type)) type = 'opening';
    if (type !== 'engine' && uci.length === 0) return;

    const explicit = (h.HWPlayer ?? '').trim().toLowerCase();
    const player_color = ['white', 'black'].includes(explicit) ? explicit : startTurn;
    const ev = (h.Event ?? '').trim();
    const instructions = preComment || firstMoveComment || (ev && ev !== '?' ? ev : '');
    const item = { type, id: (h.HWId ?? '').trim() || `${type}_${n}`, instructions, fen, player_color };
    if (type === 'engine') {
      Object.assign(item, {
        full_moves: intHeader(h, 'HWFullMoves', 30), engine_skill: intHeader(h, 'HWEngineSkill', 8),
        engine_movetime_ms: intHeader(h, 'HWEngineMovetimeMs', 600), clock_seconds: intHeader(h, 'HWClockSeconds', 0),
        clock_increment_seconds: intHeader(h, 'HWClockIncrementSeconds', 0), engine_min_delay_ms: intHeader(h, 'HWEngineMinDelayMs', 0),
        player_min_delay_ms: intHeader(h, 'HWPlayerMinDelayMs', 0), engine_feedback_enabled: truthy(h.HWEngineFeedback),
      });
      const st = (h.HWEngineDelayStages ?? '').trim(); if (st) item.engine_delay_stages = parseStages(st);
      const bk = (h.HWOpeningBook ?? '').trim();
      if (bk) item.engine_openings = bk.split(';').filter((p) => p.trim()).map((p) => p.trim().split(/\s+/));
    } else item[type === 'puzzle' ? 'solution' : 'line'] = uci;
    items.push(item);
  });
  return { meta, items };
}
