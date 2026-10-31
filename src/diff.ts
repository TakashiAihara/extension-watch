import type { Record, Snapshot } from "./profile";

// extensions/common/mojom/manifest.mojom ManifestLocation.
const LOCATIONS: { [n: number]: string } = {
  1: "internal",
  2: "external_pref",
  3: "external_registry",
  4: "unpacked",
  5: "component",
  6: "external_pref_download",
  7: "external_policy_download",
  8: "command_line",
  9: "external_policy",
  10: "external_component",
};
// extensions/browser/disable_reason.h, keyed by the bit value stored in disable_reasons.
const DISABLE_REASONS: { [n: number]: string } = {
  [1 << 0]: "user_action",
  [1 << 1]: "permissions_increase",
  [1 << 2]: "reload",
  [1 << 3]: "unsupported_requirement",
  [1 << 4]: "sideload_wipeout",
  [1 << 8]: "not_verified",
  [1 << 9]: "greylist",
  [1 << 10]: "corrupted",
  [1 << 11]: "remote_install",
  [1 << 13]: "external_extension",
  [1 << 14]: "update_required_by_policy",
  [1 << 15]: "custodian_approval_required",
  [1 << 16]: "blocked_by_policy",
  [1 << 19]: "reinstall",
  [1 << 20]: "not_allowlisted",
  [1 << 22]: "published_in_store_required_by_policy",
  [1 << 23]: "unsupported_manifest_version",
  [1 << 24]: "unsupported_developer_extension",
  [1 << 25]: "unknown",
  [1 << 26]: "blocked_by_cloud_policy_check",
  [1 << 27]: "by_another_extension",
};
const location = (n: number) => LOCATIONS[n] ?? `location ${n}`;
const reason = (n: number) => DISABLE_REASONS[n] ?? String(n);

function minus<T>(a: T[], b: T[] = []): T[] {
  return a.filter((x) => !b.includes(x));
}

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
      lines.push(`installed ${n.version} (${location(n.location)})`);
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
      if (p.location !== n.location) lines.push(`location ${location(p.location)} -> ${location(n.location)}`);
    }
    const disabled = minus(n.disableReasons, p?.disableReasons);
    if (disabled.length) lines.push(`disabled (${disabled.map(reason).join(", ")})`);
    const blocklisted = minus(n.blocklist, p?.blocklist);
    if (blocklisted.length) lines.push(`blocklisted (${blocklisted.join(", ")})`);
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
