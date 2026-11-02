// Enough for months of ordinary updates; storage.local holds 10 MB without unlimitedStorage.
export const MAX_ENTRIES = 500;

// Adds one entry per change, newest first. A change that failed to send comes back unchanged on
// the next check, so it updates its unsent entry instead of adding another one.
export function record(history = [], changes, sentIds, at) {
  const out = [...history];
  for (const { id, name, lines } of changes) {
    const sent = sentIds.has(id);
    const i = out.findIndex((e) => e.id === id);
    if (i !== -1 && !out[i].sent && same(out[i].lines, lines)) {
      out[i] = { ...out[i], sent };
      continue;
    }
    out.unshift({ at, id, name, lines, sent });
  }
  return out.slice(0, MAX_ENTRIES);
}

const same = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);

// Local time as YYYY-MM-DD HH:mm. Absolute, so it stays right after midnight and can be matched with ntfy.
export function formatTime(ms) {
  const d = new Date(ms);
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}
