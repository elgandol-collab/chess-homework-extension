// model.js — port of homework_model.py + pgn_import.py (student side).
// Same file formats (.chesshw.json / .pgn), same validation, same Arabic error messages.
import { Chess } from 'chess.js';
import { parsePgnGames } from './pgn.js';

export const STARTING_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
export const DEFAULTS = {
  ENGINE_SKILL: 20, ENGINE_CLOCK: 300, STUDENT_CLOCK: 1200, INCREMENT: 10,
  ENGINE_DELAY: 3000, PLAYER_DELAY: 3000,
};

export class HomeworkFileError extends Error {}

const UCI_RE = /^[a-h][1-8][a-h][1-8][qrbn]?$/;

export function resolveFen(raw) {
  if (!raw || String(raw).trim().toLowerCase() === 'start') return STARTING_FEN;
  return String(raw).trim();
}

export function makeBoard(fen, errPrefix = '') {
  try { return new Chess(fen); }
  catch (e) { throw new HomeworkFileError(`${errPrefix}FEN غير صالح: '${fen}'`); }
}

/** Find the legal move matching a UCI string, or null. */
export function uciToMove(board, uci) {
  if (!UCI_RE.test(uci)) return null;
  const from = uci.slice(0, 2), to = uci.slice(2, 4), promotion = uci[4];
  for (const m of board.moves({ verbose: true })) {
    if (m.from === from && m.to === to && (m.promotion || undefined) === promotion) return m;
  }
  return null;
}
export const moveToUci = (m) => m.from + m.to + (m.promotion || '');

function inferPlayerColor(fen, explicit) {
  if (explicit) {
    const e = String(explicit).trim().toLowerCase();
    if (e === 'white' || e === 'w') return 'white';
    if (e === 'black' || e === 'b') return 'black';
    throw new HomeworkFileError(`قيمة player_color غير مفهومة: '${e}' (استخدم white أو black)`);
  }
  return makeBoard(fen).turn() === 'w' ? 'white' : 'black';
}

function validateMoveList(fen, moves, itemId) {
  const board = makeBoard(fen, `[${itemId}] `);
  moves.forEach((uci, idx) => {
    const i = idx + 1;
    if (!UCI_RE.test(uci)) {
      throw new HomeworkFileError(`[${itemId}] النقلة رقم ${i} ('${uci}') ليست بصيغة UCI صحيحة`);
    }
    const m = uciToMove(board, uci);
    if (!m) {
      throw new HomeworkFileError(
        `[${itemId}] النقلة رقم ${i} ('${uci}') غير قانونية في هذا الموضع. تأكد من ترتيب النقلات والـ FEN.`);
    }
    board.move(m);
  });
}

function validateOpeningBook(fen, raw, itemId) {
  if (!raw) return [];
  if (!Array.isArray(raw)) throw new HomeworkFileError(`[${itemId}] 'engine_openings' يجب أن يكون قائمة من قوائم نقلات UCI.`);
  return raw.map((rawLine, idx) => {
    if (!Array.isArray(rawLine) || rawLine.length === 0) {
      throw new HomeworkFileError(`[${itemId}] الخط رقم ${idx + 1} في 'engine_openings' لازم يكون قائمة نقلات UCI غير فارغة.`);
    }
    const line = rawLine.map((m) => String(m).trim());
    validateMoveList(fen, line, `${itemId} (افتتاحية المحرك #${idx + 1})`);
    return line;
  });
}

function pyInt(v) { // mimic Python int() on JSON values
  if (v === null || v === undefined || typeof v === 'object') return NaN;
  if (typeof v === 'boolean') return v ? 1 : 0;
  if (typeof v === 'number') return Number.isFinite(v) ? Math.trunc(v) : NaN;
  const s = String(v).trim();
  return /^[+-]?\d+$/.test(s) ? parseInt(s, 10) : NaN;
}

function intField(raw, key, dflt, itemId) {
  if (!(key in raw)) return dflt;
  const n = pyInt(raw[key]);
  if (Number.isNaN(n)) throw new HomeworkFileError(`[${itemId}] '${key}' يجب أن يكون رقمًا صحيحًا (القيمة: ${JSON.stringify(raw[key])})`);
  return n;
}

