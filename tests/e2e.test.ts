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
}, 30000);

test("a rejected send is retried with the same change", async () => {
  received.length = 0;
  failing = true;
  writeTarget("1.2", ["storage", "tabs"], [{ matches: ["<all_urls>"], js: ["cs.js"] }]);
  await (await findWorker("Target")).evaluate(() => chrome.runtime.reload()).catch(() => {});
  await waitFor(() => rejected > 0);
  await waitForAsync(async () => !!(await watcher.evaluate(async () => (await chrome.storage.local.get("lastError")).lastError)));

  failing = false;
  await watcher.evaluate((url) => chrome.storage.local.set({ ntfyUrl: url }), `${ntfyUrl()}?retry=1`);
  await waitFor(() => received.length > 0);
  expect(received[0].body).toMatch(/^Target \([a-p]{32}\)\nversion 1\.1 -> 1\.2$/);
  await waitForAsync(async () => (await watcher.evaluate(async () => (await chrome.storage.local.get("lastError")).lastError)) === null);
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

  // Start from a disabled target regardless of earlier tests, and let that change be sent first.
  received.length = 0;
  await setTarget(false);
  await Bun.sleep(3000);
  received.length = 0;
  await setTarget(true);

  await waitFor(() => received.length > 0);
  expect(received[0].body).toMatch(/^Target \([a-p]{32}\)\nenabled$/);
}, 30000);
