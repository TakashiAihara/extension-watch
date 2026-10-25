import { describe, expect, test } from "bun:test";
import { diff, snapshot } from "../extension/diff.js";

const info = (over = {}) => ({
  id: "abc",
  name: "Sample",
  type: "extension",
  version: "1.0",
  permissions: ["storage"],
  hostPermissions: [],
  installType: "normal",
  enabled: true,
  ...over,
});

const snap = (...infos) => snapshot(infos, "self");

describe("diff", () => {
  test("no change sends nothing", () => {
    expect(diff(snap(info()), snap(info()))).toEqual([]);
  });

  test("version bump with added and removed permissions and hosts", () => {
    const prev = snap(info({ hostPermissions: ["https://a.example/*"] }));
    const next = snap(info({ version: "1.1", permissions: ["tabs"], hostPermissions: ["https://b.example/*"] }));
    expect(diff(prev, next)).toEqual([
      [
        "Sample (abc)",
        "version 1.0 -> 1.1",
        "permissions added: tabs",
        "permissions removed: storage",
        "hosts added: https://b.example/*",
        "hosts removed: https://a.example/*",
      ].join("\n"),
    ]);
  });

  test("new extension lists its permissions", () => {
    expect(diff({}, snap(info({ hostPermissions: ["<all_urls>"] })))).toEqual([
      "Sample (abc)\ninstalled 1.0 (normal)\npermissions: storage\nhosts: <all_urls>",
    ]);
  });

  test("disable by Chrome for a permission increase", () => {
    const next = snap(info({ enabled: false, disabledReason: "permissions_increase" }));
    expect(diff(snap(info()), next)).toEqual(["Sample (abc)\ndisabled (permissions_increase)"]);
  });

  test("staying disabled and re-enabling send nothing", () => {
    const off = snap(info({ enabled: false }));
    expect(diff(off, off)).toEqual([]);
    expect(diff(off, snap(info()))).toEqual([]);
  });

  test("uninstall only drops the record", () => {
    expect(diff(snap(info()), {})).toEqual([]);
  });

  test("snapshot skips itself and non-extensions", () => {
    expect(Object.keys(snapshot([info({ id: "self" }), info({ id: "t", type: "theme" }), info()], "self"))).toEqual([
      "abc",
    ]);
  });
});