function validateStages(raw, itemId, name, valueKey, clamp) {
  if (!raw || (Array.isArray(raw) && raw.length === 0)) return [];
  if (!Array.isArray(raw)) throw new HomeworkFileError(`[${itemId}] '${name}' يجب أن تكون قائمة مراحل.`);
  const stages = raw.map((st, i) => {
    const idx = i + 1;
    let a, b;
    if (st && typeof st === 'object' && !Array.isArray(st)) { a = st.from_move; b = st[valueKey]; }
    else if (Array.isArray(st) && st.length === 2) { [a, b] = st; }
    else throw new HomeworkFileError(`[${itemId}] المرحلة رقم ${idx} في '${name}' لازم تكون [from_move, ${valueKey}].`);
    const from = pyInt(a), val = pyInt(b);
    if (Number.isNaN(from) || Number.isNaN(val)) {
      throw new HomeworkFileError(`[${itemId}] المرحلة رقم ${idx} في '${name}': قيمة غير صحيحة (${JSON.stringify(a)}, ${JSON.stringify(b)}).`);
    }
    if (from < 1) throw new HomeworkFileError(`[${itemId}] المرحلة رقم ${idx}: 'from_move' لازم يكون 1 أو أكبر.`);
    return [from, clamp(val)];
  });
  stages.sort((x, y) => x[0] - y[0]);
  return stages;
}
const validateDelayStages = (r, id) => validateStages(r, id, 'engine_delay_stages', 'delay_ms', (v) => Math.max(0, v));
const validateSkillStages = (r, id) => validateStages(r, id, 'engine_skill_stages', 'skill', (v) => Math.max(0, Math.min(20, v)));

function validateVoiceNotes(raw, movesLen, itemId) {
  if (!raw) return {};
  if (typeof raw !== 'object' || Array.isArray(raw)) throw new HomeworkFileError(`[${itemId}] 'move_voice_notes' يجب أن يكون كائن JSON (object).`);
  const notes = {};
  for (const [k, v] of Object.entries(raw)) {
    const idx = pyInt(k);
    if (Number.isNaN(idx)) throw new HomeworkFileError(`[${itemId}] 'move_voice_notes': المفتاح '${k}' لازم يكون رقم نقلة صحيح.`);
    if (!(idx >= 0 && idx < movesLen)) throw new HomeworkFileError(`[${itemId}] 'move_voice_notes': رقم النقلة ${idx} خارج نطاق الخط (عدد النقلات: ${movesLen}).`);
    const fn = String(v).trim(); if (fn) notes[idx] = fn;
  }
  return notes;
}
const SOUND_KEYS = ['rush_voice_file', 'rush_voice_file2', 'rush_voice_file3', 'rush_voice_file4', 'hint_sound_file',
  'engine_advantage_tier2_sound_file', 'engine_advantage_tier3_sound_file', 'engine_advantage_slot4_sound_file',
  'good_move_sound1_file', 'good_move_sound2_file', 'good_move_sound3_file', 'good_move_sound4_file', 'close_warning_sound_file',
  'puzzle_focus_sound_file', 'puzzle_focus_sound_file2', 'puzzle_focus_sound_file3', 'opening_wrong_sound_file',
  'opening_wrong_sound_file2', 'opening_wrong_sound_file3', 'publish_sound_file', 'close_blocked_publish_sound_file'];
function readSounds(src) { const o = {}; for (const k of SOUND_KEYS) o[k] = String(src?.[k] ?? '').trim(); return o; }

const pyBool = (v) => !(v === undefined || v === null || v === false || v === 0 || v === '' ||
  (Array.isArray(v) && v.length === 0) || (typeof v === 'object' && v !== null && !Array.isArray(v) && Object.keys(v).length === 0));

