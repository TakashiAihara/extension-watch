import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { chromium, type BrowserContext, type Worker } from "playwright";

// Fake ntfy: records accepted POST bodies. It sends the CORS header the real server sends by default,
// because the test cannot grant the optional host permission (that needs a user gesture).
const received: { url: string; body: string; auth: string | null }[] = [];
let rejected = 0;
let failing = false;
let requireAuth = false;
const server = Bun.serve({
  hostname: "127.0.0.1",
  port: 0,
  async fetch(req) {
    // ntfy answers the preflight a token header triggers; the real run skips it with the host permission.
    const headers = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "*" };
    if (req.method !== "POST") return new Response("{}", { headers });
    if (requireAuth && !req.headers.get("authorization")) return new Response("{}", { status: 403, headers });
    if (failing) {
      rejected++;
      return new Response("{}", { status: 500, headers });
    }
    received.push({ url: req.url, body: await req.text(), auth: req.headers.get("authorization") });
    return new Response("{}", { headers });
  },
});

const tmp = mkdtempSync(join(tmpdir(), "extension-watch-e2e-"));
const target = join(tmp, "target");
const writeTarget = (version: string, permissions: string[], content_scripts?: object[]) => {
  writeFileSync(
    join(target, "manifest.json"),
    JSON.stringify({
      manifest_version: 3,
      name: "Target",
      version,
      permissions,
      content_scripts,
      background: { service_worker: "sw.js" },
    }),
  );
};
const ntfyUrl = () => `http://127.0.0.1:${server.port}/topic`;

let context: BrowserContext;
let watcher: Worker;
let targetSw: Worker;

const waitFor = async (pred: () => boolean, ms = 15000) => {
  const end = Date.now() + ms;
  while (!pred()) {
    if (Date.now() > end) throw new Error("timed out");
    await Bun.sleep(100);
  }
};

const waitForAsync = async (pred: () => Promise<boolean>, ms = 15000) => {
  const end = Date.now() + ms;
  while (!(await pred())) {
    if (Date.now() > end) throw new Error("timed out");
    await Bun.sleep(200);
  }
};

const findWorker = async (name: string) => {
  for (;;) {
    for (const w of context.serviceWorkers()) {
      const n = await w.evaluate(() => chrome.runtime.getManifest().name).catch(() => null);
      if (n === name) return w;
    }
    await context.waitForEvent("serviceworker", { timeout: 10000 });
  }
};

beforeAll(async () => {
  mkdirSync(target);
  writeFileSync(join(target, "sw.js"), "");
  writeFileSync(join(target, "cs.js"), "");
  writeTarget("1.0", ["storage"]);

  // Without developer mode, reloading an unpacked extension leaves it disabled (DISABLE_UNSUPPORTED_DEVELOPER_EXTENSION).
  mkdirSync(join(tmp, "profile", "Default"), { recursive: true });
  writeFileSync(join(tmp, "profile", "Default", "Preferences"), JSON.stringify({ extensions: { ui: { developer_mode: true } } }));

  const ext = resolve(import.meta.dir, "../extension");
  context = await chromium.launchPersistentContext(join(tmp, "profile"), {
    channel: "chromium",
    headless: true,
    // The warning text is asserted in English.
    args: ["--lang=en-US", `--disable-extensions-except=${ext},${target}`, `--load-extension=${ext},${target}`],
  });
  watcher = await findWorker("extension-watch");
  targetSw = await findWorker("Target");

  // The baseline is written SETTLE_MS after install; wait for it before configuring.
  const baseline = async () => !!(await watcher.evaluate(async () => (await chrome.storage.local.get("extensions")).extensions));
  await waitForAsync(baseline);
  await watcher.evaluate((url) => chrome.storage.local.set({ ntfyUrl: url }), ntfyUrl());
}, 60000);

afterAll(async () => {
  await context?.close();
  server.stop(true);
  rmSync(tmp, { recursive: true, force: true });
});

