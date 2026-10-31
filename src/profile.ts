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
};

export type Snapshot = { [key: string]: Record };

// Chrome's built-in extensions (COMPONENT / EXTERNAL_COMPONENT) change only with Chrome itself.
const SKIP_LOCATIONS = new Set([5, 10]);

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

function readManifest(extDir: string): any {
  try {
    return JSON.parse(readFileSync(join(extDir, "manifest.json"), "utf8"));
  } catch {
    return undefined;
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
      disableReasons: [...(s.disable_reasons ?? [])].sort(),
    };
  }
  return out;
}

// Profiles are the directories that hold a Preferences file ("Default", "Profile 2", ...).
export function readAll(userDataDir: string): Snapshot {
  const out: Snapshot = {};
  for (const entry of readdirSync(userDataDir, { withFileTypes: true })) {
    if (entry.isDirectory() && existsSync(join(userDataDir, entry.name, "Preferences"))) {
      Object.assign(out, readProfile(userDataDir, entry.name));
    }
  }
  return out;
}
