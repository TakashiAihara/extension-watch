import type { Record, Snapshot } from "./profile";

const minus = (a: string[], b: string[] = []) => a.filter((x) => !b.includes(x));
const LISTS: [keyof Record, string][] = [
  ["permissions", "permissions"],
  ["hosts", "hosts"],
  ["contentScriptSites", "content script sites"],
];

// One { key, message } per changed extension. Removals only drop the record.
export function diff(prev: Snapshot, next: Snapshot): { key: string; message: string }[] {
  const changes = [];
  for (const [key, n] of Object.entries(next)) {
    const p = prev[key];
    const lines: string[] = [];
    if (!p) {
      lines.push(`installed ${n.version} (location ${n.location})`);
      for (const [k, label] of LISTS) {
        const xs = n[k] as string[];
        if (xs.length) lines.push(`${label}: ${xs.join(", ")}`);
      }
    } else {
      if (p.version !== n.version) lines.push(`version ${p.version} -> ${n.version}`);
      for (const [k, label] of LISTS) {
        const added = minus(n[k] as string[], p[k] as string[]);
        const removed = minus((p[k] as string[]) ?? [], n[k] as string[]);
        if (added.length) lines.push(`${label} added: ${added.join(", ")}`);
        if (removed.length) lines.push(`${label} removed: ${removed.join(", ")}`);
      }
      if (p.location !== n.location) lines.push(`location ${p.location} -> ${n.location}`);
    }
    if ((!p || !p.disableReasons.length) && n.disableReasons.length) {
      lines.push(`disabled (reasons ${n.disableReasons.join(", ")})`);
    }
    if (lines.length) changes.push({ key, message: `${n.name} (${n.id}) [${n.profile}]\n${lines.join("\n")}` });
  }
  return changes;
}

// Splits text into parts of at most maxBytes UTF-8 bytes without breaking a character.
export function split(text: string, maxBytes: number): string[] {
  const encoder = new TextEncoder();
  const parts: string[] = [];
  let part = "";
  let bytes = 0;
  for (const ch of text) {
    const n = encoder.encode(ch).length;
    if (bytes + n > maxBytes) {
      parts.push(part);
      part = "";
      bytes = 0;
    }
    part += ch;
    bytes += n;
  }
  return [...parts, part];
}
