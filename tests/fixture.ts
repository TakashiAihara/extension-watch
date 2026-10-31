import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

// Writes a Chrome profile with the given extension settings into Secure Preferences, as Windows does.
export function writeProfile(userDataDir: string, profile: string, settings: object) {
  const dir = join(userDataDir, profile);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "Preferences"), JSON.stringify({}));
  writeFileSync(join(dir, "Secure Preferences"), JSON.stringify({ extensions: { settings } }));
}

export const ext = (over: object = {}) => ({
  path: "abc/1.0_0",
  location: 1,
  disable_reasons: [],
  manifest: { name: "Sample", version: "1.0" },
  active_permissions: { api: ["storage"], explicit_host: [], scriptable_host: [], manifest_permissions: [] },
  ...over,
});
