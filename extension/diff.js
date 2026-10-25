export function snapshot(infos, selfId) {
  const out = {};
  for (const e of infos) {
    if (e.id === selfId || e.type !== "extension") continue;
    out[e.id] = {
      name: e.name,
      version: e.version,
      permissions: [...(e.permissions ?? [])].sort(),
      hostPermissions: [...(e.hostPermissions ?? [])].sort(),
      installType: e.installType,
      enabled: e.enabled,
      disabledReason: e.disabledReason,
    };
  }
  return out;
}

const minus = (a, b) => a.filter((x) => !b.includes(x));

// Returns one human-readable message per changed extension. Uninstalls only drop the record.
export function diff(prev, next) {
  const messages = [];
  for (const [id, n] of Object.entries(next)) {
    const p = prev[id];
    const lines = [];
    if (!p) {
      lines.push(`installed ${n.version} (${n.installType})`);
      if (n.permissions.length) lines.push(`permissions: ${n.permissions.join(", ")}`);
      if (n.hostPermissions.length) lines.push(`hosts: ${n.hostPermissions.join(", ")}`);
    } else {
      if (p.version !== n.version) lines.push(`version ${p.version} -> ${n.version}`);
      for (const key of ["permissions", "hostPermissions"]) {
        const label = key === "permissions" ? "permissions" : "hosts";
        const added = minus(n[key], p[key]);
        const removed = minus(p[key], n[key]);
        if (added.length) lines.push(`${label} added: ${added.join(", ")}`);
        if (removed.length) lines.push(`${label} removed: ${removed.join(", ")}`);
      }
      if (p.installType !== n.installType) lines.push(`installType ${p.installType} -> ${n.installType}`);
    }
    if ((!p || p.enabled) && !n.enabled) lines.push(`disabled (${n.disabledReason ?? "unknown"})`);
    if (lines.length) messages.push(`${n.name} (${id})\n${lines.join("\n")}`);
  }
  return messages;
}
