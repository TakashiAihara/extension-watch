// The cap counts entries, not bytes: an entry is a few hundred bytes, so 500 stay far below the
// 10 MB storage.local quota (no unlimitedStorage).
export const MAX_ENTRIES = 500;

// Entry states: "sent", "pending" (the send failed and the change is held for the next check), or
// "replaced" (the extension changed again before the held change was sent, so that exact change was
// never sent; what replaced it has its own entry, or nothing if it went back to the last sent state).
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
  return out.slice(0, MAX_ENTRIES);
}

export const hasPending = (history = []) => history.some((e) => e.state === "pending");

const same = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);

// Local time as YYYY-MM-DD HH:mm. Absolute, so it stays right after midnight.
export function formatTime(ms) {
  const d = new Date(ms);
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}
