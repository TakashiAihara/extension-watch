import { afterEach, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readAll } from "../src/profile";
import { ext, writeProfile } from "./fixture";

let dir: string;
afterEach(() => rmSync(dir, { recursive: true, force: true }));

test("reads extensions from every profile and skips built-in and empty records", () => {
  dir = mkdtempSync(join(tmpdir(), "ew-profile-"));
  writeProfile(dir, "Default", {
    abc: ext({ active_permissions: { api: ["tabs", { socket: ["tcp-connect"] }], explicit_host: ["https://a.example/*"], scriptable_host: ["<all_urls>"] } }),
    builtin: ext({ location: 5 }),
    external_builtin: ext({ location: 10 }),
    leftover: { disable_reasons: [1] },
  });
  writeProfile(dir, "Profile 2", { def: ext({ path: "/abs/def", disable_reasons: [4, 1, 16], blacklist_state: 1, omaha_blocklist_state: 0 }) });
  mkdirSync(join(dir, "System Profile"));
  writeFileSync(join(dir, "Local State"), "{}");

  expect(readAll(dir).snapshot).toEqual({
    "Default/abc": {
      profile: "Default",
      id: "abc",
      name: "Sample",
      version: "1.0",
      permissions: ["tabs", '{"socket":["tcp-connect"]}'],
      hosts: ["https://a.example/*"],
      contentScriptSites: ["<all_urls>"],
      location: 1,
      disableReasons: [],
      blocklist: [],
    },
    "Profile 2/def": {
      profile: "Profile 2",
      id: "def",
      name: "Sample",
      version: "1.0",
      permissions: ["storage"],
      hosts: [],
      contentScriptSites: [],
      location: 1,
      disableReasons: [1, 4, 16],
      blocklist: ["blacklist_state=1"],
    },
  });
});

test("resolves a localized name from the extension's default locale", () => {
  dir = mkdtempSync(join(tmpdir(), "ew-profile-"));
  writeProfile(dir, "Default", { abc: ext({ manifest: { name: "__MSG_appName__", version: "2", default_locale: "en" } }) });
  const locale = join(dir, "Default", "Extensions", "abc", "1.0_0", "_locales", "en");
  mkdirSync(locale, { recursive: true });
  writeFileSync(join(locale, "messages.json"), JSON.stringify({ AppName: { message: "Real Name" } }));
  expect(readAll(dir).snapshot["Default/abc"].name).toBe("Real Name");
});

test("keeps the raw name when the locale file is missing", () => {
  dir = mkdtempSync(join(tmpdir(), "ew-profile-"));
  writeProfile(dir, "Default", { abc: ext({ manifest: { name: "__MSG_x__", version: "2", default_locale: "en" } }) });
  expect(readAll(dir).snapshot["Default/abc"].name).toBe("__MSG_x__");
});

test("reads the manifest from the folder when the record has none (unpacked)", () => {
  dir = mkdtempSync(join(tmpdir(), "ew-profile-"));
  const folder = join(dir, "unpacked");
  mkdirSync(folder);
  writeFileSync(join(folder, "manifest.json"), JSON.stringify({ name: "Unpacked", version: "0.3" }));
  writeProfile(dir, "Default", { abc: ext({ path: folder, location: 8, manifest: undefined }), gone: ext({ path: join(dir, "missing"), manifest: undefined }) });
  const snap = readAll(dir).snapshot;
  expect(Object.keys(snap)).toEqual(["Default/abc"]);
  expect(snap["Default/abc"]).toMatchObject({ name: "Unpacked", version: "0.3", location: 8 });
});

test("a profile that cannot be parsed is reported and the others are still read", () => {
  dir = mkdtempSync(join(tmpdir(), "ew-profile-"));
  writeProfile(dir, "Default", { abc: ext() });
  writeProfile(dir, "Profile 2", {});
  writeFileSync(join(dir, "Profile 2", "Secure Preferences"), "{broken");
  const { snapshot, failed } = readAll(dir);
  expect(Object.keys(snapshot)).toEqual(["Default/abc"]);
  expect(failed.map((f) => f.profile)).toEqual(["Profile 2"]);
});

test("a directory with no profiles is an error", () => {
  dir = mkdtempSync(join(tmpdir(), "ew-profile-"));
  mkdirSync(join(dir, "System Profile"));
  expect(() => readAll(dir)).toThrow("no Chrome profiles in");
});

test("a leftover integer bitmask and non-integer reasons are ignored, as Chrome does", () => {
  dir = mkdtempSync(join(tmpdir(), "ew-profile-"));
  writeProfile(dir, "Default", { abc: ext({ disable_reasons: 6 }), def: ext({ disable_reasons: [2, "x", 1] }) });
  const { snapshot } = readAll(dir);
  expect(snapshot["Default/abc"].disableReasons).toEqual([]);
  expect(snapshot["Default/def"].disableReasons).toEqual([1, 2]);
});

test("a default_locale that is not a folder name is not used as a path", () => {
  dir = mkdtempSync(join(tmpdir(), "ew-profile-"));
  writeProfile(dir, "Default", { abc: ext({ manifest: { name: "__MSG_n__", version: "1", default_locale: "../../x" } }) });
  // _locales/../../x from Extensions/abc/1.0_0 lands in Extensions/abc/x.
  const outside = join(dir, "Default", "Extensions", "abc", "x");
  mkdirSync(outside, { recursive: true });
  writeFileSync(join(outside, "messages.json"), JSON.stringify({ n: { message: "Leaked" } }));
  expect(readAll(dir).snapshot["Default/abc"].name).toBe("__MSG_n__");
});

test("guest and system profiles are not read", () => {
  dir = mkdtempSync(join(tmpdir(), "ew-profile-"));
  writeProfile(dir, "Default", { abc: ext() });
  writeProfile(dir, "Guest Profile", { g: ext() });
  writeProfile(dir, "System Profile", { s: ext() });
  expect(Object.keys(readAll(dir).snapshot)).toEqual(["Default/abc"]);
});
