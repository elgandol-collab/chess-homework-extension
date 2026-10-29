// rating.js — same Elo update as student_rating.py (K=32, start 1200), minus the file I/O.
export const DEFAULT_RATING = 1200;
export const K_FACTOR = 32;
const roundHalfEven = (x) => { const r = Math.round(x); return Math.abs(x % 1) === 0.5 && r % 2 !== 0 ? r - 1 : r; };

export function applyPuzzleResult(state, puzzleRating, solvedClean) {
  const old = state.rating;
  const expected = 1 / (1 + 10 ** ((puzzleRating - old) / 400));
  const actual = solvedClean ? 1 : 0;
  const next = roundHalfEven(old + K_FACTOR * (actual - expected));
  return { rating: next, solved: state.solved + 1, correct: state.correct + (solvedClean ? 1 : 0) };
}
export const freshRating = () => ({ rating: DEFAULT_RATING, solved: 0, correct: 0 });

/** Validate a student_rating.json from the old desktop app (optional import). Returns state or null. */
export function parseLegacyRating(text) {
  try {
    const d = JSON.parse(text);
    const rating = Math.trunc(Number(d.rating ?? DEFAULT_RATING));
    const solved = Math.trunc(Number(d.solved ?? 0)), correct = Math.trunc(Number(d.correct ?? 0));
    if (![rating, solved, correct].every(Number.isFinite)) return null;
    if (rating < 100 || rating > 4000 || solved < 0 || correct < 0 || correct > solved) return null;
    return { rating, solved, correct };
  } catch { return null; }
}
