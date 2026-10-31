import { existsSync, readdirSync, readFileSync } from "node:fs";
import { isAbsolute, join } from "node:path";

export type Record = {
  profile: string;
  id: string;
  name: string;
  version: string;
  permissions: string[];
  hosts: string[];
  contentScriptSites: string[];
  location: number;
  disableReasons: number[];
  blocklist: string[];
};

export type Snapshot = { [key: string]: Record };

// Chrome's built-in extensions (COMPONENT / EXTERNAL_COMPONENT) change only with Chrome itself.
const SKIP_LOCATIONS = new Set([5, 10]);
// Safe Browsing / Omaha blocklisting is kept here, not in disable_reasons (blocklist_extension_prefs.cc).
const BLOCKLIST_KEYS = ["blacklist_state", "omaha_blocklist_state", "extension_telemetry_service_blocklist_state"];

// Guest sessions are thrown away when they end, so their extensions would read as removed and reinstalled.
const NOT_PROFILES = new Set(["Guest Profile", "System Profile"]);

const sorted = (xs: unknown[] = []) => xs.map((x) => (typeof x === "string" ? x : JSON.stringify(x))).sort();

// Windows keeps extension settings in "Secure Preferences"; Linux builds keep them in "Preferences".
function settings(profileDir: string): { [id: string]: any } {
  const out: { [id: string]: any } = {};
  for (const file of ["Preferences", "Secure Preferences"]) {
    const path = join(profileDir, file);
    if (!existsSync(path)) continue;
    Object.assign(out, JSON.parse(readFileSync(path, "utf8")).extensions?.settings ?? {});
  }
  return out;
}

// Current Chrome stores a list of reason bits; older profiles store one integer bitmask.
function reasons(value: unknown): number[] {
  if (Array.isArray(value)) return [...value].sort((a, b) => a - b);
  if (typeof value !== "number") return [];
  const out = [];
  for (let bit = 1; bit <= value; bit *= 2) if (value & bit) out.push(bit);
  return out;
}

function readManifest(extDir: string): any {
  try {
    return JSON.parse(readFileSync(join(extDir, "manifest.json"), "utf8"));
  } catch {
    return undefined;
  }
}

function resolveName(name: string, manifest: any, extDir: string): string {
  const m = /^__MSG_(.+)__$/.exec(name);
  if (!m || !manifest.default_locale) return name;
  try {
    const messages = JSON.parse(readFileSync(join(extDir, "_locales", manifest.default_locale, "messages.json"), "utf8"));
    const key = Object.keys(messages).find((k) => k.toLowerCase() === m[1].toLowerCase());
    return key ? messages[key].message : name;
  } catch {
    return name;
  }
}

export function readProfile(userDataDir: string, profile: string): Snapshot {
  const profileDir = join(userDataDir, profile);
  const out: Snapshot = {};
  for (const [id, s] of Object.entries(settings(profileDir))) {
    // Records without a path carry nothing to compare.
    if (!s.path || SKIP_LOCATIONS.has(s.location)) continue;
    const extDir = isAbsolute(s.path) ? s.path : join(profileDir, "Extensions", s.path);
    // Unpacked extensions keep no manifest in the profile; read it from their folder.
    const manifest = s.manifest ?? readManifest(extDir);
    if (!manifest) continue;
    const active = s.active_permissions ?? {};
    out[`${profile}/${id}`] = {
      profile,
      id,
      name: resolveName(manifest.name ?? id, manifest, extDir),
      version: manifest.version ?? "",
      permissions: sorted([...(active.api ?? []), ...(active.manifest_permissions ?? [])]),
      hosts: sorted(active.explicit_host),
      contentScriptSites: sorted(active.scriptable_host),
      location: s.location,
      disableReasons: reasons(s.disable_reasons),
      blocklist: BLOCKLIST_KEYS.filter((k) => s[k]).map((k) => `${k}=${s[k]}`),
    };
  }
  return out;
}

// Profiles are the directories that hold a Preferences file ("Default", "Profile 2", ...). A profile
// that cannot be read is returned in `failed` so the others are still compared.
export function readAll(userDataDir: string): { snapshot: Snapshot; failed: { profile: string; message: string }[] } {
  const profiles = readdirSync(userDataDir, { withFileTypes: true })
    .filter((e) => e.isDirectory() && !NOT_PROFILES.has(e.name) && existsSync(join(userDataDir, e.name, "Preferences")))
    .map((e) => e.name);
  if (!profiles.length) throw new Error(`no Chrome profiles in ${userDataDir}`);

  const snapshot: Snapshot = {};
  const failed = [];
  for (const profile of profiles) {
    try {
      Object.assign(snapshot, readProfile(userDataDir, profile));
    } catch (err) {
      failed.push({ profile, message: (err as Error).message });
    }
  }
  return { snapshot, failed };
}