test("a version bump with a new permission and content scripts is sent once to ntfy", async () => {
  writeTarget("1.1", ["storage", "tabs"], [{ matches: ["<all_urls>"], js: ["cs.js"] }]);
  await targetSw.evaluate(() => chrome.runtime.reload()).catch(() => {});

  await waitFor(() => received.length > 0);
  await Bun.sleep(3000);
  expect(received.length).toBe(1);
  expect(new URL(received[0].url).searchParams.get("title")).toBe("extension-watch");
  expect(received[0].auth).toBeNull();
  // The content-script matches show up only as a warning, not in hostPermissions.
  expect(received[0].body).toMatch(
    /^Target \([a-p]{32}\)\nversion 1\.0 -> 1\.1\npermissions added: tabs\nwarnings added: .*all your data on all websites.*$/,
  );

  const history = await watcher.evaluate(async () => (await chrome.storage.local.get("history")).history);
  expect(history).toHaveLength(1);
  expect(history[0]).toMatchObject({ name: "Target", state: "sent" });
  expect(history[0].lines.slice(0, 2)).toEqual(["version 1.0 -> 1.1", "permissions added: tabs"]);
}, 30000);

test("a rejected send is retried with the same change", async () => {
  received.length = 0;
  failing = true;
  writeTarget("1.2", ["storage", "tabs"], [{ matches: ["<all_urls>"], js: ["cs.js"] }]);
  await (await findWorker("Target")).evaluate(() => chrome.runtime.reload()).catch(() => {});
  await waitFor(() => rejected > 0);
  await waitForAsync(async () => !!(await watcher.evaluate(async () => (await chrome.storage.local.get("lastError")).lastError)));
  const held = await watcher.evaluate(async () => (await chrome.storage.local.get("history")).history);
  expect(held[0]).toMatchObject({ lines: ["version 1.1 -> 1.2"], state: "pending" });

  failing = false;
  await watcher.evaluate((url) => chrome.storage.local.set({ ntfyUrl: url }), `${ntfyUrl()}?retry=1`);
  await waitFor(() => received.length > 0);
  expect(received[0].body).toMatch(/^Target \([a-p]{32}\)\nversion 1\.1 -> 1\.2$/);
  await waitForAsync(async () => (await watcher.evaluate(async () => (await chrome.storage.local.get("lastError")).lastError)) === null);

  // The retry marks the held entry as sent instead of adding a second one.
  const after = await watcher.evaluate(async () => (await chrome.storage.local.get("history")).history);
  expect(after.length).toBe(held.length);
  expect(after[0]).toMatchObject({ at: held[0].at, lines: ["version 1.1 -> 1.2"], state: "sent" });
}, 30000);

test("the History tab lists recorded changes newest first", async () => {
  const id = new URL(watcher.url()).host;
  const page = await context.newPage();
  const saved = await watcher.evaluate(async () => (await chrome.storage.local.get("history")).history);
  const entry = (at: number, name: string, lines: string[], state: string) => ({ at, id: "p".repeat(32), name, lines, state });
  await watcher.evaluate(
    (h) => chrome.storage.local.set({ history: h }),
    [entry(2000, "Second", ["version 1.1 -> 1.2"], "sent"), entry(1000, "First", ["version 1.0 -> 1.1"], "replaced")],
  );
  try {
    await page.goto(`chrome-extension://${id}/options.html`);
    await page.waitForFunction(() => document.querySelector("#state-text")?.textContent !== "");
    expect(await page.isHidden("#panel-history")).toBe(true);

    await page.click("#tab-history");
    expect(await page.isVisible("#panel-history")).toBe(true);
    expect(await page.isHidden("#panel-settings")).toBe(true);
    expect(await page.textContent("#history-count")).toBe("2");
    const rows = await page.$$eval("#history-list > li", (lis) => lis.map((li) => li.innerText));
    expect(rows).toHaveLength(2);
    expect(rows[0]).toContain("version 1.1 -> 1.2");
    expect(rows[0]).not.toContain("Not sent");
    expect(rows[1]).toContain("Not sent: it changed again before the retry");
    expect(rows[0]).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}\n/);

    // A new entry written while the page is open shows up without a reload, and a pending one is marked.
    await watcher.evaluate((e) => chrome.storage.local.get("history").then(({ history }) => chrome.storage.local.set({ history: [e, ...history] })), entry(3000, "Late", ["enabled"], "pending"));
    await page.waitForFunction(() => document.querySelector("#history-count")?.textContent === "3");
    expect(await page.textContent("#history-list > li:first-child")).toContain("Not sent yet");

    // Arrow keys move the selection and the focus, and only the selected tab stays in the tab order.
    await page.keyboard.press("ArrowLeft");
    expect(await page.isVisible("#panel-settings")).toBe(true);
    expect(await page.evaluate(() => document.activeElement?.id)).toBe("tab-settings");
    expect(await page.getAttribute("#tab-history", "tabindex")).toBe("-1");
    await page.keyboard.press("ArrowLeft");
    expect(await page.evaluate(() => document.activeElement?.id)).toBe("tab-history");
    expect(await page.getAttribute("#tab-settings", "tabindex")).toBe("-1");
  } finally {
    await watcher.evaluate((h) => chrome.storage.local.set({ history: h }), saved);
    await page.close();
  }
}, 30000);

