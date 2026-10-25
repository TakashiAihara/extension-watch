import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { chromium, type BrowserContext, type Worker } from "playwright";

// Fake ntfy: records POST bodies and answers with the CORS header the real server sends.
const received: { url: string; body: string }[] = [];
const server = Bun.serve({
  hostname: "127.0.0.1",
  port: 0,
  async fetch(req) {
    if (req.method === "POST") received.push({ url: req.url, body: await req.text() });
    return new Response("{}", { headers: { "Access-Control-Allow-Origin": "*" } });
  },
});

const tmp = mkdtempSync(join(tmpdir(), "extension-watch-e2e-"));
const target = join(tmp, "target");
const writeTarget = (version: string, permissions: string[]) => {
  writeFileSync(
    join(target, "manifest.json"),
    JSON.stringify({ manifest_version: 3, name: "Target", version, permissions, background: { service_worker: "sw.js" } }),
  );
};

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
  writeTarget("1.0", ["storage"]);

  // Without developer mode, reloading an unpacked extension leaves it disabled (DISABLE_UNSUPPORTED_DEVELOPER_EXTENSION).
  mkdirSync(join(tmp, "profile", "Default"), { recursive: true });
  writeFileSync(join(tmp, "profile", "Default", "Preferences"), JSON.stringify({ extensions: { ui: { developer_mode: true } } }));

  const ext = resolve(import.meta.dir, "../extension");
  context = await chromium.launchPersistentContext(join(tmp, "profile"), {
    channel: "chromium",
    headless: true,
    args: [`--disable-extensions-except=${ext},${target}`, `--load-extension=${ext},${target}`],
  });
  watcher = await findWorker("extension-watch");
  targetSw = await findWorker("Target");

  // The baseline is written SETTLE_MS after install; wait for it before configuring.
  for (let i = 0; i < 50; i++) {
    if (await watcher.evaluate(async () => !!(await chrome.storage.local.get("extensions")).extensions)) break;
    await Bun.sleep(200);
  }
  await watcher.evaluate((url) => chrome.storage.local.set({ ntfyUrl: url }), `http://127.0.0.1:${server.port}/topic`);
}, 60000);

afterAll(async () => {
  await context?.close();
  server.stop(true);
  rmSync(tmp, { recursive: true, force: true });
});

test("a version bump with a new permission is sent once to ntfy", async () => {
  writeTarget("1.1", ["storage", "tabs"]);
  await targetSw.evaluate(() => chrome.runtime.reload()).catch(() => {});

  await waitFor(() => received.length > 0);
  await Bun.sleep(3000);
  expect(received.length).toBe(1);
  expect(new URL(received[0].url).searchParams.get("title")).toBe("extension-watch");
  expect(received[0].body).toMatch(/^Target \([a-p]{32}\)\nversion 1\.0 -> 1\.1\npermissions added: tabs$/);
}, 30000);

test("disabling an extension is sent", async () => {
  received.length = 0;
  await watcher.evaluate(async () => {
    const t = (await chrome.management.getAll()).find((e) => e.name === "Target");
    await chrome.management.setEnabled(t!.id, false);
  });

  await waitFor(() => received.length > 0);
  expect(received[0].body).toMatch(/\ndisabled \(unknown\)$/);
}, 30000);
