// warnings: id -> management.getPermissionWarningsById result. hostPermissions leaves out
// content-script matches; the warnings cover them, but only at Chrome's wording granularity
// (going from 4 to 5 sites keeps the same "a number of websites" warning).
export function snapshot(infos, selfId, warnings = {}) {
  const out = {};
  for (const e of infos) {
    if (e.id === selfId || e.type !== "extension") continue;
    out[e.id] = {
      name: e.name,
      version: e.version,
      permissions: [...(e.permissions ?? [])].sort(),
      hostPermissions: [...(e.hostPermissions ?? [])].sort(),
      warnings: [...(warnings[e.id] ?? [])].sort(),
      installType: e.installType,
      enabled: e.enabled,
      disabledReason: e.disabledReason,
    };
  }
  return out;
}

// `?? []`: records written before a list existed.
const minus = (a, b = []) => a.filter((x) => !b.includes(x));
const LISTS = [
  ["permissions", "permissions"],
  ["hostPermissions", "hosts"],
  ["warnings", "warnings"],
];

// Returns one { id, message } per changed extension. Uninstalls only drop the record.
export function diff(prev, next) {
  const changes = [];
  for (const [id, n] of Object.entries(next)) {
    const p = prev[id];
    const lines = [];
    if (!p) {
      lines.push(`installed ${n.version} (${n.installType})`);
      for (const [key, label] of LISTS) if (n[key].length) lines.push(`${label}: ${n[key].join(", ")}`);
    } else {
      if (p.version !== n.version) lines.push(`version ${p.version} -> ${n.version}`);
      for (const [key, label] of LISTS) {
        const added = minus(n[key], p[key]);
        const removed = minus(p[key] ?? [], n[key]);
        if (added.length) lines.push(`${label} added: ${added.join(", ")}`);
        if (removed.length) lines.push(`${label} removed: ${removed.join(", ")}`);
      }
      if (p.installType !== n.installType) lines.push(`installType ${p.installType} -> ${n.installType}`);
    }
    if ((!p || p.enabled) && !n.enabled) lines.push(`disabled (${n.disabledReason ?? "unknown"})`);
    if (lines.length) changes.push({ id, message: `${n.name} (${id})\n${lines.join("\n")}` });
  }
  return changes;
}

// Splits text into parts of at most maxBytes UTF-8 bytes without breaking a character.
export function split(text, maxBytes) {
  const encoder = new TextEncoder();
  const parts = [];
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