test("a change rejected for a missing token is sent once a token is saved", async () => {
  received.length = 0;
  requireAuth = true;
  writeTarget("1.3", ["storage", "tabs"], [{ matches: ["<all_urls>"], js: ["cs.js"] }]);
  await (await findWorker("Target")).evaluate(() => chrome.runtime.reload()).catch(() => {});
  await waitForAsync(async () => (await watcher.evaluate(async () => (await chrome.storage.local.get("lastError")).lastError))?.includes("ntfy 403") ?? false);

  // Only the token changes; no extension event fires, so the token change itself must trigger the check.
  await watcher.evaluate(() => chrome.storage.local.set({ ntfyToken: "fake-token-for-test" }));
  await waitFor(() => received.length > 0);
  expect(received[0].body).toMatch(/^Target \([a-p]{32}\)\nversion 1\.2 -> 1\.3$/);
  expect(received[0].auth).toBe("Bearer fake-token-for-test");

  requireAuth = false;
  await watcher.evaluate(() => chrome.storage.local.set({ ntfyToken: "" }));
}, 30000);

test("a stored token is not sent over http to another host", async () => {
  received.length = 0;
  await watcher.evaluate(() => chrome.storage.local.set({ ntfyUrl: "http://ntfy.invalid.test/topic", ntfyToken: "fake-token-for-test" }));
  writeTarget("1.4", ["storage", "tabs"], [{ matches: ["<all_urls>"], js: ["cs.js"] }]);
  await (await findWorker("Target")).evaluate(() => chrome.runtime.reload()).catch(() => {});
  await waitForAsync(async () => (await watcher.evaluate(async () => (await chrome.storage.local.get("lastError")).lastError))?.endsWith("Credentials need an https URL") ?? false);

  await watcher.evaluate((url) => chrome.storage.local.set({ ntfyUrl: url, ntfyToken: "" }), ntfyUrl());
  await waitFor(() => received.length > 0);
  expect(received[0].body).toMatch(/^Target \([a-p]{32}\)\nversion 1\.3 -> 1\.4$/);
}, 30000);

test("the options page rejects credentials in the URL and a token a header cannot hold", async () => {
  const id = new URL(watcher.url()).host;
  const page = await context.newPage();
  await page.goto(`chrome-extension://${id}/options.html`);
  const status = async (url: string, token: string) => {
    await page.fill("#url", url);
    await page.fill("#token", token);
    await page.click("#save");
    return page.textContent("#status");
  };
  expect(await status("https://u:p@ntfy.example.com/t", "")).toBe("Use an access token, or ?auth= in the URL, instead of user:pass@");
  expect(await status("ftp://ntfy.example.com/t", "")).toBe("Enter an http(s) URL");
  expect(await status("https://ntfy.example.com/t", "bad token")).toBe("The token must be printable ASCII without spaces");
  expect(await status("http://ntfy.example.com/t", "tk_abc")).toBe("Credentials need an https URL");
  await page.close();
});