/** Item fields that don't apply to puzzle/opening, so item objects have a uniform shape. */
function baseItem(o) {
  return {
    id: o.id, type: o.type, instructions: o.instructions, fen: o.fen, moves: o.moves, player_color: o.player_color,
    full_moves: 30, engine_skill: DEFAULTS.ENGINE_SKILL, engine_auto_difficulty_enabled: false,
    engine_skill_min: 0, engine_skill_max: 20, engine_movetime_ms: 600,
    engine_clock_seconds: 0, student_clock_seconds: 0, clock_increment_seconds: 0,
    engine_min_delay_ms: 0, player_min_delay_ms: 0, engine_delay_stages: [], engine_skill_stages: [],
    engine_openings: [], engine_feedback_enabled: false, engine_feedback_threshold_cp: 150,
    good_move_threshold_cp: 150, puzzle_rating: 1200, move_voice_notes: {}, ...o,
  };
}

function loadFromJson(text) {
  let data;
  try { data = JSON.parse(text); }
  catch (e) { throw new HomeworkFileError(`ملف الواجب ليس JSON صالحًا: ${e.message}`); }
  if (data === null || typeof data !== 'object' || Array.isArray(data)) {
    throw new HomeworkFileError('ملف الواجب يجب أن يكون كائن JSON (object) في المستوى الأعلى.');
  }
  const rawItems = data.items;
  if (!Array.isArray(rawItems) || rawItems.length === 0) throw new HomeworkFileError("ملف الواجب لا يحتوي على أي عناصر في 'items'.");

  const items = rawItems.map((raw, i) => {
    const idx = i + 1;
    if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) throw new HomeworkFileError(`العنصر رقم ${idx} في 'items' ليس كائنًا صالحًا.`);
    const type = String(raw.type ?? '').trim().toLowerCase();
    if (!['puzzle', 'opening', 'engine', 'mate'].includes(type)) {
      throw new HomeworkFileError(`العنصر رقم ${idx}: نوع غير معروف '${type}' (المسموح: puzzle أو opening أو engine أو mate).`);
    }
    const id = String(raw.id || `${type}_${idx}`);
    const instructions = String(raw.instructions ?? '').trim();
    const fen = resolveFen(String(raw.fen ?? 'start'));
    const o = { id, type, instructions, fen, moves: [] };

    if (type === 'engine' || type === 'mate') {
      makeBoard(fen, `[${id}] `);
      o.full_moves = intField(raw, 'full_moves', 30, id);
      o.engine_skill = intField(raw, 'engine_skill', DEFAULTS.ENGINE_SKILL, id);
      o.engine_auto_difficulty_enabled = pyBool(raw.engine_auto_difficulty_enabled);
      o.engine_skill_min = intField(raw, 'engine_skill_min', 0, id);
      o.engine_skill_max = intField(raw, 'engine_skill_max', 20, id);
      o.engine_movetime_ms = intField(raw, 'engine_movetime_ms', 600, id);
      const legacy = 'clock_seconds' in raw ? intField(raw, 'clock_seconds', null, id) : null;
      o.engine_clock_seconds = intField(raw, 'engine_clock_seconds', legacy ?? DEFAULTS.ENGINE_CLOCK, id);
      o.student_clock_seconds = intField(raw, 'student_clock_seconds', legacy ?? DEFAULTS.STUDENT_CLOCK, id);
      o.clock_increment_seconds = intField(raw, 'clock_increment_seconds', DEFAULTS.INCREMENT, id);
      o.engine_min_delay_ms = intField(raw, 'engine_min_delay_ms', DEFAULTS.ENGINE_DELAY, id);
      o.engine_delay_stages = validateDelayStages(raw.engine_delay_stages ?? [], id);
      o.engine_skill_stages = validateSkillStages(raw.engine_skill_stages ?? [], id);
      o.player_min_delay_ms = intField(raw, 'player_min_delay_ms', DEFAULTS.PLAYER_DELAY, id);
      o.engine_openings = validateOpeningBook(fen, raw.engine_openings ?? [], id);
      o.engine_feedback_enabled = pyBool(raw.engine_feedback_enabled);
      o.engine_feedback_threshold_cp = intField(raw, 'engine_feedback_threshold_cp', 150, id);
      o.good_move_threshold_cp = intField(raw, 'good_move_threshold_cp', 150, id);
    } else {
      const key = type === 'puzzle' ? 'solution' : 'line';
      const rm = raw[key];
      if (!Array.isArray(rm) || rm.length === 0) throw new HomeworkFileError(`[${id}] العنصر لا يحتوي على قائمة نقلات صالحة في '${key}'.`);
      o.moves = rm.map((m) => String(m).trim());
      validateMoveList(fen, o.moves, id);
    }
    o.move_voice_notes = validateVoiceNotes(raw.move_voice_notes, o.moves.length, id);
    o.player_color = inferPlayerColor(fen, raw.player_color);
    o.puzzle_rating = intField(raw, 'puzzle_rating', 1200, id);
    return baseItem(o);
  });

  return {
    title: data.title ?? '', student: data.student ?? '', sequential: 'sequential' in data ? pyBool(data.sequential) : true,
    coach_whatsapp: cleanPhone(data.coach_whatsapp), sounds: readSounds(data), items,
  };
}

