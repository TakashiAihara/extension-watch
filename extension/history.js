// Both caps hold: an install entry lists every permission, host and warning, so a few large
// extensions could otherwise fill the 10 MB storage.local quota (no unlimitedStorage) with history.
export const MAX_ENTRIES = 500;
export const MAX_BYTES = 1_000_000;

// Entry states: "sent", "pending" (the send failed and the change is held for the next check), or
// "replaced" (the next check did not find the same change, so that exact change is never sent: the
// extension changed again, went back, was removed, or only its localized warnings moved with a UI
// language change; a different change has its own entry).
//
// Each check passes every change it found. A pending entry is the retry of a change only when the
// same extension shows the same lines again; otherwise it is replaced. A held change and a new event
// with the same lines within one check cannot be told apart, and read as the retry.
export function record(history = [], changes, sentIds, at) {
  const byId = new Map(changes.map((c) => [c.id, c]));
  const retried = new Set();
  const out = history.map((e) => {
    if (e.state !== "pending") return e;
    const c = byId.get(e.id);
    if (!c || !same(e.lines, c.lines)) return { ...e, state: "replaced" };
    retried.add(e.id);
    return sentIds.has(e.id) ? { ...e, state: "sent" } : e;
  });
  for (const { id, name, lines } of changes) {
    if (retried.has(id)) continue;
    out.unshift({ at, id, name, lines, state: sentIds.has(id) ? "sent" : "pending" });
  }
  return trim(out);
}

// Drops the oldest entries first, but never a pending one: it still has to be resolved by a retry.
// There is at most one pending entry per extension, so they cannot grow without bound.
function trim(entries) {
  const out = [...entries];
  let bytes = new TextEncoder().encode(JSON.stringify(out)).length;
  for (let i = out.length - 1; i >= 0 && (out.length > MAX_ENTRIES || bytes > MAX_BYTES); i--) {
    if (out[i].state === "pending") continue;
    bytes -= new TextEncoder().encode(JSON.stringify(out[i])).length + 1;
    out.splice(i, 1);
  }
  return out;
}

export const hasPending = (history = []) => history.some((e) => e.state === "pending");

const same = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);

// Local time as YYYY-MM-DD HH:mm. Absolute, so it stays right after midnight.
export function formatTime(ms) {
  const d = new Date(ms);
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}