test("the options page header follows the configured URL and the last error", async () => {
  const id = new URL(watcher.url()).host;
  const saved = await watcher.evaluate(() => chrome.storage.local.get(["ntfyUrl", "lastError"]));
  await watcher.evaluate(() => chrome.storage.local.remove(["ntfyUrl", "lastError"]));
  const page = await context.newPage();
  try {
    await page.goto(`chrome-extension://${id}/options.html`);
    const state = async () => [await page.getAttribute("#state", "data-state"), await page.textContent("#state-text")];
    await page.waitForFunction(() => document.querySelector("#state-text")?.textContent !== "");
    expect(await state()).toEqual(["unset", "Not configured"]);

    // With no URL every check fails for that reason, so the error does not replace "Not configured".
    await watcher.evaluate(() => chrome.storage.local.set({ lastError: "ntfy URL is not set" }));
    await page.waitForFunction(() => document.querySelector("#error")?.textContent === "ntfy URL is not set");
    expect(await state()).toEqual(["unset", "Not configured"]);
    await watcher.evaluate(() => chrome.storage.local.remove("lastError"));

    // Only local storage holds the settings; the same key in sync storage is not a URL.
    await watcher.evaluate((url) => chrome.storage.sync.set({ ntfyUrl: url }), ntfyUrl());
    await page.waitForTimeout(300);
    expect(await state()).toEqual(["unset", "Not configured"]);

    await watcher.evaluate((url) => chrome.storage.local.set({ ntfyUrl: url }), ntfyUrl());
    // Within the background's 2 s settle delay, so the page reacts to the URL itself, not to the check it triggers.
    await page.waitForFunction(() => document.querySelector("#state")?.getAttribute("data-state") !== "unset", null, { timeout: 1000 });
    expect(await state()).toEqual(["watching", "Watching"]);
    // Let the check the URL change triggered write its lastError first, so it cannot overwrite the one set below.
    await waitForAsync(async () => watcher.evaluate(async () => "lastError" in (await chrome.storage.local.get("lastError"))));

    await watcher.evaluate(() => chrome.storage.local.set({ lastError: "HTTP 500" }));
    await page.waitForFunction(() => document.querySelector("#state")?.getAttribute("data-state") === "error");
    expect(await state()).toEqual(["error", "Error"]);
    expect(await page.textContent("#error")).toBe("HTTP 500");

    await watcher.evaluate(() => chrome.storage.local.remove("lastError"));
    await page.waitForFunction(() => document.querySelector("#state")?.getAttribute("data-state") !== "error");
    expect(await state()).toEqual(["watching", "Watching"]);
  } finally {
    await page.close();
    await watcher.evaluate(() => chrome.storage.sync.remove("ntfyUrl"));
    await watcher.evaluate((s) => chrome.storage.local.set(s), saved);
  }
});

// Policy cannot be pushed without writing to the system policy directory, so these tests replace
// chrome.storage.managed.get inside the extension with what a policy would return.
test("a policy URL and its token replace the options page settings", async () => {
  received.length = 0;
  await watcher.evaluate(
    ({ url }) => {
      (globalThis as any).__managedGet = chrome.storage.managed.get;
      (chrome.storage.managed as any).get = async () => ({ ntfyUrl: url, ntfyToken: "tk_policy" });
      return chrome.storage.local.set({ ntfyToken: "tk_local" });
    },
    { url: `${ntfyUrl()}-policy` },
  );
  try {
    writeTarget("1.5", ["storage", "tabs"], [{ matches: ["<all_urls>"], js: ["cs.js"] }]);
    await (await findWorker("Target")).evaluate(() => chrome.runtime.reload()).catch(() => {});
    await waitFor(() => received.length > 0);
    // No host permission for a policy URL, so the token travels as ?auth= in a simple request, not a header.
    const sent = new URL(received[0].url);
    expect(sent.pathname).toBe("/topic-policy");
    expect(received[0].auth).toBeNull();
    expect(atob(sent.searchParams.get("auth")!.replace(/-/g, "+").replace(/_/g, "/"))).toBe("Bearer tk_policy");
  } finally {
    await watcher.evaluate(() => {
      (chrome.storage.managed as any).get = (globalThis as any).__managedGet;
      return chrome.storage.local.set({ ntfyToken: "" });
    });
  }
}, 30000);

