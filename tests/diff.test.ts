import { describe, expect, test } from "bun:test";
import { diff, split } from "../src/diff";
import type { Record } from "../src/profile";

const rec = (over: Partial<Record> = {}): Record => ({
  profile: "Default",
  id: "abc",
  name: "Sample",
  version: "1.0",
  permissions: ["storage"],
  hosts: [],
  contentScriptSites: [],
  location: 1,
  disableReasons: [],
  ...over,
});
const snap = (...rs: Record[]) => Object.fromEntries(rs.map((r) => [`${r.profile}/${r.id}`, r]));
const messages = (prev: object, next: object) => diff(prev as any, next as any).map((c) => c.message);

describe("diff", () => {
  test("no change sends nothing", () => {
    expect(diff(snap(rec()), snap(rec()))).toEqual([]);
  });

  test("version bump with added and removed permissions, hosts and content script sites", () => {
    const prev = snap(rec({ hosts: ["https://a.example/*"], contentScriptSites: ["https://old.example/*"] }));
    const next = snap(rec({ version: "1.1", permissions: ["tabs"], hosts: ["https://b.example/*"], contentScriptSites: ["<all_urls>"] }));
    expect(diff(prev, next)).toEqual([
      {
        key: "Default/abc",
        message: [
          "Sample (abc) [Default]",
          "version 1.0 -> 1.1",
          "permissions added: tabs",
          "permissions removed: storage",
          "hosts added: https://b.example/*",
          "hosts removed: https://a.example/*",
          "content script sites added: <all_urls>",
          "content script sites removed: https://old.example/*",
        ].join("\n"),
      },
    ]);
  });

  test("new extension lists what it can reach", () => {
    expect(messages({}, snap(rec({ hosts: ["https://a/*"], contentScriptSites: ["<all_urls>"] })))).toEqual([
      "Sample (abc) [Default]\ninstalled 1.0 (location 1)\npermissions: storage\nhosts: https://a/*\ncontent script sites: <all_urls>",
    ]);
  });

  test("new extension installed already disabled", () => {
    expect(messages({}, snap(rec({ permissions: [], disableReasons: [1] })))).toEqual([
      "Sample (abc) [Default]\ninstalled 1.0 (location 1)\ndisabled (reasons 1)",
    ]);
  });

  test("update that Chrome disabled", () => {
    expect(messages(snap(rec()), snap(rec({ version: "1.1", disableReasons: [4] })))).toEqual([
      "Sample (abc) [Default]\nversion 1.0 -> 1.1\ndisabled (reasons 4)",
    ]);
  });

  test("location change", () => {
    expect(messages(snap(rec()), snap(rec({ location: 8 })))).toEqual(["Sample (abc) [Default]\nlocation 1 -> 8"]);
  });

  test("staying disabled and re-enabling send nothing", () => {
    const off = snap(rec({ disableReasons: [1] }));
    expect(diff(off, off)).toEqual([]);
    expect(diff(off, snap(rec()))).toEqual([]);
  });

  test("the same extension in two profiles is reported per profile", () => {
    const prev = snap(rec(), rec({ profile: "Profile 2" }));
    const next = snap(rec({ version: "2" }), rec({ profile: "Profile 2", version: "2" }));
    expect(diff(prev, next).map((c) => c.key)).toEqual(["Default/abc", "Profile 2/abc"]);
  });

  test("removal only drops the record", () => {
    expect(diff(snap(rec()), {})).toEqual([]);
  });
});

describe("split", () => {
  test("short text is one part", () => {
    expect(split("abc", 10)).toEqual(["abc"]);
  });

  test("parts stay within the byte limit without breaking characters", () => {
    const text = "aあ".repeat(5);
    const parts = split(text, 5);
    expect(parts.join("")).toBe(text);
    expect(parts).toEqual(["aあa", "あa", "あa", "あa", "あ"]);
  });
});
