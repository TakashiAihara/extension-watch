import { describe, expect, test } from "bun:test";
import { formatTime, hasPending, record } from "../extension/history.js";

const change = (id: string, lines: string[]) => ({ id, name: `Ext ${id}`, lines, message: "" });
const none = new Set<string>();

describe("record", () => {
  test("adds sent and pending changes newest first", () => {
    const h = record([], [change("a", ["enabled"]), change("b", ["version 1 -> 2"])], new Set(["a"]), 100);
    expect(h).toEqual([
      { at: 100, id: "b", name: "Ext b", lines: ["version 1 -> 2"], state: "pending" },
      { at: 100, id: "a", name: "Ext a", lines: ["enabled"], state: "sent" },
    ]);
  });

  test("a held change that is sent later updates its entry and keeps the first time", () => {
    const held = record([], [change("a", ["version 1 -> 2"])], none, 100);
    const again = record(held, [change("a", ["version 1 -> 2"])], none, 200);
    expect(again).toEqual(held);
    expect(record(again, [change("a", ["version 1 -> 2"])], new Set(["a"]), 300)).toEqual([
      { at: 100, id: "a", name: "Ext a", lines: ["version 1 -> 2"], state: "sent" },
    ]);
  });

  test("a held change that grew is replaced by a new entry", () => {
    const held = record([], [change("a", ["version 1 -> 2"])], none, 100);
    const grown = record(held, [change("a", ["version 1 -> 3"])], new Set(["a"]), 200);
    expect(grown.map((e) => [e.at, e.lines[0], e.state])).toEqual([
      [200, "version 1 -> 3", "sent"],
      [100, "version 1 -> 2", "replaced"],
    ]);
  });

  test("a held change that went away is closed, and a later identical event gets its own entry", () => {
    // Disabled while the send fails, enabled again, then disabled for real days later.
    let h = record([], [change("a", ["disabled (unknown)"])], none, 100);
    h = record(h, [], none, 200);
    expect(h.map((e) => e.state)).toEqual(["replaced"]);
    h = record(h, [change("a", ["disabled (unknown)"])], new Set(["a"]), 900);
    expect(h.map((e) => [e.at, e.state])).toEqual([
      [900, "sent"],
      [100, "replaced"],
    ]);
  });

  test("the same change seen again after it was sent is a new event", () => {
    const sent = record([], [change("a", ["disabled (unknown)"])], new Set(["a"]), 100);
    expect(record(sent, [change("a", ["disabled (unknown)"])], new Set(["a"]), 200)).toHaveLength(2);
  });

  test("only a pending entry is matched, not an older sent one with the same lines", () => {
    let h = record([], [change("a", ["enabled"])], new Set(["a"]), 100);
    h = record(h, [change("b", ["enabled"])], none, 150);
    h = record(h, [change("a", ["enabled"]), change("b", ["enabled"])], new Set(["a", "b"]), 200);
    expect(h.map((e) => [e.id, e.at, e.state])).toEqual([
      ["a", 200, "sent"],
      ["b", 150, "sent"],
      ["a", 100, "sent"],
    ]);
  });

  test("a pending change whose send fails again stays pending next to one that is sent", () => {
    let h = record([], [change("a", ["enabled"]), change("b", ["enabled"])], none, 100);
    h = record(h, [change("a", ["enabled"]), change("b", ["enabled"])], new Set(["a"]), 200);
    expect(h.map((e) => [e.id, e.state])).toEqual([
      ["b", "pending"],
      ["a", "sent"],
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

test("hasPending is true only while an entry waits to be sent", () => {
  expect(hasPending(undefined)).toBe(false);
  expect(hasPending(record([], [change("a", ["enabled"])], new Set(["a"]), 1))).toBe(false);
  expect(hasPending(record([], [change("a", ["enabled"])], none, 1))).toBe(true);
});

test("formatTime writes local time as YYYY-MM-DD HH:mm", () => {
  const tz = process.env.TZ;
  // A zone away from UTC, so UTC getters would give another hour and day.
  process.env.TZ = "Asia/Tokyo";
  try {
    expect(formatTime(Date.UTC(2026, 0, 4, 18, 7, 59))).toBe("2026-01-05 03:07");
    expect(formatTime(Date.UTC(2026, 10, 22, 5, 30))).toBe("2026-11-22 14:30");
  } finally {
    process.env.TZ = tz;
  }
});

describe("trimming", () => {
  test("drops the oldest sent entries but keeps a pending one past the count cap", () => {
    let h = record([], [change("held", ["version 1 -> 2"])], none, 0);
    for (let i = 1; i <= 505; i++) h = record(h, [change(`e${i}`, ["enabled"]), change("held", ["version 1 -> 2"])], new Set([`e${i}`]), i);
    expect(h).toHaveLength(500);
    expect(h[h.length - 1]).toMatchObject({ id: "held", at: 0, state: "pending" });
    expect(h[0].at).toBe(505);
    expect(h[h.length - 2].at).toBe(7);
  });

  test("keeps the stored history under the byte cap", () => {
    const big = Array.from({ length: 2000 }, (_, i) => `https://host-${i}.example.com/*`);
    let h: ReturnType<typeof record> = [];
    for (let i = 0; i < 60; i++) h = record(h, [change(`e${i}`, big)], new Set([`e${i}`]), i);
    const bytes = new TextEncoder().encode(JSON.stringify(h)).length;
    expect(bytes).toBeLessThanOrEqual(1_000_000);
    expect(bytes).toBeGreaterThan(900_000);
    expect(h[0].at).toBe(59);
  });

  test("counts bytes, not characters, for localized warnings", () => {
    const warnings = Array.from({ length: 2000 }, (_, i) => `すべてのウェブサイト上にある全データの読み取りと変更 ${i}`);
    let h: ReturnType<typeof record> = [];
    for (let i = 0; i < 20; i++) h = record(h, [change(`e${i}`, warnings)], new Set([`e${i}`]), i);
    expect(new TextEncoder().encode(JSON.stringify(h)).length).toBeLessThanOrEqual(1_000_000);
    expect(JSON.stringify(h).length).toBeLessThan(500_000);
  });
});