test("the options page shows a policy URL read-only and hides the token", async () => {
  const id = new URL(watcher.url()).host;
  const page = await context.newPage();
  await page.addInitScript(() => {
    (chrome.storage.managed as any).get = async () => ({ ntfyUrl: "https://org.example.com/t", ntfyToken: "tk_policy" });
  });
  await page.goto(`chrome-extension://${id}/options.html`);
  await page.waitForFunction(() => document.querySelector("#status")?.textContent !== "");
  expect(await page.inputValue("#url")).toBe("https://org.example.com/t");
  expect(await page.inputValue("#token")).toBe("");
  expect(await page.getAttribute("#token", "placeholder")).toBe("Set by your administrator");
  for (const sel of ["#url", "#token", "#save"]) expect(await page.isDisabled(sel)).toBe(true);
  expect(await page.textContent("#status")).toBe("Set by your administrator through policy");

  // A policy URL counts as configured even when the options page never saved one.
  const saved = await watcher.evaluate(() => chrome.storage.local.get(["ntfyUrl", "lastError"]));
  await watcher.evaluate(() => chrome.storage.local.remove(["ntfyUrl", "lastError"]));
  try {
    await page.reload();
    await page.waitForFunction(() => document.querySelector("#state-text")?.textContent !== "");
    expect(await page.getAttribute("#state", "data-state")).toBe("watching");

    // Removing the saved URL while a policy URL is in force leaves the page configured.
    await watcher.evaluate((url) => chrome.storage.local.set({ ntfyUrl: url }), ntfyUrl());
    await watcher.evaluate(() => chrome.storage.local.remove("ntfyUrl"));
    await page.waitForTimeout(300);
    expect(await page.getAttribute("#state", "data-state")).toBe("watching");
  } finally {
    await watcher.evaluate((s) => chrome.storage.local.set(s), saved);
    await page.close();
  }
});

test("a policy that cannot be read stops sending and shows the error instead of using the options page", async () => {
  received.length = 0;
  await watcher.evaluate(() => {
    (globalThis as any).__managedGet = chrome.storage.managed.get;
    (chrome.storage.managed as any).get = async () => {
      throw new Error("policy broken");
    };
  });
  try {
    writeTarget("1.6", ["storage", "tabs"], [{ matches: ["<all_urls>"], js: ["cs.js"] }]);
    await (await findWorker("Target")).evaluate(() => chrome.runtime.reload()).catch(() => {});
    await waitForAsync(async () => (await watcher.evaluate(async () => (await chrome.storage.local.get("lastError")).lastError))?.endsWith("policy broken") ?? false);
    expect(await watcher.evaluate(() => chrome.action.getBadgeText({}))).toBe("!");
    expect(received).toEqual([]);
    const held = await watcher.evaluate(async () => (await chrome.storage.local.get("history")).history[0]);
    expect(held).toMatchObject({ lines: ["version 1.5 -> 1.6"], state: "pending" });
  } finally {
    await watcher.evaluate(() => {
      (chrome.storage.managed as any).get = (globalThis as any).__managedGet;
    });
  }

  // Once the policy reads again, the held change is sent.
  await watcher.evaluate((url) => chrome.storage.local.set({ ntfyUrl: `${url}?again=1` }), ntfyUrl());
  await waitFor(() => received.length > 0);
  expect(received[0].body).toMatch(/^Target \([a-p]{32}\)\nversion 1\.5 -> 1\.6$/);
  await waitForAsync(async () => (await watcher.evaluate(async () => (await chrome.storage.local.get("history")).history[0].state)) === "sent");
  const after = await watcher.evaluate(async () => (await chrome.storage.local.get("history")).history);
  expect(after[0]).toMatchObject({ lines: ["version 1.5 -> 1.6"], state: "sent" });
  expect(after.filter((e: { lines: string[] }) => e.lines[0] === "version 1.5 -> 1.6")).toHaveLength(1);
}, 30000);

test("the options page shows a policy it cannot read", async () => {
  const id = new URL(watcher.url()).host;
  const page = await context.newPage();
  await page.addInitScript(() => {
    (chrome.storage.managed as any).get = async () => {
      throw new Error("policy broken");
    };
  });
  // No saved URL and no last error: the unreadable policy alone must make the header say Error.
  const saved = await watcher.evaluate(() => chrome.storage.local.get(["ntfyUrl", "lastError"]));
  await watcher.evaluate(() => chrome.storage.local.remove(["ntfyUrl", "lastError"]));
  try {
    await page.goto(`chrome-extension://${id}/options.html`);
    await page.waitForFunction(() => document.querySelector("#status")?.textContent !== "");
    expect(await page.textContent("#status")).toBe("Cannot read the policy: policy broken");
    expect(await page.getAttribute("#state", "data-state")).toBe("error");

    // A later check that clears lastError does not mean the policy reads again.
    await watcher.evaluate(() => chrome.storage.local.set({ lastError: "HTTP 500" }));
    await page.waitForFunction(() => document.querySelector("#error")?.textContent === "HTTP 500");
    await watcher.evaluate(() => chrome.storage.local.set({ lastError: null }));
    await page.waitForFunction(() => document.querySelector("#error")?.textContent === "none");
    expect(await page.getAttribute("#state", "data-state")).toBe("error");
  } finally {
    await watcher.evaluate((s) => chrome.storage.local.set(s), saved);
    await page.close();
  }
});

