// storage.js — chrome.storage.local (extension) with a localStorage fallback (plain-page dev). Everything stays on this device.
const hasChrome = typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local;
export async function get(key, dflt = null) {
  if (hasChrome) { const r = await chrome.storage.local.get(key); return key in r ? r[key] : dflt; }
  try { const v = localStorage.getItem(key); return v === null ? dflt : JSON.parse(v); } catch { return dflt; }
}
export async function set(key, value) {
  if (hasChrome) return chrome.storage.local.set({ [key]: value });
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* quota */ }
}
export async function remove(key) { if (hasChrome) return chrome.storage.local.remove(key); try { localStorage.removeItem(key); } catch { /* ignore */ } }

/** Stable id for a homework file: FNV-1a over its text. */
export function hashText(text) { let h = 0x811c9dc5; for (let i = 0; i < text.length; i++) { h ^= text.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; } return h.toString(16).padStart(8, '0') + '-' + text.length.toString(16); }
