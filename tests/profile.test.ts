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
  writeProfile(dir, "Profile 2", { def: ext({ path: "/abs/def", disable_reasons: [4, 1] }) });
  mkdirSync(join(dir, "System Profile"));
  writeFileSync(join(dir, "Local State"), "{}");

  expect(readAll(dir)).toEqual({
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
      disableReasons: [1, 4],
    },
  });
});

test("resolves a localized name from the extension's default locale", () => {
  dir = mkdtempSync(join(tmpdir(), "ew-profile-"));
  writeProfile(dir, "Default", { abc: ext({ manifest: { name: "__MSG_appName__", version: "2", default_locale: "en" } }) });
  const locale = join(dir, "Default", "Extensions", "abc", "1.0_0", "_locales", "en");
  mkdirSync(locale, { recursive: true });
  writeFileSync(join(locale, "messages.json"), JSON.stringify({ AppName: { message: "Real Name" } }));
  expect(readAll(dir)["Default/abc"].name).toBe("Real Name");
});

test("keeps the raw name when the locale file is missing", () => {
  dir = mkdtempSync(join(tmpdir(), "ew-profile-"));
  writeProfile(dir, "Default", { abc: ext({ manifest: { name: "__MSG_x__", version: "2", default_locale: "en" } }) });
  expect(readAll(dir)["Default/abc"].name).toBe("__MSG_x__");
});

test("reads the manifest from the folder when the record has none (unpacked)", () => {
  dir = mkdtempSync(join(tmpdir(), "ew-profile-"));
  const folder = join(dir, "unpacked");
  mkdirSync(folder);
  writeFileSync(join(folder, "manifest.json"), JSON.stringify({ name: "Unpacked", version: "0.3" }));
  writeProfile(dir, "Default", { abc: ext({ path: folder, location: 8, manifest: undefined }), gone: ext({ path: join(dir, "missing"), manifest: undefined }) });
  const snap = readAll(dir);
  expect(Object.keys(snap)).toEqual(["Default/abc"]);
  expect(snap["Default/abc"]).toMatchObject({ name: "Unpacked", version: "0.3", location: 8 });
});