function cleanPhone(v) {
  const d = String(v ?? '').replace(/\D+/g, '');
  return d.length >= 8 && d.length <= 15 ? d : '';
}

function loadFromPgn(text, filename) {
  const { meta, items: rawItems } = parsePgnGames(text);
  if (!rawItems.length) throw new HomeworkFileError('ملف الـ PGN لا يحتوي على أي ألعاب فيها نقلات - تأكد إن كل لعبة فيها نقلات رئيسية (mainline).');
  const items = rawItems.map((raw) => {
    const fen = resolveFen(raw.fen);
    const isEng = raw.type === 'engine';
    const moves = isEng ? [] : (raw.solution || raw.line);
    if (!isEng) validateMoveList(fen, moves, raw.id);
    const o = { id: raw.id, type: raw.type, instructions: raw.instructions, fen, moves,
      player_color: inferPlayerColor(fen, raw.player_color) };
    if (isEng) {
      Object.assign(o, {
        full_moves: raw.full_moves, engine_skill: raw.engine_skill, engine_movetime_ms: raw.engine_movetime_ms,
        engine_clock_seconds: raw.clock_seconds, student_clock_seconds: raw.clock_seconds,
        clock_increment_seconds: raw.clock_increment_seconds, engine_min_delay_ms: raw.engine_min_delay_ms,
        engine_delay_stages: validateDelayStages(raw.engine_delay_stages ?? [], raw.id),
        player_min_delay_ms: raw.player_min_delay_ms,
        engine_openings: validateOpeningBook(fen, raw.engine_openings ?? [], raw.id),
        engine_feedback_enabled: raw.engine_feedback_enabled,
      });
    }
    return baseItem(o);
  });
  const base = (filename || 'homework').replace(/\.[^.]+$/, '');
  return {
    title: meta.title ?? `واجب شطرنج — ${base}`, student: meta.student ?? '',
    sequential: meta.sequential ?? true, coach_whatsapp: cleanPhone(meta.whatsapp), sounds: readSounds({}), items,
  };
}

/** Parse the text of a homework file (.pgn or .json/.chesshw.json). */
export function loadHomework(text, filename = '') {
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  const hw = /\.pgn$/i.test(filename) ? loadFromPgn(text, filename) : loadFromJson(text);
  const seen = new Set();
  for (const it of hw.items) { let id = it.id, n = 2; while (seen.has(id)) id = `${it.id}_${n++}`; it.id = id; seen.add(id); }
  return hw;
}

// --- schedule helpers (same semantics as HomeworkItem methods) ---
export function stageValueForPly(item, plyPlayed, stages, dflt) {
  if (!stages.length) return dflt;
  const fullMove = Math.floor(plyPlayed / 2) + 1;
  let v = dflt;
  for (const [from, val] of stages) if (fullMove >= from) v = val;
  return v;
}
export const engineDelayForPly = (it, ply) => stageValueForPly(it, ply, it.engine_delay_stages, it.engine_min_delay_ms);
export const engineSkillForPly = (it, ply) => stageValueForPly(it, ply, it.engine_skill_stages, it.engine_skill);
