import { describe, expect, test } from "bun:test";
import { formatTime, record } from "../extension/history.js";

const change = (id: string, lines: string[]) => ({ id, name: `Ext ${id}`, lines, message: "" });

describe("record", () => {
  test("adds sent and unsent changes newest first", () => {
    const h = record([], [change("a", ["enabled"]), change("b", ["version 1 -> 2"])], new Set(["a"]), 100);
    expect(h).toEqual([
      { at: 100, id: "b", name: "Ext b", lines: ["version 1 -> 2"], sent: false },
      { at: 100, id: "a", name: "Ext a", lines: ["enabled"], sent: true },
    ]);
  });

  test("a held change that is sent later updates its entry and keeps the first time", () => {
    const held = record([], [change("a", ["version 1 -> 2"])], new Set(), 100);
    const again = record(held, [change("a", ["version 1 -> 2"])], new Set(), 200);
    expect(again).toEqual(held);
    expect(record(again, [change("a", ["version 1 -> 2"])], new Set(["a"]), 300)).toEqual([
      { at: 100, id: "a", name: "Ext a", lines: ["version 1 -> 2"], sent: true },
    ]);
  });

  test("a held change that grew before it was sent gets a new entry", () => {
    const held = record([], [change("a", ["version 1 -> 2"])], new Set(), 100);
    const grown = record(held, [change("a", ["version 1 -> 3"])], new Set(["a"]), 200);
    expect(grown.map((e) => [e.at, e.lines[0], e.sent])).toEqual([
      [200, "version 1 -> 3", true],
      [100, "version 1 -> 2", false],
    ]);
  });

  test("the same change seen again after it was sent is a new event", () => {
    const sent = record([], [change("a", ["disabled (unknown)"])], new Set(["a"]), 100);
    expect(record(sent, [change("a", ["disabled (unknown)"])], new Set(["a"]), 200)).toHaveLength(2);
  });

  test("only the newest entry of an extension is updated", () => {
    let h = record([], [change("a", ["enabled"])], new Set(), 100);
    h = record(h, [change("b", ["enabled"])], new Set(["b"]), 150);
    h = record(h, [change("a", ["enabled"])], new Set(["a"]), 200);
    expect(h.map((e) => [e.id, e.at, e.sent])).toEqual([
      ["b", 150, true],
      ["a", 100, true],
    ]);
  });

  test("keeps the newest 500 entries", () => {
    let h: ReturnType<typeof record> = [];
    for (let i = 0; i < 503; i++) h = record(h, [change(`e${i}`, ["enabled"])], new Set([`e${i}`]), i);
    expect(h).toHaveLength(500);
    expect(h[0].at).toBe(502);
    expect(h[499].at).toBe(3);
  });
});

test("formatTime writes local time as YYYY-MM-DD HH:mm", () => {
  expect(formatTime(new Date(2026, 0, 5, 3, 7, 59).getTime())).toBe("2026-01-05 03:07");
  expect(formatTime(new Date(2026, 10, 22, 14, 30).getTime())).toBe("2026-11-22 14:30");
});