test("a policy URL without a token leaves the token placeholder empty", async () => {
  const id = new URL(watcher.url()).host;
  const page = await context.newPage();
  await page.addInitScript(() => {
    (chrome.storage.managed as any).get = async () => ({ ntfyUrl: "https://org.example.com/t" });
  });
  await page.goto(`chrome-extension://${id}/options.html`);
  await page.waitForFunction(() => document.querySelector("#status")?.textContent !== "");
  expect(await page.getAttribute("#token", "placeholder")).toBe("");
  expect(await page.isDisabled("#save")).toBe(true);
  await page.close();
});

test("the baseline is taken even while the policy cannot be read", async () => {
  received.length = 0;
  const saved = await watcher.evaluate(async () => (await chrome.storage.local.get("extensions")).extensions);
  await watcher.evaluate(() => {
    (globalThis as any).__managedGet = chrome.storage.managed.get;
    (chrome.storage.managed as any).get = async () => {
      throw new Error("policy broken");
    };
    return chrome.storage.local.remove("extensions");
  });
  try {
    // Any event triggers a check; with no stored records it only writes the baseline.
    await watcher.evaluate(() => chrome.storage.local.set({ lastError: "trigger" }));
    await watcher.evaluate((url) => chrome.storage.local.set({ ntfyUrl: `${url}?baseline=1` }), ntfyUrl());
    await waitForAsync(async () => !!(await watcher.evaluate(async () => (await chrome.storage.local.get("extensions")).extensions)));
    expect(received).toEqual([]);
  } finally {
    await watcher.evaluate(
      (ext) => {
        (chrome.storage.managed as any).get = (globalThis as any).__managedGet;
        return chrome.storage.local.set({ extensions: ext });
      },
      saved,
    );
  }
}, 30000);

test("disabling an extension is sent", async () => {
  received.length = 0;
  await watcher.evaluate(async () => {
    const t = (await chrome.management.getAll()).find((e) => e.name === "Target");
    await chrome.management.setEnabled(t!.id, false);
  });

  await waitFor(() => received.length > 0);
  expect(received[0].body).toMatch(/^Target \([a-p]{32}\)\ndisabled \(unknown\)$/);
}, 30000);

test("re-enabling an extension is sent", async () => {
  const setTarget = (enabled: boolean) =>
    watcher.evaluate(async (on) => {
      const t = (await chrome.management.getAll()).find((e) => e.name === "Target");
      await chrome.management.setEnabled(t!.id, on);
    }, enabled);

  // Start from a disabled target regardless of earlier tests, and wait until the watcher has stored it.
  await setTarget(false);
  await waitForAsync(() =>
    watcher.evaluate(async () => {
      const { extensions } = await chrome.storage.local.get("extensions");
      return Object.values(extensions ?? {}).some((r: any) => r.name === "Target" && r.enabled === false);
    }),
  );
  received.length = 0;
  await setTarget(true);

  await waitFor(() => received.length > 0);
  expect(received[0].body).toMatch(/^Target \([a-p]{32}\)\nenabled$/);
}, 30000);

test("a held change that goes away before it is sent is closed in the history", async () => {
  const setTarget = (enabled: boolean) =>
    watcher.evaluate(async (on) => {
      const t = (await chrome.management.getAll()).find((e) => e.name === "Target");
      await chrome.management.setEnabled(t!.id, on);
    }, enabled);
  const newest = () => watcher.evaluate(async () => (await chrome.storage.local.get("history")).history[0]);

  rejected = 0;
  failing = true;
  try {
    await setTarget(false);
    await waitFor(() => rejected > 0);
    await waitForAsync(async () => (await newest())?.state === "pending");
    expect(await newest()).toMatchObject({ lines: ["disabled (unknown)"], state: "pending" });

    // Turned back on before any send got through: nothing to send, and the held entry is closed.
    const before = rejected;
    await setTarget(true);
    await waitForAsync(async () => (await newest())?.state !== "pending");
    expect(await newest()).toMatchObject({ lines: ["disabled (unknown)"], state: "replaced" });
    // failing is still on, so a send would show up as a rejection.
    expect(rejected).toBe(before);
  } finally {
    failing = false;
  }
}, 30000);
