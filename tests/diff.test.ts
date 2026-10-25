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

const snap = (infos: object[], warnings = {}) => snapshot(infos, "self", warnings);
const messages = (prev: object, next: object) => diff(prev, next).map((c) => c.message);

describe("diff", () => {
  test("no change sends nothing", () => {
    expect(diff(snap([info()]), snap([info()]))).toEqual([]);
  });

  test("version bump with added and removed permissions, hosts and warnings", () => {
    const prev = snap([info({ hostPermissions: ["https://a.example/*"] })], { abc: ["Old warning"] });
    const next = snap([info({ version: "1.1", permissions: ["tabs"], hostPermissions: ["https://b.example/*"] })], {
      abc: ["Read and change all your data on all websites"],
    });
    expect(diff(prev, next)).toEqual([
      {
        id: "abc",
        message: [
          "Sample (abc)",
          "version 1.0 -> 1.1",
          "permissions added: tabs",
          "permissions removed: storage",
          "hosts added: https://b.example/*",
          "hosts removed: https://a.example/*",
          "warnings added: Read and change all your data on all websites",
          "warnings removed: Old warning",
        ].join("\n"),
      },
    ]);
  });

  test("new extension lists its permissions, hosts and warnings", () => {
    expect(messages({}, snap([info({ hostPermissions: ["<all_urls>"] })], { abc: ["W"] }))).toEqual([
      "Sample (abc)\ninstalled 1.0 (normal)\npermissions: storage\nhosts: <all_urls>\nwarnings: W",
    ]);
  });

  test("new extension installed already disabled", () => {
    expect(messages({}, snap([info({ permissions: [], enabled: false })]))).toEqual([
      "Sample (abc)\ninstalled 1.0 (normal)\ndisabled (unknown)",
    ]);
  });

  test("update disabled by Chrome for a permission increase", () => {
    const next = snap([info({ version: "1.1", enabled: false, disabledReason: "permissions_increase" })]);
    expect(messages(snap([info()]), next)).toEqual(["Sample (abc)\nversion 1.0 -> 1.1\ndisabled (permissions_increase)"]);
  });

  test("installType change", () => {
    expect(messages(snap([info()]), snap([info({ installType: "admin" })]))).toEqual([
      "Sample (abc)\ninstallType normal -> admin",
    ]);
  });

  test("staying disabled and re-enabling send nothing", () => {
    const off = snap([info({ enabled: false })]);
    expect(diff(off, off)).toEqual([]);
    expect(diff(off, snap([info()]))).toEqual([]);
  });

  test("uninstall only drops the record", () => {
    expect(diff(snap([info()]), {})).toEqual([]);
  });

  test("one entry per changed extension", () => {
    const prev = snap([info(), info({ id: "def", name: "Other" })]);
    const next = snap([info({ version: "2" }), info({ id: "def", name: "Other", version: "3" })]);
    expect(diff(prev, next).map((c) => c.id)).toEqual(["abc", "def"]);
  });

  test("snapshot skips itself and non-extensions", () => {
    expect(Object.keys(snapshot([info({ id: "self" }), info({ id: "t", type: "theme" }), info()], "self"))).toEqual([
      "abc",
    ]);
  });
});
